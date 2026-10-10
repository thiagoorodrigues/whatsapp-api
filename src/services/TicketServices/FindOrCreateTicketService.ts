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

// history: message imported from the chat history. It does not change the
// unread count, and a conversation known only from the history is filed as
// closed instead of waiting for someone in the queue, dated by its message
// (`at`) and kept out of the reports (no tracking row: it was not attended here).
const FindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  companyId: number,
  groupContact?: Contact,
  history = false,
  at?: Date,
  historyStatus: "closed" | "pending" = "closed"
): Promise<Ticket> => {
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

  if (!!ticket && !history) {
    await ticket.update({ unreadMessages, whatsappId });
  }

  if (!!ticket && ticket?.status === "closed" && !history) {
    await ticket.update({ queueId: null, userId: null });
  }

  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId }
  });

  if (!ticket) {
    const data = {
      contactId: !!groupContact ? groupContact.id : contact.id,
      status: history ? historyStatus : "pending",
      isGroup: !!groupContact,
      unreadMessages: history ? 0 : unreadMessages,
      whatsappId,
      whatsapp,
      companyId
    };
    ticket = history && at
      ? await Ticket.create({ ...data, createdAt: at, updatedAt: at } as any, { silent: true })
      : await Ticket.create(data as any);

    if (!history) {
      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId,
        userId: ticket.userId
      });
    }
  }

  if (!contact.isGroup && ticket.isGroup) {
    // ticket.update({ isGroup: false });
  }

  ticket = await ShowTicketService(ticket.id, companyId);
  return ticket;
};

export default FindOrCreateTicketService;
