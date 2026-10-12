import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import Message from "../../models/Message";
import { wasSentByPlatform } from "../sentByPlatform";
import { toInbound, GatewayMessageData, GatewayMessageEnvelope, ToInboundDeps } from "./toInbound";
import { setStatus, WhatsmeowStatus } from "./state";
import ProcessInboundMessage from "../../services/InboundServices/ProcessInboundMessage";
import { verifyRecentCampaign } from "../../services/InboundServices/CampaignReplyService";
import UpdateMessageAckService from "../../services/MessageServices/UpdateMessageAckService";
import MarkReadOnDeviceService from "../../services/MessageServices/MarkReadOnDeviceService";
import ReactToMessageService from "../../services/MessageServices/ReactToMessageService";
import ApplyLidMappingService from "../../services/WhatsappContactServices/ApplyLidMappingService";
import UpsertWhatsappContactsService, {
  SyncedContact
} from "../../services/WhatsappContactServices/UpsertWhatsappContactsService";
import MissedCallService from "../../services/TicketServices/MissedCallService";
import { handleContactTyping } from "../../services/TicketServices/ContactTypingService";
import ShowWhatsAppService from "../../services/WhatsappService/ShowWhatsAppService";
import FinishHistoryImportService from "../../services/WhatsappService/FinishHistoryImportService";
import { createHistoryImporter, importDay } from "../../services/WbotServices/historyImport";
import { publishImportProgress } from "../../libs/historyImportProgress";
import { forgetGroup } from "../../libs/whatsappCache";
import { logger } from "../../utils/logger";

// Um handler por tipo de evento publicado pelo gateway em wa:events:{id}
// (internal/events/envelope.go do weconex-api-meow), com as mesmas regras do
// wbotMessageListener/wbotMonitor do Baileys. Contrato com o consumer:
// lançar = tentar de novo depois (falha passageira de banco/rede); voltar
// normalmente = confirmar (XACK), inclusive quando não há nada a fazer.

export interface GatewayEnvelope<T = any> {
  type: string;
  connectionId: number;
  ts: number;
  data: T;
}

export interface ReceiptData {
  ids: string[];
  chat: string;
  sender: string;
  isGroup: boolean;
  status: "delivered" | "read" | "played" | "read_self" | "played_self" | string;
}

export interface ReactionData {
  id: string;
  chat: string;
  sender: string;
  fromMe: boolean;
  emoji: string;
  at: number;
}

export interface PresenceData {
  chat: string;
  sender: string;
  state: string;
}

export interface GatewayContact {
  jid: string;
  lid?: string;
  name?: string;
  notify?: string;
}

export interface HistoryData {
  messages: GatewayMessageData[] | null;
  contacts: GatewayContact[] | null;
  progress: number;
  final: boolean;
}

export interface CallData {
  event: "offer" | "terminate" | string;
  callId: string;
  from: string;
  isVideo?: boolean;
  isGroup?: boolean;
  ts?: number;
}

export interface ConnectionData {
  status: string;
  qr?: string;
  code?: string;
  me?: string;
  reason?: string;
}

export interface HandlerDeps {
  /** Evento `connection`; a camada de sessão (Task 11) pluga o SessionService. */
  onConnection?: (connectionId: number, data: ConnectionData) => Promise<void> | void;
  inbound?: ToInboundDeps;
  history?: { pauseMs?: number; idleMs?: number };
}

interface Context {
  connectionId: number;
  companyId: number;
  deps: HandlerDeps;
}

// Mensagem do histórico no formato que o importador espera (key.id,
// key.remoteJid, messageTimestamp em segundos) + o envelope original.
interface HistoryItem {
  key: { id: string; remoteJid: string };
  messageTimestamp: number;
  env: GatewayMessageEnvelope;
}

type HistoryImporter = ReturnType<typeof createHistoryImporter>;

const companies = new Map<number, number>();
const importers = new Map<number, HistoryImporter>();

const companyOf = async (connectionId: number): Promise<number | undefined> => {
  const cached = companies.get(connectionId);
  if (cached) return cached;
  const whatsapp = await Whatsapp.findByPk(connectionId, { attributes: ["id", "companyId"] });
  if (!whatsapp) return undefined;
  companies.set(connectionId, whatsapp.companyId);
  return whatsapp.companyId;
};

const messageExists = async (externalId: string, whatsappId: number): Promise<boolean> =>
  (await Message.count({ where: { messagesWhatsappsId: externalId, whatsappId } })) > 0;

const asMessageEnvelope = (connectionId: number, ts: number, data: GatewayMessageData): GatewayMessageEnvelope => ({
  type: "message",
  connectionId,
  ts,
  data
});

// Eco → duplicidade → grava → campanha (wbotMessageListener, messages.upsert).
const handleMessage = async (env: GatewayEnvelope<GatewayMessageData>, { connectionId, companyId, deps }: Context) => {
  const data = env.data;
  if (!data?.id) return;
  // Enviada pelo canal: quem enviou já gravou.
  if (data.fromMe && wasSentByPlatform(connectionId, data.id)) return;
  // Reentrega do WhatsApp ou do Redis (XAUTOCLAIM).
  if (await messageExists(data.id, connectionId)) return;

  const inbound = await toInbound(asMessageEnvelope(connectionId, env.ts, data), companyId, deps.inbound);
  if (!inbound) return;
  await ProcessInboundMessage(inbound);
  // Já gravada: repetir o evento não refaria a campanha (a duplicidade o
  // descarta), então a falha aqui só é registrada.
  try {
    await verifyRecentCampaign(inbound);
  } catch (err) {
    logger.warn(`verifyRecentCampaign (whatsapp ${connectionId}, ${data.id}): ${(err as Error)?.message || err}`);
  }
};

const RECEIPT_ACK: Record<string, number> = { delivered: 3, read: 4, played: 5 };

// Recibos casam pelo id + conexão, então chat/remetente em LID não atrapalham.
// O ack nunca volta (UpdateMessageAckService).
const handleReceipt = async (env: GatewayEnvelope<ReceiptData>, { connectionId, companyId }: Context) => {
  const { status, isGroup } = env.data || ({} as ReceiptData);
  const ids = (env.data?.ids || []).filter(Boolean);
  if (!ids.length) return;

  // Lidas por nós no celular ou em outro aparelho.
  if (status === "read_self" || status === "played_self") {
    await MarkReadOnDeviceService(ids, companyId, connectionId);
    return;
  }

  const ack = RECEIPT_ACK[status];
  if (!ack) return;

  if (!isGroup) {
    await Promise.all(ids.map(id => UpdateMessageAckService(id, ack, connectionId)));
    return;
  }

  // Grupo (message-receipt.update): um recibo por membro. Membros só
  // confirmam as nossas mensagens, então leitura de uma mensagem recebida
  // quer dizer que nós a lemos; id ainda não gravado só pode ser nosso.
  const saved = await Message.findAll({
    where: { messagesWhatsappsId: { [Op.in]: ids }, whatsappId: connectionId },
    attributes: ["messagesWhatsappsId", "fromMe"]
  });
  const received = new Set(saved.filter(m => !m.fromMe).map(m => m.messagesWhatsappsId));
  const readByUs = ids.filter(id => received.has(id));
  if (readByUs.length && ack >= 4) await MarkReadOnDeviceService(readByUs, companyId, connectionId);
  await Promise.all(ids.filter(id => !received.has(id)).map(id => UpdateMessageAckService(id, ack, connectionId)));
};

// O gateway já manda "me" ou o endereço cru de quem reagiu, como o Baileys.
const handleReaction = async (env: GatewayEnvelope<ReactionData>, { connectionId, companyId }: Context) => {
  const d = env.data;
  if (!d?.id) return;
  await ReactToMessageService({
    companyId,
    whatsappId: connectionId,
    externalId: d.id,
    jid: d.fromMe ? "me" : d.sender,
    fromMe: !!d.fromMe,
    emoji: d.emoji || "",
    at: Number(d.at || 0) || Date.now()
  });
};

// Digitando é efêmero: repetir depois mostraria um estado velho.
const handlePresence = async (env: GatewayEnvelope<PresenceData>, { connectionId, companyId }: Context) => {
  try {
    await handleContactTyping({ companyId, whatsappId: connectionId, chatJid: env.data?.chat, state: env.data?.state });
  } catch (err) {
    logger.debug(`presence (whatsapp ${connectionId}): ${err}`);
  }
};

const handleLidMapping = async (env: GatewayEnvelope<{ lid: string; pn: string }>, { connectionId, companyId }: Context) => {
  const { lid, pn } = env.data || ({} as { lid: string; pn: string });
  if (!lid || !pn) return;
  await ApplyLidMappingService({ whatsappId: connectionId, companyId, lid, pn });
};

const toSyncedContacts = (contacts: GatewayContact[] | null | undefined): SyncedContact[] =>
  (contacts || [])
    .filter(c => c?.jid)
    .map(c => ({ id: c.jid, lid: c.lid || undefined, name: c.name || undefined, notify: c.notify || undefined }));

const saveContacts = async (connectionId: number, companyId: number, contacts: SyncedContact[]) => {
  if (!contacts.length) return;
  await UpsertWhatsappContactsService({ whatsappId: connectionId, companyId, contacts });
};

const handleContacts = async (env: GatewayEnvelope<{ contacts: GatewayContact[] }>, { connectionId, companyId }: Context) =>
  saveContacts(connectionId, companyId, toSyncedContacts(env.data?.contacts));

const handleGroupUpdate = async (env: GatewayEnvelope<{ jid: string }>, { connectionId }: Context) => {
  if (env.data?.jid) forgetGroup(connectionId, env.data.jid);
};

// Um importador por conexão (wbotMessageListener, messaging-history.set).
const importerFor = ({ connectionId, companyId, deps }: Context): HistoryImporter => {
  const existing = importers.get(connectionId);
  if (existing) return existing;
  const importer = createHistoryImporter<HistoryItem>({
    load: async () => {
      const conn = await ShowWhatsAppService(connectionId, companyId);
      return {
        importMessages: !!conn.importMessages,
        initialDate: importDay(conn.initialDate),
        finalDate: importDay(conn.finalDate)
      };
    },
    exists: id => messageExists(id, connectionId),
    handle: async item => {
      const inbound = await toInbound(item.env, companyId, deps.inbound);
      if (inbound) await ProcessInboundMessage({ ...inbound, history: true });
    },
    finish: () => FinishHistoryImportService(connectionId, companyId),
    log: line => logger.info(`importação de histórico (whatsapp ${connectionId}): ${line}`),
    report: progress => publishImportProgress(connectionId, companyId, progress),
    pauseMs: deps.history?.pauseMs,
    idleMs: deps.history?.idleMs
  });
  importers.set(connectionId, importer as HistoryImporter);
  return importer as HistoryImporter;
};

// Só enfileira: o lote roda na fila do importador e o evento é confirmado
// logo (se a api cair no meio do lote, o resto se perde, como hoje).
const handleHistory = async (env: GatewayEnvelope<HistoryData>, ctx: Context) => {
  const d = env.data || ({} as HistoryData);
  const items: HistoryItem[] = (d.messages || [])
    .filter(m => m?.id && m.chat?.jid && m.chat.jid !== "status@broadcast")
    .map(m => ({
      key: { id: m.id, remoteJid: m.chat.jid },
      messageTimestamp: Math.floor((m.timestamp || 0) / 1000),
      env: asMessageEnvelope(ctx.connectionId, env.ts, { ...m, history: true })
    }));
  const contacts = toSyncedContacts(d.contacts);
  const importer = importerFor(ctx);
  importer.onBatch(
    items as any,
    contacts.length ? () => saveContacts(ctx.connectionId, ctx.companyId, contacts) : undefined,
    typeof d.progress === "number" ? d.progress : null
  );
  if (d.final) importer.receivedAll();
};

// Chamada encerrada (wbotMonitor, CB:call terminate). O serviço confere a
// configuração `call` e avisa o contato; repetir mandaria o aviso de novo,
// então a falha só é registrada.
const handleCall = async (env: GatewayEnvelope<CallData>, { connectionId, companyId }: Context) => {
  const d = env.data;
  if (!d || d.event !== "terminate" || d.isGroup || !d.from) return;
  try {
    await MissedCallService({ whatsappId: connectionId, companyId, from: d.from, callId: d.callId });
  } catch (err) {
    logger.warn(`chamada perdida (whatsapp ${connectionId}, ${d.callId}): ${(err as Error)?.message || err}`);
  }
};

const STATUSES: WhatsmeowStatus[] = ["qr", "pair_code", "connected", "disconnected", "logged_out"];

const defaultOnConnection = (connectionId: number, data: ConnectionData) => {
  if (STATUSES.includes(data?.status as WhatsmeowStatus)) setStatus(connectionId, data.status as WhatsmeowStatus);
};

const handleConnection = async (env: GatewayEnvelope<ConnectionData>, { connectionId, deps }: Context) => {
  const status = env.data?.status;
  if (status === "disconnected" || status === "logged_out") importers.get(connectionId)?.cancel();
  await (deps.onConnection || defaultOnConnection)(connectionId, env.data);
};

const HANDLERS: Record<string, (env: GatewayEnvelope, ctx: Context) => Promise<void>> = {
  message: handleMessage,
  receipt: handleReceipt,
  reaction: handleReaction,
  // Apagada para todos: paridade com hoje, nada muda no ticket (decisão 5).
  message_update: async () => undefined,
  presence: handlePresence,
  lid_mapping: handleLidMapping,
  contacts: handleContacts,
  group_update: handleGroupUpdate,
  history: handleHistory,
  call: handleCall,
  connection: handleConnection
};

/** Trata um envelope do stream; lançar = o consumer tenta de novo. */
export const handleEnvelope = async (env: GatewayEnvelope, deps: HandlerDeps = {}): Promise<void> => {
  const handler = HANDLERS[env?.type];
  if (!handler) return;
  const connectionId = Number(env.connectionId);
  const companyId = await companyOf(connectionId);
  if (!companyId) {
    logger.warn(`evento ${env.type} do gateway para conexão desconhecida ${env.connectionId}: ignorado`);
    return;
  }
  await handler({ ...env, connectionId }, { connectionId, companyId, deps });
};

/** Conexão excluída: esquece a empresa em cache e o importador. */
export const forgetConnection = (connectionId: number): void => {
  companies.delete(connectionId);
  importers.get(connectionId)?.cancel();
  importers.delete(connectionId);
};

/** Espera a fila de histórico da conexão esvaziar (testes e desligamento). */
export const historyIdle = async (connectionId: number): Promise<void> => {
  await importers.get(connectionId)?.idle();
};

// Só para testes.
export const resetHandlers = (): void => {
  importers.forEach(importer => importer.cancel());
  importers.clear();
  companies.clear();
};

export default handleEnvelope;
