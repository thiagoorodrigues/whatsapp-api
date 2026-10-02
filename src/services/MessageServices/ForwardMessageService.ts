import fs from "fs";
import path from "path";
import mime from "mime-types";
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import uploadConfig from "../../config/upload";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { getTicketChannel, ticketAddress, OutgoingContent } from "../../channels";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import SaveSentMessageService from "./SaveSentMessageService";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { getIO } from "../../libs/socket";
import { notificationRoom, statusRoom, ticketRoom } from "../../libs/socketRooms";

export const MAX_FORWARD_CONTACTS = 5;

interface Request {
  messageId: string;
  contactIds: number[];
  companyId: number;
  userId: number;
}

interface Result {
  contactId: number;
  ticketId?: number;
  ok: boolean;
}

// "company1/1727470000_ab12cd_boleto.pdf" -> "boleto.pdf"
const originalName = (stored: string): string =>
  path.basename(stored).replace(/^\d+_[0-9a-f]{12}_?/, "") || path.basename(stored);

/**
 * What goes out again: the text, or the stored file (image, video, audio,
 * document) with its caption. The body of a file without caption is its
 * name, so it is not sent as caption.
 */
const contentOf = (message: Message): { content: OutgoingContent; media?: { buffer: Buffer; mimetype: string; fileName: string } } => {
  const stored: string | null = message.getDataValue("mediaUrl");
  const body = `${message.body || ""}`;

  if (!stored) {
    if (!body.trim()) throw new AppError("ERR_FORWARD_EMPTY_MESSAGE");
    return { content: { type: "text", text: body } };
  }

  const filePath = path.join(uploadConfig.directory, stored);
  if (!fs.existsSync(filePath)) throw new AppError("ERR_FORWARD_MEDIA_NOT_FOUND", 404);
  const buffer = fs.readFileSync(filePath);
  const mimetype = (mime.lookup(filePath) || "application/octet-stream") as string;
  const fileName = originalName(stored);
  const caption = body && body !== fileName && body !== path.basename(stored) ? body : undefined;
  const kind = mimetype.split("/")[0];

  let content: OutgoingContent;
  if (message.mediaType === "audio" || kind === "audio") {
    content = { type: "audio", buffer, mimetype, voice: true };
  } else if (message.mediaType === "image" || kind === "image") {
    content = { type: "image", buffer, caption };
  } else if (message.mediaType === "video" || kind === "video") {
    content = { type: "video", buffer, caption, fileName };
  } else {
    content = { type: "document", buffer, caption, fileName, mimetype };
  }
  return { content, media: { buffer, mimetype, fileName } };
};

/**
 * Forwards a stored message to other contacts, each in its own ticket (the
 * latest one on the same connection, reopened for the user when closed or
 * waiting; a new one when there is none). Goes out marked as forwarded.
 */
const ForwardMessageService = async ({ messageId, contactIds, companyId, userId }: Request): Promise<Result[]> => {
  const ids = Array.from(new Set((contactIds || []).map(Number).filter(Boolean)));
  if (!ids.length) throw new AppError("ERR_FORWARD_NO_CONTACTS");
  if (ids.length > MAX_FORWARD_CONTACTS) throw new AppError("ERR_FORWARD_TOO_MANY_CONTACTS");

  const message = await Message.findOne({
    where: { id: messageId, companyId },
    include: [{ model: Ticket, as: "ticket", attributes: ["id", "whatsappId"] }]
  });
  if (!message || message.isDeleted) throw new AppError("ERR_NO_MESSAGE_FOUND", 404);
  if (message.isPrivate) throw new AppError("ERR_INTERNAL_NOTE_ACTION");

  const { content, media } = contentOf(message);
  const whatsappId = message.ticket.whatsappId;

  const results: Result[] = [];
  for (const contactId of ids) {
    try {
      const contact = await Contact.findOne({ where: { id: contactId, companyId } });
      if (!contact) {
        results.push({ contactId, ok: false });
        continue;
      }
      let ticket = await FindOrCreateTicketService(contact, whatsappId, 0, companyId, contact.isGroup ? contact : undefined);
      // Plain update, not UpdateTicketService: accepting a ticket there
      // may send the greeting message.
      if (ticket.status !== "open") {
        const oldStatus = ticket.status;
        await ticket.update({ status: "open", userId });
        ticket = await ShowTicketService(ticket.id, companyId);
        const io = getIO();
        io.to(statusRoom(companyId, oldStatus)).emit(`company-${companyId}-ticket`, { action: "delete", ticketId: ticket.id });
        io.to(statusRoom(companyId, "open")).to(notificationRoom(companyId)).to(ticketRoom(companyId, ticket.id.toString()))
          .emit(`company-${companyId}-ticket`, { action: "update", ticket });
      }

      const channel = await getTicketChannel(ticket);
      const sent = await channel.send(ticketAddress(ticket), content, { forwarded: true });
      const caption = "caption" in content ? content.caption : content.type === "text" ? content.text : undefined;
      await SaveSentMessageService({ ticket, sent, body: caption, media, forwarded: true });
      results.push({ contactId, ticketId: ticket.id, ok: true });
    } catch (err) {
      Sentry.captureException(err);
      results.push({ contactId, ok: false });
    }
  }
  return results;
};

export default ForwardMessageService;
