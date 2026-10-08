import AppError from "../../errors/AppError";
import { getTicketChannel, messageRef, ticketAddress } from "../../channels";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { applyReaction } from "./ReactToMessageService";

interface Request {
  messageId: string | number;
  companyId: number;
  /** Empty removes our reaction. */
  emoji: string;
}

/**
 * Reacts to a message from the ticket's connection. Stored right away as
 * "me", like the reactions the phone makes, so the panel does not depend on
 * the echo.
 */
const SendReactionService = async ({ messageId, companyId, emoji }: Request): Promise<Message> => {
  const text = `${emoji || ""}`.trim();
  if (text.length > 16) throw new AppError("ERR_INVALID_REACTION");

  const message = await Message.findOne({
    where: { id: messageId, companyId },
    include: [
      { model: Ticket, as: "ticket", include: ["contact", "user"] },
      "contact",
      { model: Message, as: "quotedMsg", include: ["contact"] }
    ]
  });
  if (!message) throw new AppError("ERR_NO_MESSAGE_FOUND", 404);
  if (message.isPrivate) throw new AppError("ERR_INTERNAL_NOTE_ACTION");
  if (message.isDeleted || !message.messagesWhatsappsId) throw new AppError("ERR_REACT_WAPP_MSG");

  try {
    const channel = await getTicketChannel(message.ticket);
    await channel.react(ticketAddress(message.ticket), messageRef(message), text);
  } catch (err) {
    logger.warn(`Reaction to message ${message.id} failed: ${err}`);
    throw new AppError("ERR_REACT_WAPP_MSG");
  }

  return applyReaction(message, { emoji: text, jid: "me", fromMe: true, at: Date.now() });
};

export default SendReactionService;
