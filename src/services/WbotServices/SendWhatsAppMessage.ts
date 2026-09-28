import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { getTicketChannel, messageRef, ticketAddress } from "../../channels";
import SaveSentMessageService from "../MessageServices/SaveSentMessageService";

import formatBody from "../../helpers/Mustache";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
  ratingMsg?: boolean;
  closeTicket?: boolean
}

const SendWhatsAppMessage = async ({ body, ticket, quotedMsg, ratingMsg, closeTicket = true }: Request): Promise<Message> => {
  const channel = await getTicketChannel(ticket);

  let quoted;
  if (quotedMsg) {
    const stored = await Message.findOne({ where: { id: quotedMsg.id } });
    if (stored?.messagesWhatsappsId) quoted = messageRef(stored);
  }

  try {
    const text = formatBody(body, ticket.contact);
    const sent = await channel.send(ticketAddress(ticket), { type: "text", text }, { quoted });
    const saved = await SaveSentMessageService({ ticket, sent, body: text, quotedMsgId: quotedMsg?.id });

    if (closeTicket && !!ratingMsg)
      await ticket.update({ status: 'closed' });

    return saved;
  } catch (err) {
    Sentry.captureException(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
