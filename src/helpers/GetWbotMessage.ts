import Ticket from "../models/Ticket";
import { getTicketChannel } from "../channels";
import AppError from "../errors/AppError";
import GetMessageService from "../services/MessageServices/GetMessagesService";
import Message from "../models/Message";

export const GetWbotMessage = async (
  ticket: Ticket,
  messageId: string
): Promise<Message> => {
  // Fails when the ticket's connection has no live session.
  await getTicketChannel(ticket);

  let limit = 20;

  const fetchWbotMessagesGradually = async (): Promise<Message | null | undefined> => {
      const msgFound = await GetMessageService({
        id: messageId
      });

      return msgFound;


  };

  try {
    const msgFound = await fetchWbotMessagesGradually();

    if (!msgFound) {
      throw new Error("Cannot found message within 100 last messages");
    }

    return msgFound;
  } catch (err) {
    throw new AppError("ERR_FETCH_WAPP_MSG");
  }
};

export default GetWbotMessage;
