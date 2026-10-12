import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import { companyRoom } from "../../libs/socketRooms";
import { newProtocol, recordLog } from "../../libs/systemLog";
import { logger } from "../../utils/logger";
import { toPhoneNumber } from "../../helpers/GetPhoneJid";
import { reconnectDecision } from "../../helpers/reconnectPolicy";
import { gatewayClient, Status } from "../../channels/whatsmeow/client";
import * as state from "../../channels/whatsmeow/state";
import * as consumer from "../../channels/whatsmeow/consumer";
import { handleEnvelope, forgetConnection, ConnectionData } from "../../channels/whatsmeow/handlers";
import FindNumberInUseService from "../WhatsappService/FindNumberInUseService";
import SyncSessionContactsService from "../WhatsappContactServices/SyncSessionContactsService";

// Ciclo de vida das conexões no motor whatsmeow: comandos HTTP para o gateway
// e os eventos `connection` do stream (via handlers/consumer) gravados em
// Whatsapps, com os mesmos status e eventos de socket que o Baileys usa
// (libs/wbot.ts). Nunca lê nem grava Whatsapps.session nem BaileysKeys: a volta
// para o Baileys depende deles intactos.

// Evento `connection` mais velho que isso é replay (api parada, consumer
// atrasado): não pode reabrir QR nem reconectar por si; no lugar dele vale o
// GET /sessions/{id} (refreshFromGateway).
export const CONNECTION_MAX_AGE_MS = 10 * 60 * 1000;
// Logout pedido por nós (Desconectar, Novo QR, número em uso, exclusão): o
// logged_out que o gateway publica em seguida não deve abrir QR.
const EXPECTED_LOGOUT_MS = 2 * 60 * 1000;
// Igual ao Baileys: novo QR 2 s depois do logout pelo celular.
const RELOGIN_DELAY_MS = 2000;

// Sem a coluna session: o motor whatsmeow nunca a lê.
const ATTRIBUTES = { exclude: ["session"] };

const timers = new Map<number, NodeJS.Timeout>();
const attempts = new Map<number, number>();
// Conexões que mostraram QR desde o último connected: só pareamento novo
// passa pela checagem de número em uso (como o `pairing` do wbot.ts).
const pairing = new Set<number>();
const expectedLogouts = new Map<number, number>();

const client = () => gatewayClient();

// O Whatsapp pode vir do controller com a coluna session (credenciais do
// Baileys): nunca vai para a sala da empresa.
const withoutSession = (whatsapp: Whatsapp): Record<string, unknown> => {
  const plain: Record<string, unknown> =
    typeof (whatsapp as any).toJSON === "function" ? { ...(whatsapp as any).toJSON() } : { ...(whatsapp as any) };
  delete plain.session;
  return plain;
};

const emitSession = (whatsapp: Whatsapp, payload: Record<string, unknown> = {}) => {
  getIO()
    .to(companyRoom(whatsapp.companyId))
    .emit(`company-${whatsapp.companyId}-whatsappSession`, { action: "update", session: withoutSession(whatsapp), ...payload });
};

const save = async (whatsapp: Whatsapp, values: Record<string, unknown>) => {
  await whatsapp.update(values);
  emitSession(whatsapp);
};

const load = async (id: number): Promise<Whatsapp | null> => Whatsapp.findByPk(id, { attributes: ATTRIBUTES });

const cancelTimer = (id: number) => {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
};

const schedule = (id: number, delayMs: number, run: () => Promise<unknown>) => {
  cancelTimer(id);
  const timer = setTimeout(() => {
    timers.delete(id);
    run().catch(err => logger.warn(`whatsmeow: tarefa agendada da conexão ${id} falhou: ${(err as Error)?.message || err}`));
  }, delayMs);
  timer.unref?.();
  timers.set(id, timer);
};

const expectLogout = (id: number) => expectedLogouts.set(id, Date.now() + EXPECTED_LOGOUT_MS);

// Não é consumido na leitura: o gateway pode publicar logged_out duas vezes
// para um logout só (resposta do Logout + evento LoggedOut do whatsmeow). Vale
// até expirar ou até o próximo qr/connected da conexão.
const isExpectedLogout = (id: number): boolean => {
  const until = expectedLogouts.get(id);
  if (until === undefined) return false;
  if (until >= Date.now()) return true;
  expectedLogouts.delete(id);
  return false;
};

const isNotFound = (err: unknown) => err instanceof AppError && err.message === "ERR_WAPP_NOT_INITIALIZED";

const errText = (err: unknown) => (err as Error)?.message || String(err);

// POST /logout tratando "sem sessão nem pareamento" (404) como sucesso.
const gatewayLogout = async (id: number): Promise<void> => {
  expectLogout(id);
  try {
    await client().logout(id);
  } catch (err) {
    // 404 = sem sessão nem pareamento: nenhum logged_out vai chegar.
    expectedLogouts.delete(id);
    if (!isNotFound(err)) throw err;
  }
};

/** Conexão lida/restaurada: mesmas regras do `open` do wbot.ts. */
const applyConnected = async (whatsapp: Whatsapp, me?: string): Promise<void> => {
  const { id } = whatsapp;
  cancelTimer(id);
  attempts.delete(id);
  const number = toPhoneNumber(me);

  // Número novo que já está conectado em outra conexão da empresa: recusado,
  // senão cada conversa aparece duas vezes.
  const freshPairing = pairing.delete(id);
  const twin =
    freshPairing && number
      ? await FindNumberInUseService(whatsapp, number, twinId => state.getStatus(twinId) === "connected")
      : null;
  if (twin) {
    logger.warn(`whatsmeow: número ${number} já conectado na conexão ${twin.id}; pareamento da conexão ${id} recusado`);
    state.setStatus(id, "disconnected");
    try {
      await gatewayLogout(id);
    } catch (err) {
      logger.warn(`whatsmeow: logout da conexão recusada ${id} falhou: ${errText(err)}`);
    }
    await save(whatsapp, { status: "DISCONNECTED", qrcode: "" });
    getIO()
      .to(companyRoom(whatsapp.companyId))
      .emit(`company-${whatsapp.companyId}-whatsappSession`, {
        action: "numberInUse",
        whatsappId: id,
        message: `Este número já está conectado na conexão "${twin.name}". Desconecte-a antes de usar o número aqui.`
      });
    return;
  }

  state.setStatus(id, "connected");
  await save(whatsapp, { status: "CONNECTED", qrcode: "", retries: 0, ...(number ? { number } : {}) });

  // Online no Wazzy = celular sem notificação (markOnlineOnConnect do Baileys).
  client()
    .setPresence(id, whatsapp.showOnline ? "available" : "unavailable")
    .catch(err => logger.warn(`whatsmeow: presença inicial da conexão ${id} falhou: ${errText(err)}`));

  // A própria conta; os pares LID<->telefone chegam pelos eventos lid_mapping.
  try {
    await SyncSessionContactsService({ whatsappId: id, companyId: whatsapp.companyId, me: { id: me } });
  } catch (err) {
    logger.warn(`whatsmeow: contatos da sessão ${id} não sincronizados: ${errText(err)}`);
  }
};

const scheduleRetry = (whatsapp: Whatsapp) => {
  const { id } = whatsapp;
  const attempt = attempts.get(id) || 0;
  const decision = reconnectDecision(undefined, attempt);
  const delayMs = decision.action === "reconnect" ? decision.delayMs : 60000;
  attempts.set(id, attempt + 1);
  logger.warn(`whatsmeow: connect da conexão ${id} falhou; nova tentativa em ${delayMs} ms (tentativa ${attempt + 1})`);
  schedule(id, delayMs, async () => {
    const fresh = await load(id);
    if (!fresh) return;
    const ok = await connectSession(fresh);
    // Gateway fora do ar: segue tentando com espera maior, a não ser que o
    // evento connect_failed desta mesma tentativa já tenha agendado a próxima.
    if (!ok && !timers.has(id)) scheduleRetry(fresh);
  });
};

const applyDisconnected = async (whatsapp: Whatsapp, reason?: string): Promise<void> => {
  const { id } = whatsapp;
  state.setStatus(id, "disconnected");
  // Sem motivo (queda de rede) o whatsmeow reconecta sozinho; shutdown = o
  // gateway está encerrando e restaura a sessão quando subir.
  if (!reason || reason === "shutdown") {
    await save(whatsapp, { status: "OPENING" });
    return;
  }
  // Com motivo a sessão saiu do gateway e não volta sozinha (decisão 3).
  pairing.delete(id);
  await save(whatsapp, { status: "DISCONNECTED", qrcode: "" });
  if (reason === "connect_failed") {
    // Nova tentativa já agendada (o caminho do timer contou esta falha): uma
    // contagem por tentativa.
    if (!timers.has(id)) scheduleRetry(whatsapp);
    return;
  }
  if (reason === "stream_replaced") {
    recordLog({
      level: "warn",
      source: "job",
      protocol: newProtocol(),
      code: "WA_STREAM_REPLACED",
      companyId: whatsapp.companyId,
      message: `Conexão "${whatsapp.name}" desconectada: outro cliente está usando esta conta do WhatsApp`,
      context: { connectionId: id, reason }
    });
  } else if (reason !== "timeout") {
    logger.warn(`whatsmeow: conexão ${id} desconectada pelo gateway (${reason})`);
  }
};

const applyLoggedOut = async (whatsapp: Whatsapp): Promise<void> => {
  const { id } = whatsapp;
  state.setStatus(id, "logged_out");
  pairing.delete(id);
  attempts.delete(id);
  // Logout pedido por nós: quem pediu já gravou o status.
  if (isExpectedLogout(id)) return;
  cancelTimer(id);
  // Logout pelo celular: igual ao Baileys, volta a pedir QR (decisão 4).
  await save(whatsapp, { status: "PENDING", qrcode: "" });
  schedule(id, RELOGIN_DELAY_MS, async () => {
    const fresh = await load(id);
    if (fresh) await connectSession(fresh);
  });
};

/** POST /connect e trata a resposta; false se o gateway não respondeu. */
const connectSession = async (whatsapp: Whatsapp): Promise<boolean> => {
  await save(whatsapp, { status: "OPENING" });
  let result: Status;
  try {
    result = await client().connect(whatsapp.id);
  } catch (err) {
    logger.warn(`whatsmeow: connect da conexão ${whatsapp.id} falhou: ${errText(err)}`);
    state.setStatus(whatsapp.id, "disconnected");
    await save(whatsapp, { status: "DISCONNECTED" });
    return false;
  }
  // Já conectada: o gateway não publica outro `connected`.
  if (result?.state === "connected") await applyConnected(whatsapp, result.me);
  else if (result?.state === "qr") pairing.add(whatsapp.id);
  else if (result?.state === "disconnected") {
    state.setStatus(whatsapp.id, "disconnected");
    await save(whatsapp, { status: "DISCONNECTED" });
  }
  // connecting/qr: os eventos `connection` atualizam.
  return true;
};

/** Botão "Tentar de novo" e conexão nova: OPENING + POST /connect (idempotente). */
const start = async (whatsapp: Whatsapp): Promise<boolean> => {
  cancelTimer(whatsapp.id);
  attempts.delete(whatsapp.id);
  return connectSession(whatsapp);
};

/** Conexão criada: o consumer passa a ler o stream antes do connect (para não perder o QR). */
const add = async (whatsapp: Whatsapp): Promise<boolean> => {
  await consumer.addConnection(whatsapp.id);
  return start(whatsapp);
};

/** "Novo QR": desparelha (404 ignorado) e conecta de novo. */
const restart = async (whatsapp: Whatsapp): Promise<boolean> => {
  cancelTimer(whatsapp.id);
  pairing.delete(whatsapp.id);
  await gatewayLogout(whatsapp.id);
  return start(whatsapp);
};

/** "Desconectar": POST /logout; o logged_out que chega depois não reabre QR. */
const logout = async (whatsapp: Whatsapp): Promise<void> => {
  cancelTimer(whatsapp.id);
  attempts.delete(whatsapp.id);
  pairing.delete(whatsapp.id);
  await gatewayLogout(whatsapp.id);
  state.setStatus(whatsapp.id, "logged_out");
  await save(whatsapp, { status: "DISCONNECTED", qrcode: "" });
};

/** Conexão excluída: desparelha no gateway e para de ler o stream. Não lança. */
const remove = async (connectionId: number): Promise<void> => {
  cancelTimer(connectionId);
  attempts.delete(connectionId);
  pairing.delete(connectionId);
  try {
    await gatewayLogout(connectionId);
  } catch (err) {
    logger.warn(`whatsmeow: logout da conexão excluída ${connectionId} falhou: ${errText(err)}`);
  }
  try {
    await consumer.removeConnection(connectionId);
  } catch (err) {
    logger.warn(`whatsmeow: consumer não largou a conexão ${connectionId}: ${errText(err)}`);
  }
  forgetConnection(connectionId);
  state.setStatus(connectionId, "logged_out");
};

// Um backlog de eventos atrasados da mesma conexão gera uma consulta só.
const REFRESH_THROTTLE_MS = 30 * 1000;
const lastRefresh = new Map<number, number>();

/** Aplica o GET /sessions/{id} sem efeitos de QR/reconexão (eventos atrasados). */
const refreshFromGateway = async (whatsapp: Whatsapp): Promise<void> => {
  const { id } = whatsapp;
  const last = lastRefresh.get(id);
  if (last !== undefined && Date.now() - last < REFRESH_THROTTLE_MS) return;
  lastRefresh.set(id, Date.now());
  let status: Status | null = null;
  try {
    status = await client().status(id);
  } catch (err) {
    if (!isNotFound(err)) {
      // Gateway fora: o health rebaixa o estado; os eventos corrigem na volta.
      logger.warn(`whatsmeow: estado da conexão ${id} indisponível: ${errText(err)}`);
      return;
    }
  }
  const gatewayState = status?.state;
  if (gatewayState === "connected") {
    if (whatsapp.status === "CONNECTED") state.setStatus(id, "connected");
    else await applyConnected(whatsapp, status?.me);
    return;
  }
  if (gatewayState === "connecting") {
    state.setStatus(id, "unknown");
    if (whatsapp.status === "CONNECTED") await save(whatsapp, { status: "OPENING" });
    return;
  }
  if (gatewayState === "qr") {
    // QR no ar no gateway: os eventos qr ao vivo atualizam o banco.
    state.setStatus(id, "qr");
    return;
  }
  // 404, logged_out ou disconnected: não está no ar. Sem abrir QR.
  state.setStatus(id, gatewayState === "logged_out" ? "logged_out" : "disconnected");
  if (whatsapp.status === "CONNECTED" || whatsapp.status === "qrcode") {
    await save(whatsapp, { status: "DISCONNECTED", qrcode: "" });
  }
};

/** Evento `connection` do stream (plugado nos handlers pelo consumer). */
const onConnection = async (connectionId: number, data: ConnectionData, ts?: number): Promise<void> => {
  const at = Number(ts);
  const stale = at > 0 && Date.now() - at > CONNECTION_MAX_AGE_MS;
  const whatsapp = await load(connectionId);
  if (!whatsapp) return;
  if (stale) {
    // Replay ou stream represado: o evento em si não reabre QR nem reconecta,
    // mas o estado real vem do gateway (um logged_out atrasado não pode deixar
    // a conexão "connected").
    logger.debug(`whatsmeow: connection ${data?.status} da conexão ${connectionId} com ${Math.round((Date.now() - at) / 1000)} s; reconsultando o gateway`);
    await refreshFromGateway(whatsapp);
    return;
  }

  switch (data?.status) {
    case "qr":
      expectedLogouts.delete(connectionId);
      pairing.add(connectionId);
      state.setStatus(connectionId, "qr");
      await save(whatsapp, { qrcode: data.qr || "", status: "qrcode", retries: 0 });
      return;
    case "pair_code":
      // Pareamento por código não tem tela: só registra.
      state.setStatus(connectionId, "pair_code");
      logger.info(`whatsmeow: código de pareamento gerado para a conexão ${connectionId}`);
      return;
    case "connected":
      expectedLogouts.delete(connectionId);
      await applyConnected(whatsapp, data.me);
      return;
    case "disconnected":
      await applyDisconnected(whatsapp, data.reason);
      return;
    case "logged_out":
      await applyLoggedOut(whatsapp);
      return;
    default:
      logger.debug(`whatsmeow: connection com status desconhecido ${data?.status} (conexão ${connectionId})`);
  }
};

const ACTIVE = new Set(["CONNECTED", "OPENING", "qrcode"]);

/**
 * Decisão 2: estado do gateway manda; só reconecta o que estava ativo (pareado
 * no gateway ou ainda não carregado por ele, 404).
 */
const reconcileOne = async (whatsapp: Whatsapp): Promise<void> => {
  const { id } = whatsapp;
  const wasActive = ACTIVE.has(whatsapp.status);
  let status: Status | null = null;
  try {
    status = await client().status(id);
  } catch (err) {
    if (!isNotFound(err)) {
      // Gateway fora do ar: não dá para saber; quando ele voltar, restaura as
      // pareadas e os eventos `connection` corrigem o status.
      logger.warn(`whatsmeow: estado da conexão ${id} indisponível no boot: ${errText(err)}`);
      state.setStatus(id, "unknown");
      if (wasActive && whatsapp.status !== "OPENING") await save(whatsapp, { status: "OPENING" });
      return;
    }
  }

  const gatewayState = status?.state;
  if (gatewayState === "connected") {
    await applyConnected(whatsapp, status?.me);
    return;
  }
  if (!status && wasActive) {
    // 404 de conexão que estava ativa: o gateway não carregou a sessão (ex.:
    // convertida pelo migrate-baileys, que só grava no banco). O connect é
    // idempotente: a pareada é restaurada; a sem pareamento mostra QR, como o
    // Baileys faria no boot.
    await connectSession(whatsapp);
    return;
  }
  if (gatewayState === "connecting" && wasActive) {
    // Pareada e sendo restaurada pelo gateway: connect é idempotente.
    await connectSession(whatsapp);
    return;
  }
  if (gatewayState === "connecting") {
    // Pareada, mas estava desligada aqui: o `connected` que vier atualiza.
    state.setStatus(id, "unknown");
    return;
  }
  if (gatewayState === "qr" && whatsapp.status === "qrcode") {
    // QR em andamento no gateway: os próximos eventos `qr` seguem atualizando.
    pairing.add(id);
    state.setStatus(id, "qr");
    return;
  }
  // 404 de conexão inativa, logged_out ou QR que ninguém pediu: sem abrir QR.
  state.setStatus(id, gatewayState === "logged_out" ? "logged_out" : "disconnected");
  if (whatsapp.status !== "DISCONNECTED" || whatsapp.qrcode) {
    await save(whatsapp, { status: "DISCONNECTED", qrcode: "" });
  }
};

const reconcileAll = async (whatsapps: Whatsapp[]): Promise<void> => {
  await Promise.all(
    whatsapps.map(w =>
      reconcileOne(w).catch(err => logger.error(`whatsmeow: reconciliação da conexão ${w.id} falhou: ${errText(err)}`))
    )
  );
};

/** StartAllWhatsAppsSessions de uma empresa no motor whatsmeow (sem mexer no consumer). */
const reconcileCompany = async (companyId: number): Promise<void> => {
  const whatsapps = await Whatsapp.findAll({ where: { companyId }, attributes: ATTRIBUTES });
  await reconcileAll(whatsapps);
};

const HEALTH_INTERVAL_MS = 30 * 1000;

/**
 * Gateway voltou a responder depois de falhar no health: o registro de estado
 * rebaixou as conexões e, se o gateway não reiniciou, nenhum `connected` novo
 * vai chegar. Reconfirma pelo GET /sessions/{id}; o resto fica com os eventos.
 */
const recoverAfterHealth = async (): Promise<void> => {
  const whatsapps = await Whatsapp.findAll({ attributes: ATTRIBUTES });
  await Promise.all(
    whatsapps.map(async whatsapp => {
      try {
        const status = await client().status(whatsapp.id);
        if (status?.state !== "connected") return;
        if (whatsapp.status === "CONNECTED") state.setStatus(whatsapp.id, "connected");
        else await applyConnected(whatsapp, status.me);
      } catch (err) {
        if (!isNotFound(err)) logger.warn(`whatsmeow: estado da conexão ${whatsapp.id} na volta do gateway: ${errText(err)}`);
      }
    })
  );
};

/** Boot com whatsmeow: consumer e health antes dos connect, depois a reconciliação. */
const reconcileOnBoot = async (): Promise<void> => {
  const whatsapps = await Whatsapp.findAll({ attributes: ATTRIBUTES, order: [["id", "ASC"]] });
  await consumer.startConsumer(
    whatsapps.map(w => w.id),
    { handle: env => handleEnvelope(env, { onConnection }) }
  );
  state.startHealthPoll(client(), HEALTH_INTERVAL_MS, recoverAfterHealth);
  await reconcileAll(whatsapps);
};

/** Desligamento gracioso: para o consumer (espera handlers) e o health. */
const shutdown = async (): Promise<void> => {
  timers.forEach(timer => clearTimeout(timer));
  timers.clear();
  state.stopHealthPoll();
  await consumer.stopConsumer();
};

// Só para testes.
const resetForTests = (): void => {
  timers.forEach(timer => clearTimeout(timer));
  timers.clear();
  attempts.clear();
  pairing.clear();
  expectedLogouts.clear();
  lastRefresh.clear();
};

const SessionService = {
  start,
  add,
  restart,
  logout,
  remove,
  onConnection,
  reconcileOnBoot,
  reconcileCompany,
  recoverAfterHealth,
  shutdown,
  resetForTests
};

export default SessionService;
