import AppError from "../../errors/AppError";
import { getTicketChannel, messageRef, ticketAddress } from "../../channels";
import GetWbotMessage from "../../helpers/GetWbotMessage";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

const DeleteWhatsAppMessage = async (messageId: string): Promise<Message> => {
  const message = await Message.findByPk(messageId, {
    include: [
      {
        model: Ticket,
        as: "ticket",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new AppError("No message found with this ID.");
  }

  // Internal notes never went to WhatsApp.
  if (message.isPrivate) {
    throw new AppError("ERR_INTERNAL_NOTE_ACTION");
  }

  const { ticket } = message;

  const messageToDelete = await GetWbotMessage(ticket, messageId);

  try {
    const channel = await getTicketChannel(ticket);
    await channel.deleteMessage(ticketAddress(ticket), messageRef(messageToDelete));
  } catch (err) {
    throw new AppError("ERR_DELETE_WAPP_MSG");
  }
  await message.update({ isDeleted: true });

  return message;
};

export default DeleteWhatsAppMessage;
