import * as Sentry from "@sentry/node";
import { v4 as uuid } from "uuid";
import { InboundMessage } from "../../channels/inbound";
import formatBody from "../../helpers/Mustache";
import { saveCompanyMedia } from "../../helpers/mediaStorage";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import { logger } from "../../utils/logger";
import CreateMessageService from "../MessageServices/CreateMessageService";
import UpdateMessageService from "../MessageServices/UpdateMessageService";

// A customer writing again reopens a closed ticket as pending.
const reopenIfClosed = async (ticket: Ticket) => {
  if (ticket.status !== "closed") return;
  const io = getIO();
  await ticket.update({ status: "pending" });
  await ticket.reload({
    include: [
      { model: Queue, as: "queue" },
      { model: User, as: "user" },
      { model: Contact, as: "contact" }
    ]
  });
  io.to("closed").emit(`company-${ticket.companyId}-ticket`, { action: "delete", ticket, ticketId: ticket.id });
  io.to(ticket.status)
    .to(ticket.id.toString())
    .emit(`company-${ticket.companyId}-ticket`, { action: "update", ticket, ticketId: ticket.id });
};

const storeMedia = async (inbound: InboundMessage, ticket: Ticket) => {
  const media = inbound.loadMedia ? await inbound.loadMedia() : null;
  if (!media) return { media: null, path: null };
  try {
    return { media, path: await saveCompanyMedia(ticket.companyId, media.data, media.fileName, media.mimetype) };
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Could not store received media for ticket ${ticket.id}: ${err}`);
    return { media, path: null };
  }
};

/**
 * Saves a received message (or one sent from the phone) in the ticket. An
 * edit updates the message it replaces.
 */
const SaveInboundMessageService = async (
  inbound: InboundMessage,
  ticket: Ticket,
  contact: Contact
): Promise<Message> => {
  const quotedMsg = inbound.quotedExternalId
    ? await Message.findOne({ where: { messagesWhatsappsId: inbound.quotedExternalId } })
    : null;

  const base = {
    id: uuid(),
    ticketId: ticket.id,
    contactId: inbound.fromMe ? undefined : contact.id,
    fromMe: inbound.fromMe,
    read: inbound.fromMe,
    quotedMsgId: quotedMsg?.id,
    // Our own messages typed on the phone reached the server already.
    ack: inbound.fromMe ? 2 : (inbound.raw as any)?.status,
    remoteJid: inbound.chat.jid,
    participant: (inbound.raw as any)?.key?.participant,
    dataJson: JSON.stringify(inbound.raw),
    createdAt: new Date(inbound.timestamp).toISOString()
  };

  let saved: Message;
  if (inbound.hasMedia) {
    const { media, path } = await storeMedia(inbound, ticket);
    const fileName = media?.fileName || (path ? path.split("/").pop() : "");
    const body = inbound.text ? formatBody(inbound.text, ticket.contact) : fileName;
    await ticket.update({ lastMessage: body || fileName });
    saved = await CreateMessageService({
      companyId: ticket.companyId,
      messageData: {
        ...base,
        messagesWhatsappsId: inbound.externalId,
        body,
        mediaUrl: path || undefined,
        mediaType: (media?.mimetype || inbound.kind).split("/")[0]
      }
    });
  } else {
    const messageData = {
      ...base,
      messagesWhatsappsId: inbound.editOf || inbound.externalId,
      body: inbound.text,
      mediaType: inbound.channelType,
      isEdited: !!inbound.editOf
    };
    await ticket.update({ lastMessage: inbound.text });
    if (inbound.editOf) {
      await UpdateMessageService({ messageData, companyId: ticket.companyId });
      saved = null;
    } else {
      saved = await CreateMessageService({ messageData, companyId: ticket.companyId });
    }
  }

  if (!inbound.fromMe) await reopenIfClosed(ticket);
  return saved;
};

export default SaveInboundMessageService;
