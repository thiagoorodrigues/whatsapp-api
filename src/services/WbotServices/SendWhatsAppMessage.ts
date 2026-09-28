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
  /** Jids of the group members mentioned (see ListGroupParticipantsService). */
  mentions?: string[];
}

const SendWhatsAppMessage = async ({ body, ticket, quotedMsg, ratingMsg, closeTicket = true, mentions }: Request): Promise<Message> => {
  const channel = await getTicketChannel(ticket);

  let quoted;
  if (quotedMsg) {
    const stored = await Message.findOne({ where: { id: quotedMsg.id } });
    if (stored?.messagesWhatsappsId) quoted = messageRef(stored);
  }

  try {
    const text = formatBody(body, ticket.contact);
    // Only members of the group can be mentioned.
    let mentioned: string[] = [];
    if (ticket.isGroup && mentions?.length) {
      const members = new Set((await channel.groupParticipants(ticketAddress(ticket))).map(p => p.jid));
      mentioned = mentions.filter(jid => members.has(jid));
    }
    const content = mentioned.length ? { type: "text" as const, text, mentions: mentioned } : { type: "text" as const, text };
    const sent = await channel.send(ticketAddress(ticket), content, { quoted });
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
