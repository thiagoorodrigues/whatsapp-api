import { v4 as uuid } from "uuid";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import CreateMessageService from "./CreateMessageService";

interface Request {
  ticket: Ticket;
  body: string;
  userId: number;
}

/**
 * Saves a note only the team sees. It never goes through the WhatsApp
 * channel: no WhatsApp id, no ack, and the ticket preview stays as it was.
 */
const CreateInternalNoteService = async ({ ticket, body, userId }: Request): Promise<Message> => {
  const text = `${body || ""}`.trim();
  if (!text) throw new AppError("ERR_INTERNAL_NOTE_EMPTY");

  return CreateMessageService({
    companyId: ticket.companyId,
    messageData: {
      id: uuid(),
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: text,
      fromMe: true,
      read: true,
      ack: 0,
      mediaType: "internalNote",
      isPrivate: true,
      userId
    }
  });
};

export default CreateInternalNoteService;
