import { subHours } from "date-fns";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";

interface TicketData {
  status?: string;
  companyId?: number;
  unreadMessages?: number;
}

const FindOrCreateTicketService = async (contact: Contact, whatsappId: number, unreadMessages: number, companyId: number, groupContact?: Contact): Promise<Ticket> => {
  let ticket = await Ticket.findOne({
    where: {
      status: {
        [Op.or]: ["open", "pending", "closed"]
      },
      contactId: groupContact ? groupContact.id : contact.id,
      companyId,
      whatsappId
    },
    order: [["id", "DESC"]]
  });

  console.log(ticket?.id);

  if (!!ticket) {
    await ticket.update({ unreadMessages, whatsappId });
  }

  if (!!ticket && ticket?.status === "closed") {
    await ticket.update({ queueId: null, userId: null });
  }

  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId }
  });

  if (!ticket) {
    ticket = await Ticket.create({
      contactId: !!groupContact ? groupContact.id : contact.id,
      status: "pending",
      isGroup: !!groupContact,
      unreadMessages,
      whatsappId,
      whatsapp,
      companyId
    });

    await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId,
      userId: ticket.userId
    });
  }

  if (!contact.isGroup && ticket.isGroup) {
    // ticket.update({ isGroup: false });
  }

  ticket = await ShowTicketService(ticket.id, companyId);
  return ticket;
};

export default FindOrCreateTicketService;
