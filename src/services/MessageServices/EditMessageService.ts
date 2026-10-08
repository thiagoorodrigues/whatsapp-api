import AppError from "../../errors/AppError";
import { getTicketChannel, messageRef, ticketAddress } from "../../channels";
import { getIO } from "../../libs/socket";
import { ticketRoom } from "../../libs/socketRooms";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";

/** WhatsApp only accepts edits for 15 minutes after sending. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

const TEXT_TYPES = ["conversation", "extendedTextMessage"];

// "*Name:*\n" the panel puts before the attendant's text.
const SIGNATURE = /^\*[^*\n]+:\*\n/;

interface Request {
  messageId: string | number;
  companyId: number;
  /** New text, without the signature (kept from the original). */
  body: string;
}

/** Edits a text message sent by this account, on WhatsApp and in the panel. */
const EditMessageService = async ({ messageId, companyId, body }: Request): Promise<Message> => {
  const text = `${body || ""}`.trim();
  if (!text) throw new AppError("ERR_EDIT_EMPTY");

  const message = await Message.findOne({
    where: { id: messageId, companyId },
    include: [
      { model: Ticket, as: "ticket", include: ["contact", "user"] },
      "contact",
      { model: Message, as: "quotedMsg", include: ["contact"] }
    ]
  });
  if (!message) throw new AppError("ERR_NO_MESSAGE_FOUND", 404);
  if (
    !message.fromMe ||
    message.isDeleted ||
    message.isPrivate ||
    message.mediaUrl ||
    !TEXT_TYPES.includes(message.mediaType) ||
    !message.messagesWhatsappsId
  ) {
    throw new AppError("ERR_EDIT_NOT_ALLOWED");
  }
  if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
    throw new AppError("ERR_EDIT_WINDOW");
  }

  const signature = `${message.body || ""}`.match(SIGNATURE)?.[0] || "";
  const newBody = `${signature}${text}`;
  if (newBody === message.body) return message;

  try {
    const channel = await getTicketChannel(message.ticket);
    await channel.edit(ticketAddress(message.ticket), messageRef(message), newBody);
  } catch (err) {
    logger.warn(`Edit of message ${message.id} failed: ${err}`);
    throw new AppError("ERR_EDIT_WAPP_MSG");
  }

  const oldBody = message.body;
  await message.update({ body: newBody, isEdited: true });
  if (message.ticket.lastMessage === oldBody) await message.ticket.update({ lastMessage: newBody });

  getIO()
    .to(ticketRoom(companyId, message.ticketId.toString()))
    .emit(`company-${companyId}-appMessage`, { action: "update", message });
  return message;
};

export default EditMessageService;
