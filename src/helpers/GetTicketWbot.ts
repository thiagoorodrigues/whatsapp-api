import { WASocket } from "@whiskeysockets/baileys";
import { getWbot } from "../libs/wbot";
import Ticket from "../models/Ticket";
import GetDefaultWhatsAppByUser from "./GetDefaultWhatsAppByUser";

type Session = WASocket & {
  id?: number;
};

const GetTicketWbot = async (ticket: Ticket): Promise<Session> => {
  if (!ticket.whatsappId) {
    const defaultWhatsapp = await GetDefaultWhatsAppByUser(ticket.user.id);

    await ticket.$set("whatsapp", defaultWhatsapp);
  }

  const wbot = getWbot(ticket.whatsappId);
  return wbot;
};

export default GetTicketWbot;
