import { WAMessage } from "@whiskeysockets/baileys";
import { getContactJid } from "../../helpers/GetPhoneJid";
import WALegacySocket from "@whiskeysockets/baileys"
import * as Sentry from "@sentry/node";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

import formatBody from "../../helpers/Mustache";
import { logger } from "../../utils/logger";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
  ratingMsg?: boolean;
  closeTicket?: boolean
}

const SendWhatsAppMessage = async ({ body, ticket, quotedMsg, ratingMsg, closeTicket = true }: Request): Promise<WAMessage> => {
  let options = {};
  const wbot = await GetTicketWbot(ticket);
  let number = getContactJid(ticket.contact, ticket.isGroup);

  if (quotedMsg) {
    const chatMessages = await Message.findOne({
      where: {
        id: quotedMsg.id
      }
    });

    if (chatMessages) {
      const msgFound = JSON.parse(chatMessages.dataJson);
      options = {
        quoted: {
          key: msgFound.key,
          message: {
            extendedTextMessage: msgFound.message.extendedTextMessage
          }
        }
      };
    }
  }

  try {

    if (ticket.isGroup) {
      let metadata = Object.keys(await wbot.groupFetchAllParticipating());
      metadata.forEach(item => {
        const position = item.indexOf("-");
        if (position > 0) {
          if (item.replace('-', '') === number) {
            number = `${number.substr(0, position)}-${number.substr(position)}`
          }
        }
      })

      if (!metadata.includes(number)) throw 'Group not found';
    }

    const sentMessage = await wbot.sendMessage(number, { text: formatBody(body, ticket.contact) }, { ...options });

    if (!closeTicket)
      return sentMessage;

    if (!!ratingMsg)
      await ticket.update({ lastMessage: formatBody(body, ticket.contact), status: 'closed' });
    else
      await ticket.update({ lastMessage: formatBody(body, ticket.contact) });

    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};



export default SendWhatsAppMessage;
