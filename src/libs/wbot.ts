import * as Sentry from "@sentry/node";
import makeWASocket, {
  WASocket,
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  CacheStore,
  proto,
  WAMessageKey,
  WAMessageContent
} from "@whiskeysockets/baileys";
import makeWALegacySocket from "@whiskeysockets/baileys";
import P from "pino";

import Whatsapp from "../models/Whatsapp";
import { clearBaileysKeys } from "../models/BaileysKey";
import Message from "../models/Message";
import { logger } from "../utils/logger";
import MAIN_LOGGER from "@whiskeysockets/baileys/lib/Utils/logger";
import authState from "../helpers/authState";
import { reconnectDecision } from "../helpers/reconnectPolicy";
import { toPhoneNumber } from "../helpers/GetPhoneJid";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import NodeCache from 'node-cache';
import { cachedGroupMetadata } from "./whatsappCache";
import CheckSettings from "../helpers/CheckSettings";
import FindNumberInUseService from "../services/WhatsappService/FindNumberInUseService";
import { companyRoom } from "./socketRooms";

const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = "error";

type Session = WASocket & {
  id?: number;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();
// Quedas seguidas por conexão; zera quando a conexão abre.
const reconnectAttempts = new Map<number, number>();
// Conexões que mostraram QR e ainda não abriram. Depois da leitura o WhatsApp
// derruba o socket (515) e a conexão abre num socket novo, já sem QR.
const pairing = new Set<number>();

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

// Timer de reconexão pendente por conexão: no máximo um.
const reconnectTimers = new Map<number, NodeJS.Timeout>();

const cancelReconnect = (whatsappId: number): void => {
  const timer = reconnectTimers.get(whatsappId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(whatsappId);
};

const scheduleReconnect = (whatsapp: Whatsapp, delayMs: number): void => {
  cancelReconnect(whatsapp.id);
  reconnectTimers.set(
    whatsapp.id,
    setTimeout(() => {
      reconnectTimers.delete(whatsapp.id);
      StartWhatsAppSession(whatsapp, whatsapp.companyId);
    }, delayMs)
  );
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    cancelReconnect(whatsappId);
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      if (isLogout) {
        sessions[sessionIndex].logout();
        sessions[sessionIndex].ws.close();
      }

      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};

// Fecha um socket antigo da mesma conexão sem disparar a reconexão dele,
// para que nunca existam dois sockets pareados com as mesmas credenciais.
const discardWbot = (whatsappId: number): void => {
  cancelReconnect(whatsappId);
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
  if (sessionIndex === -1) return;
  const stale = sessions[sessionIndex];
  sessions.splice(sessionIndex, 1);
  try {
    stale.ev.removeAllListeners("connection.update");
    stale.ws.close();
  } catch (err) {
    logger.warn(`Could not close stale socket ${whatsappId}: ${err}`);
  }
};

export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise(async (resolve, reject) => {
    try {
      (async () => {
        const io = getIO();
        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) return;

        const { id, name, provider } = whatsappUpdate;
        discardWbot(id);

        const { version, isLatest } = await fetchLatestBaileysVersion();
        const isLegacy = provider === "stable" ? true : false;

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`isLegacy: ${isLegacy}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;
        const { state, saveState } = await authState(whatsapp);

        const msgRetryCounterCache = new NodeCache();
        const userDevicesCache: CacheStore = new NodeCache();

        wsocket = makeWASocket({
          logger: loggerBaileys,
          printQRInTerminal: false,
          // Baileys 6.7.24: "Desktop" browser identifiers combined with
          // syncFullHistory are closed by WhatsApp with 428 before the QR.
          browser: Browsers.ubuntu("Chrome"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
          },
          syncFullHistory: true,
          version,
          // Só o que difere dos padrões do Baileys 7 (keepAlive 30 s e
          // transactionOpts 10x3 s já são o padrão): mais tempo para abrir a
          // conexão numa rede lenta e um pouco mais de espaço entre retentativas.
          connectTimeoutMs: 30000,
          retryRequestDelayMs: 350,
          msgRetryCounterCache,
          generateHighQualityLinkPreview: true,
          shouldIgnoreJid: jid => isJidBroadcast(jid),
          markOnlineOnConnect: !!whatsappUpdate.showOnline,
          cachedGroupMetadata: cachedGroupMetadata(id),
          getMessage
        });

        async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
          // Baileys 6.7.17+ no longer ships an in-memory store. Messages are
          // already persisted with their raw payload in Message.dataJson, so
          // retries read the original content from the database.
          try {
            const stored = await Message.findOne({
              where: { messagesWhatsappsId: key.id!, whatsappId: id },
              attributes: ["dataJson"]
            });
            if (stored?.dataJson) {
              const parsed = JSON.parse(stored.dataJson);
              return parsed?.message || undefined;
            }
          } catch (err) {
            logger.warn(`getMessage lookup failed for ${key.id}: ${err}`);
          }

          return proto.Message.create({});
        }

        // wsocket = makeWASocket({
        //   version,
        //   logger: loggerBaileys,
        //   printQRInTerminal: false,
        //   auth: state as AuthenticationState,
        //   generateHighQualityLinkPreview: false,
        //   shouldIgnoreJid: jid => isJidBroadcast(jid),
        //   browser: ["Chat", "Chrome", "10.15.7"],
        //   patchMessageBeforeSending: (message) => {
        //     const requiresPatch = !!(
        //       message.buttonsMessage ||
        //       // || message.templateMessage
        //       message.listMessage
        //     );
        //     if (requiresPatch) {
        //       message = {
        //         viewOnceMessage: {
        //           message: {
        //             messageContextInfo: {
        //               deviceListMetadataVersion: 2,
        //               deviceListMetadata: {},
        //             },
        //             ...message,
        //           },
        //         },
        //       };
        //     }

        //     return message;
        //   },
        // })

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            const disconnectError = lastDisconnect?.error as Boom | undefined;
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${
                disconnectError
                  ? `status=${disconnectError.output?.statusCode} ${disconnectError.message}`
                  : ""
              }`
            );

            if (connection === "close") {
              const statusCode = disconnectError?.output?.statusCode;
              const attempt = reconnectAttempts.get(id) || 0;
              const decision = reconnectDecision(statusCode, attempt);
              if (disconnectError?.data) {
                logger.warn(`Session ${name} close reason: ${JSON.stringify(disconnectError.data)}`);
              }
              removeWbot(id, false);

              if (decision.action === "logout") {
                // Sessão encerrada pelo WhatsApp: limpa tudo e volta a pedir QR.
                logger.warn(`Session ${name} closed for good (status=${statusCode}); a new QR is needed`);
                await whatsapp.update({ status: "PENDING", session: "" });
                await clearBaileysKeys(whatsapp.id);
                await DeleteBaileysService(whatsapp.id);
                io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
                reconnectAttempts.delete(id);
                scheduleReconnect(whatsapp, 2000);
              } else {
                reconnectAttempts.set(id, attempt + 1);
                logger.warn(
                  `Session ${name} closed (status=${statusCode}); reconnecting in ${decision.delayMs} ms (attempt ${attempt + 1})`
                );
                scheduleReconnect(whatsapp, decision.delayMs);
              }
            }

            if (connection === "open") {
              reconnectAttempts.delete(id);
              // user.id is "5531...:<device>@s.whatsapp.net"; keep the digits.
              const connectedNumber = toPhoneNumber(wsocket.user?.id);

              // Número novo que já está conectado em outra conexão da empresa:
              // recusado, senão cada conversa aparece duas vezes.
              const freshPairing = pairing.delete(id);
              const twin = freshPairing && connectedNumber
                ? await FindNumberInUseService(whatsapp, connectedNumber, twinId => sessions.some(s => s.id === twinId))
                : null;
              if (twin) {
                logger.warn(`Session ${name}: número ${connectedNumber} já conectado na conexão ${twin.id}; pareamento recusado`);
                wsocket.ev.removeAllListeners("connection.update");
                try {
                  await wsocket.logout();
                } catch (err) {
                  logger.warn(`Could not log out refused session ${name}: ${err}`);
                }
                removeWbot(id, false);
                await whatsapp.update({ status: "DISCONNECTED", session: "", qrcode: "" });
                await clearBaileysKeys(whatsapp.id);
                await DeleteBaileysService(whatsapp.id);
                io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, { action: "update", session: whatsapp });
                io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "numberInUse",
                  whatsappId: whatsapp.id,
                  message: `Este número já está conectado na conexão "${twin.name}". Desconecte-a antes de usar o número aqui.`
                });
                reject(new AppError("ERR_WAPP_NUMBER_IN_USE"));
                return;
              }
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0,
                ...(connectedNumber ? { number: connectedNumber } : {})
              });

              io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                action: "update",
                session: whatsapp
              });

              const sessionIndex = sessions.findIndex(
                s => s.id === whatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = whatsapp.id;
                sessions.push(wsocket);
              }

              // Online no WeConex = celular sem notificação. Desfaz um
              // "available" que tenha ficado de antes.
              if (!whatsappUpdate.showOnline) {
                wsocket.sendPresenceUpdate("unavailable").catch(err =>
                  logger.warn(`Could not set ${name} unavailable: ${err}`)
                );
              }

              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await DeleteBaileysService(whatsappUpdate.id);
                io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsappUpdate
                });
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
                // Sem isto o socket morto fica em `sessions` e a próxima
                // tentativa de conexão nunca é registrada.
                removeWbot(id, false);
                reconnectAttempts.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                pairing.add(id);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                io.to(companyRoom(whatsapp.companyId)).emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });
              }
            }
          }
        );
        wsocket.ev.on("creds.update", saveState);
      })();
    } catch (error) {
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
