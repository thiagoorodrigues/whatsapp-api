import * as Sentry from "@sentry/node";
import { v4 as uuid } from "uuid";
import { SentMessage } from "../../channels";
import { uploadToS3 } from "../../config/uploadAws";
import { cacheLayer } from "../../libs/cache";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
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
}

const mediaFileName = (media: SentMedia) => {
  const ext = media.mimetype.split("/")[1]?.split(";")[0] || "bin";
  const name = (media.fileName || "").replace(/[^\w.\-]+/g, "_").slice(-100);
  return name ? `${Date.now()}_${name}` : `${Date.now()}.${ext}`;
};

/**
 * Saves a message the platform sent to a ticket's contact. Its echo from
 * WhatsApp is ignored (see channels/baileys/sentByPlatform), so this is
 * where it gets into the ticket, like the echo used to do.
 */
const SaveSentMessageService = async ({ ticket, sent, body, media, quotedMsgId }: Request): Promise<Message> => {
  let mediaUrl: string | undefined;
  if (media) {
    mediaUrl = mediaFileName(media);
    try {
      await uploadToS3(media.buffer, mediaUrl);
    } catch (err) {
      Sentry.captureException(err);
      logger.error(`Could not store sent media ${mediaUrl}: ${err}`);
    }
  }

  const text = body || mediaUrl || "";
  await ticket.update({ lastMessage: text, fromMe: true });
  await cacheLayer.set(`contacts:${ticket.contactId}:unreads`, "0");

  return CreateMessageService({
    companyId: ticket.companyId,
    messageData: {
      id: uuid(),
      messagesWhatsappsId: sent.externalId || undefined,
      ticketId: ticket.id,
      body: text,
      fromMe: true,
      read: true,
      mediaType: media ? media.mimetype.split("/")[0] : "extendedTextMessage",
      mediaUrl,
      ack: 1,
      quotedMsgId,
      remoteJid: sent.chatJid,
      dataJson: sent.raw ? JSON.stringify(sent.raw) : null,
      isAws: !!media
    }
  });
};

export default SaveSentMessageService;
