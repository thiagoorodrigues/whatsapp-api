import * as Sentry from "@sentry/node";
import { v4 as uuid } from "uuid";
import { SentMessage } from "../../channels";
import { cacheLayer } from "../../libs/cache";
import { unreadsKey } from "../../helpers/unreadsKey";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { saveCompanyMedia } from "../../helpers/mediaStorage";
import CreateMessageService from "./CreateMessageService";

export interface SentMedia {
  buffer: Buffer;
  mimetype: string;
  fileName?: string;
}

interface Request {
  ticket: Ticket;
  sent: SentMessage;
  /** Text shown in the ticket (the caption, for media). */
  body?: string;
  media?: SentMedia;
  quotedMsgId?: string;
  /** Went out marked as forwarded. */
  forwarded?: boolean;
  /** Sent by a follow-up rule. */
  followUpEnrollmentId?: number;
}

/**
 * Saves a message the platform sent to a ticket's contact (media goes to
 * the company's folder on the server). Its echo from
 * WhatsApp is ignored (see channels/baileys/sentByPlatform), so this is
 * where it gets into the ticket, like the echo used to do.
 */
const SaveSentMessageService = async ({ ticket, sent, body, media, quotedMsgId, forwarded, followUpEnrollmentId }: Request): Promise<Message> => {
  let mediaUrl: string | undefined;
  if (media) {
    try {
      mediaUrl = await saveCompanyMedia(ticket.companyId, media.buffer, media.fileName || "", media.mimetype);
    } catch (err) {
      Sentry.captureException(err);
      logger.error(`Could not store sent media for ticket ${ticket.id}: ${err}`);
    }
  }

  const text = body || media?.fileName || mediaUrl || "";
  await ticket.update({ lastMessage: text, fromMe: true });
  await cacheLayer.set(unreadsKey(ticket.contactId, ticket.whatsappId), "0");

  return CreateMessageService({
    companyId: ticket.companyId,
    messageData: {
      id: uuid(),
      messagesWhatsappsId: sent.externalId || undefined,
      ticketId: ticket.id,
      whatsappId: ticket.whatsappId,
      body: text,
      fromMe: true,
      read: true,
      mediaType: media ? media.mimetype.split("/")[0] : "extendedTextMessage",
      mediaUrl,
      ack: 1,
      quotedMsgId,
      remoteJid: sent.chatJid,
      dataJson: sent.raw ? JSON.stringify(sent.raw) : null,
      isForwarded: !!forwarded,
      followUpEnrollmentId: followUpEnrollmentId ?? null
    }
  });
};

export default SaveSentMessageService;
