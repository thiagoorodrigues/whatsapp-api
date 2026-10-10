import * as Sentry from "@sentry/node";
import { isNil } from "lodash";
import {
  MessageUserReceipt,
  MessageUserReceiptUpdate,
  proto,
  WAMessage,
  WAMessageKey,
  WAMessageUpdate,
  WASocket
} from "@whiskeysockets/baileys";
import { wasSentByPlatform } from "../../channels/baileys/sentByPlatform";
import { filterMessages } from "../../channels/baileys/parse";
import toInbound from "../../channels/baileys/toInbound";
import { queueFor } from "../../helpers/serialQueue";
import { toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";
import { handlePresenceUpdate } from "../TicketServices/ContactTypingService";
import { forgetGroup } from "../../libs/whatsappCache";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import MarkReadOnDeviceService from "../MessageServices/MarkReadOnDeviceService";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import {
  verifyRecentCampaign
} from "../InboundServices/CampaignReplyService";
import ProcessInboundMessage from "../InboundServices/ProcessInboundMessage";
import ReactToMessageService from "../MessageServices/ReactToMessageService";
import UpdateMessageAckService from "../MessageServices/UpdateMessageAckService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { createHistoryImporter, importDay } from "./historyImport";
import { publishImportProgress } from "../../libs/historyImportProgress";
import FinishHistoryImportService from "../WhatsappService/FinishHistoryImportService";
import UpsertWhatsappContactsService, { SyncedContact } from "../WhatsappContactServices/UpsertWhatsappContactsService";

// WhatsApp Web (Baileys) events of a connection. Messages are turned into the
// channel-neutral InboundMessage (channels/baileys/toInbound) and handled by
// services/InboundServices; nothing here knows about tickets or bots.

type Session = WASocket & {
  id?: number;
};

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: string;
}

const handleMessage = async (msg: proto.IWebMessageInfo, wbot: Session, companyId: number, history = false): Promise<void> => {
  const inbound = await toInbound(msg, wbot, companyId);
  if (inbound) await ProcessInboundMessage({ ...inbound, history });
};

const wbotMessageListener = async (wbot: Session, companyId: number): Promise<void> => {
  try {
    // Mensagens são processadas uma por vez, na ordem, por conexão: sem
    // corrida entre a checagem de duplicidade e a gravação, e sem picos de
    // consultas numa rajada de grupo.
    const queue = queueFor(wbot.id, {
      onError: err => {
        Sentry.captureException(err);
        logger.error(`messages queue (whatsapp ${wbot.id}): ${err?.message || err}`);
      },
      onBacklog: size => logger.warn(`messages queue (whatsapp ${wbot.id}) has ${size} pending`)
    });


    wbot.ev.on("messages.upsert", (messageUpsert: ImessageUpsert) => {
      const messages = messageUpsert.messages.filter(filterMessages);
      if (!messages.length) return;

      messages.forEach((message: proto.IWebMessageInfo) => queue.push(async () => {
        // Sent through the channel: already saved by whoever sent it.
        if (message.key.fromMe && wasSentByPlatform(wbot.id, message.key.id)) return;
        const messageExists = await Message.count({ where: { messagesWhatsappsId: message.key.id!, whatsappId: wbot.id } });
        if (messageExists) return;

        const inbound = await toInbound(message, wbot, companyId);
        if (!inbound) return;
        await ProcessInboundMessage(inbound);
        await verifyRecentCampaign(inbound);
      }));
    });

    // Reactions go on the message reacted to. Same queue as messages, so a
    // reaction right after its message finds it saved.
    wbot.ev.on("messages.reaction", reactions => reactions.forEach(({ key, reaction }) => queue.push(async () => {
      const from = reaction.key;
      await ReactToMessageService({
        companyId,
        whatsappId: wbot.id,
        externalId: key?.id,
        jid: from?.fromMe ? "me" : from?.participant || from?.remoteJid,
        fromMe: !!from?.fromMe,
        emoji: reaction.text || "",
        at: Number(reaction.senderTimestampMs || 0) || Date.now()
      });
    })));

    // Baileys 7 reports every phone <-> LID pair it discovers; remember it on
    // the contact so sends go to the LID and LID-only messages (e.g. sent
    // from another linked device) land on the same contact.
    wbot.ev.on("lid-mapping.update", async ({ pn, lid }) => {
      try {
        const number = toPhoneNumber(pn);
        const userLid = toUserLid(lid);
        if (!userLid || !number) return;
        await Contact.update({ lid: userLid }, { where: { number, companyId } });
        await saveSyncedContacts([{ id: `${number}@s.whatsapp.net`, lid: userLid }]);
      } catch (err) {
        logger.warn(`lid-mapping.update failed for ${lid}: ${err}`);
      }
    });

    // Contacts WhatsApp sends (address book and profile names): kept per
    // connection to show names in group mentions and for "Importar contatos".
    const saveSyncedContacts = async (contacts: SyncedContact[] | undefined) => {
      if (!contacts?.length) return;
      try {
        await UpsertWhatsappContactsService({ whatsappId: wbot.id, companyId, contacts });
      } catch (err) {
        logger.warn(`Could not save WhatsApp contacts: ${err}`);
      }
    };
    wbot.ev.on("contacts.upsert", contacts => saveSyncedContacts(contacts as SyncedContact[]));
    wbot.ev.on("contacts.update", contacts => saveSyncedContacts(contacts.filter(c => c.id) as SyncedContact[]));

    // Group name, description or members changed: fetch them again.
    wbot.ev.on("groups.update", updates => updates.forEach(update => update.id && forgetGroup(wbot.id, update.id)));
    wbot.ev.on("group-participants.update", ({ id }) => forgetGroup(wbot.id, id));

    // Contact typing or recording audio, for the open conversation.
    wbot.ev.on("presence.update", update =>
      handlePresenceUpdate(companyId, wbot.id, update).catch(err => logger.debug(`presence.update: ${err}`))
    );

    wbot.ev.on("messages.update", (messageUpdate: WAMessageUpdate[]) => {
      if (messageUpdate.length === 0) return;
      messageUpdate.forEach(async (message: WAMessageUpdate) => {
        // Delivery/read status of a message we sent.
        if (message.update.status) {
          UpdateMessageAckService(message.key.id, message.update.status, wbot.id);
        }
      });
      // Received messages read on the phone ("read-self").
      const readOnPhone = messageUpdate
        .filter(m => m.key.fromMe === false && Number(m.update.status) >= 4 && m.key.id)
        .map(m => m.key.id!);
      MarkReadOnDeviceService(readOnPhone, companyId, wbot.id);
    });

    wbot.ev.on("message-receipt.update", async (messageUserReceiptUpdate: MessageUserReceiptUpdate[]) => {
      if (messageUserReceiptUpdate.length === 0) return;

      try {
        messageUserReceiptUpdate.forEach(async (message: { key: WAMessageKey, receipt: MessageUserReceipt }) => {
          const msg = await Message.findOne({ where: { messagesWhatsappsId: message.key?.id, whatsappId: wbot.id } });
          if (!isNil(msg)) {
            const ticket = await Ticket.findOne({ where: { id: msg.ticketId, companyId: companyId } });

            // Members only send receipts for our own messages, so a read
            // receipt for someone else's message means we read it.
            if (ticket && ticket.isGroup && !msg.fromMe) {
              if (message.receipt.readTimestamp) MarkReadOnDeviceService([message.key.id!], companyId, wbot.id);
            } else if (ticket && ticket.isGroup) {
              // One receipt per member: delivered (3) once someone got it,
              // read (4) once someone read it, played (5) for voice notes.
              // Never goes back.
              const { receipt } = message;
              const reached = receipt.playedTimestamp ? 5 : receipt.readTimestamp ? 4 : receipt.receiptTimestamp ? 3 : 2;
              const status = Math.max(Number(msg.ack) || 0, reached);
              if (status !== Number(msg.ack)) UpdateMessageAckService(message.key.id, status, wbot.id);
            }
          }
        });
      } catch (err) {
        logger.info(err);
      }
    });

    // O histórico chega em lotes logo após a leitura do QR Code. Os lotes vão
    // para uma fila própria (um lote pode levar minutos e não pode segurar as
    // mensagens ao vivo); a opção só é desligada com a fila vazia e ociosa.
    const history = createHistoryImporter<WAMessage>({
      load: async () => {
        const conn = await ShowWhatsAppService(wbot.id!, companyId);
        return {
          importMessages: !!conn.importMessages,
          initialDate: importDay(conn.initialDate),
          finalDate: importDay(conn.finalDate)
        };
      },
      exists: async id => (await Message.count({ where: { messagesWhatsappsId: id, whatsappId: wbot.id } })) > 0,
      handle: message => handleMessage(message, wbot, companyId, true),
      finish: () => FinishHistoryImportService(wbot.id!, companyId),
      log: line => logger.info(`importação de histórico (whatsapp ${wbot.id}): ${line}`),
      report: progress => publishImportProgress(wbot.id!, companyId, progress)
    });
    wbot.ev.on("connection.update", ({ connection }) => {
      if (connection === "close") history.cancel();
    });

    wbot.ev.on("messaging-history.set", ({ contacts, messages, progress }) => {
      history.onBatch(messages.filter(filterMessages), () => saveSyncedContacts(contacts as SyncedContact[]), progress);
    });
    wbot.ev.on("messaging-history.status", ({ status }) => {
      if (status === "complete") history.receivedAll();
    });

  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Error handling wbot message listener. Err: ${error}`);
  }
};

export { wbotMessageListener, handleMessage };
