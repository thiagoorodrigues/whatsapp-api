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
import { sleep } from "../../helpers/botUtils";
import { SerialQueue, queueFor } from "../../helpers/serialQueue";
import { toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";
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

const handleMessage = async (msg: proto.IWebMessageInfo, wbot: Session, companyId: number): Promise<void> => {
  const inbound = await toInbound(msg, wbot, companyId);
  if (inbound) await ProcessInboundMessage(inbound);
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

    // Importação de histórico tem fila própria: um lote pode levar minutos
    // (2 s por mensagem) e não pode segurar as mensagens ao vivo.
    const historyQueue = new SerialQueue(`history-${wbot.id}`, {
      onError: err => logger.error(`history queue (whatsapp ${wbot.id}): ${err?.message || err}`),
      taskTimeoutMs: 60 * 60 * 1000
    });

    wbot.ev.on("messages.upsert", (messageUpsert: ImessageUpsert) => {
      const messages = messageUpsert.messages.filter(filterMessages);
      if (!messages.length) return;

      messages.forEach((message: proto.IWebMessageInfo) => queue.push(async () => {
        // Sent through the channel: already saved by whoever sent it.
        if (message.key.fromMe && wasSentByPlatform(message.key.id)) return;
        const messageExists = await Message.count({ where: { messagesWhatsappsId: message.key.id!, companyId } });
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

    wbot.ev.on("messages.update", (messageUpdate: WAMessageUpdate[]) => {
      if (messageUpdate.length === 0) return;
      messageUpdate.forEach(async (message: WAMessageUpdate) => {
        // Delivery/read status of a message we sent.
        if (message.update.status) {
          UpdateMessageAckService(message.key.id, message.update.status);
        }
      });
      // Received messages read on the phone ("read-self").
      const readOnPhone = messageUpdate
        .filter(m => m.key.fromMe === false && Number(m.update.status) >= 4 && m.key.id)
        .map(m => m.key.id!);
      MarkReadOnDeviceService(readOnPhone, companyId);
    });

    wbot.ev.on("message-receipt.update", async (messageUserReceiptUpdate: MessageUserReceiptUpdate[]) => {
      if (messageUserReceiptUpdate.length === 0) return;

      try {
        messageUserReceiptUpdate.forEach(async (message: { key: WAMessageKey, receipt: MessageUserReceipt }) => {
          const msg = await Message.findOne({ where: { messagesWhatsappsId: message.key?.id } });
          if (!isNil(msg)) {
            const ticket = await Ticket.findOne({ where: { id: msg.ticketId, companyId: companyId } });

            // Members only send receipts for our own messages, so a read
            // receipt for someone else's message means we read it.
            if (ticket && ticket.isGroup && !msg.fromMe) {
              if (message.receipt.readTimestamp) MarkReadOnDeviceService([message.key.id!], companyId);
            } else if (ticket && ticket.isGroup) {
              // One receipt per member: delivered (3) once someone got it,
              // read (4) once someone read it, played (5) for voice notes.
              // Never goes back.
              const { receipt } = message;
              const reached = receipt.playedTimestamp ? 5 : receipt.readTimestamp ? 4 : receipt.receiptTimestamp ? 3 : 2;
              const status = Math.max(Number(msg.ack) || 0, reached);
              if (status !== Number(msg.ack)) UpdateMessageAckService(message.key.id, status);
            }
          }
        });
      } catch (err) {
        logger.info(err);
      }
    });

    wbot.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => historyQueue.push(async () => {
      await saveSyncedContacts(contacts as SyncedContact[]);
      logger.info("Chamado para serviço de importação de messages;");

      const whatsapp = await ShowWhatsAppService(wbot.id!, companyId);

      const dateInitial = whatsapp.initialDate;
      const dateFinal = whatsapp.finalDate

      if (whatsapp.importMessages) {
        logger.info("Serviço de importação de messages iniciado;");

        const initialDate = dateInitial ? new Date(`${dateInitial} 00:00:00`).getTime() : null;
        const finalDate = dateFinal ? new Date(`${dateFinal} 23:59:59`).getTime() : null;

        logger.info(`Data inicial de importacao -> ${initialDate}`);
        logger.info(`Data final de importacao -> ${finalDate}`);

        const messageList = messages.filter(filterMessages).map(msg => msg);
        if (!messageList) return;

        if (initialDate && finalDate) {
          for (let message of messageList) {
            const messageTimestamp = Number(message.messageTimestamp) * 1000; // Assuming messageTimestamp is in seconds
            const messageExists = await Message.count({ where: { messagesWhatsappsId: message.key.id!, companyId } });

            if (!messageExists && messageTimestamp > initialDate && messageTimestamp < finalDate) {
              // logger.info(message.key.remoteJid);
              // logger.info(timeConverter(Number(message.messageTimestamp)));
              await handleMessage(message, wbot, companyId);
              await sleep(2000); // 2 seconds sleep
            }
          }
        } else if (initialDate && !finalDate) {
          for (let message of messageList) {
            const messageTimestamp = Number(message.messageTimestamp) * 1000; // Assuming messageTimestamp is in seconds
            const messageExists = await Message.count({ where: { messagesWhatsappsId: message.key.id!, companyId } });

            if (!messageExists && messageTimestamp > initialDate) {
              // logger.info(message.key.remoteJid);
              // logger.info(timeConverter(Number(message.messageTimestamp)));
              await handleMessage(message, wbot, companyId);
              await sleep(2000); // 2 seconds sleep
            }
          }
        } else {
          logger.info("Não há datas selecionadas.");
        }

        //logger.info("Serviço de importação de messages finalizado;");
      }
    }));

  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Error handling wbot message listener. Err: ${error}`);
  }
};

export { wbotMessageListener, handleMessage };
