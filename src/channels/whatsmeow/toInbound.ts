import { lookupPhoneJidByLid } from "../../helpers/lidLookup";
import { isLidJid, toUserLid } from "../../helpers/GetPhoneJid";
import { InboundKind, InboundMessage } from "../inbound";
import { gatewayClient, GatewayClient } from "./client";
import { loadIncoming } from "./media";

// Envelope `message` publicado pelo gateway em wa:events:{connectionId}
// (internal/events/envelope.go do weconex-api-meow).
export interface GatewayMessageData {
  id: string;
  fromMe: boolean;
  history?: boolean;
  /** Epoch em milissegundos. */
  timestamp: number;
  chat: { jid: string; isGroup: boolean; name?: string };
  sender: { jid: string; name?: string; lid?: string };
  kind: string;
  channelType: string;
  text?: string;
  hasMedia?: boolean;
  media?: { mimetype: string; fileName: string };
  quotedId?: string;
  editOf?: string;
  forwarded?: boolean;
  mentions?: string[] | null;
  raw: { key?: any; message?: unknown; pushName?: string; messageTimestamp?: number } & Record<string, any>;
}

export interface GatewayMessageEnvelope {
  type: "message";
  connectionId: number;
  ts: number;
  data: GatewayMessageData;
}

export interface ToInboundDeps {
  client?: Pick<GatewayClient, "downloadMedia">;
  lookupLid?: (lid: string, companyId: number) => Promise<string | undefined>;
}

const KINDS: InboundKind[] = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contact",
  "contacts",
  "other"
];

/**
 * Envelope `message` do gateway -> InboundMessage. Devolve null para o que a
 * plataforma ignora (status do WhatsApp), como o toInbound do Baileys.
 */
export const toInbound = async (
  envelope: GatewayMessageEnvelope,
  companyId: number,
  deps: ToInboundDeps = {}
): Promise<InboundMessage | null> => {
  const data = envelope.data;
  const connectionId = envelope.connectionId;
  if (data.chat.jid === "status@broadcast") return null;

  const lookupLid = deps.lookupLid || lookupPhoneJidByLid;

  // O gateway só põe o telefone quando o conhece; um LID visto antes volta
  // a ser o telefone, senão o mesmo contato vira dois.
  let senderJid = data.sender.jid;
  let senderLid = data.sender.lid || undefined;
  if (isLidJid(senderJid)) {
    const userLid = toUserLid(senderJid);
    senderLid = senderLid || userLid;
    senderJid = (userLid && (await lookupLid(userLid, companyId))) || senderJid;
  }

  const hasMedia = !!data.hasMedia;
  const rawMessage = data.raw?.message;
  const loadMedia = () => loadIncoming(deps.client || gatewayClient(), connectionId, rawMessage);

  return {
    connectionId,
    companyId,
    externalId: data.id,
    fromMe: !!data.fromMe,
    history: !!data.history,
    timestamp: data.timestamp || Date.now(),
    chat: { jid: data.chat.jid, isGroup: !!data.chat.isGroup, name: data.chat.name || undefined },
    sender: { jid: senderJid, name: data.sender.name || undefined, lid: senderLid },
    kind: KINDS.includes(data.kind as InboundKind) ? (data.kind as InboundKind) : "other",
    channelType: data.channelType,
    text: data.text || "",
    hasMedia,
    loadMedia: hasMedia ? loadMedia : undefined,
    quotedExternalId: data.quotedId || undefined,
    forwarded: !!data.forwarded,
    editOf: data.editOf || undefined,
    mentions: data.mentions || [],
    raw: data.raw
  };
};

export default toInbound;
