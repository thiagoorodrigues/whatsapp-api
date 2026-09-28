import {
  WASocket,
  BinaryNode,
  Contact as BContact,
} from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";

import { Op } from "sequelize";
// import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import { getChannel } from "../../channels";
import { isLidJid, toUserLid } from "../../helpers/GetPhoneJid";

type Session = WASocket & {
  id?: number;
};

interface IContact {
  contacts: BContact[];
}

const wbotMonitor = async (
  wbot: Session,
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  try {
    wbot.ws.on("CB:call", async (node: BinaryNode) => {
      const content = node.content[0] as any;

      if (content.tag === "offer") {
        const { from, id } = node.attrs;

      }

      if (content.tag === "terminate") {
        const sendMsgCall = await Setting.findOne({
          where: { key: "call", companyId },
        });

        if (sendMsgCall?.value === "disabled") {
          const { from } = node.attrs;
          const callWarning =
            "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado";

          // Calls come from a LID or a phone JID.
          const userLid = isLidJid(from) ? toUserLid(from) : undefined;
          const contact = await Contact.findOne({
            where: userLid ? { companyId, lid: userLid } : { companyId, number: from.replace(/\D/g, "") }
          });

          const ticket = contact
            ? await Ticket.findOne({
              where: {
                contactId: contact.id,
                whatsappId: wbot.id,
                companyId
              },
              include: ["contact"]
            })
            : null;

          if (ticket) {
            await SendTicketMessageService(ticket, { type: "text", text: callWarning });
          } else {
            await getChannel(wbot.id).send({ jid: from }, { type: "text", text: callWarning });
          }

          // se não existir o ticket não faz nada.
          if (!ticket) return;

          const date = new Date();
          const hours = date.getHours();
          const minutes = date.getMinutes();

          const body = `Chamada de voz/vídeo perdida às ${hours}:${minutes}`;
          const messageData = {
            id: content.attrs["call-id"],
            ticketId: ticket.id,
            contactId: contact.id,
            body,
            fromMe: false,
            mediaType: "call_log",
            read: true,
            quotedMsgId: null,
            ack: 1,
          };

          await ticket.update({
            lastMessage: body,
          });


          if(ticket.status === "closed") {
            await ticket.update({
              status: "pending",
            });
          }

          return CreateMessageService({ messageData, companyId: companyId });
        }
      }
    });


  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};

export default wbotMonitor;
