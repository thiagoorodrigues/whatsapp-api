import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";

interface Request {
  ticketId: number | string;
  companyId: number;
}

// Takes the ticket off the Kanban board; tags not shown there stay.
const RemoveKanbanTicketTagsService = async ({
  ticketId,
  companyId
}: Request): Promise<void> => {
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const kanbanTags = await Tag.findAll({
    where: { companyId, kanban: 1 },
    attributes: ["id"]
  });

  await TicketTag.destroy({
    where: { ticketId: ticket.id, tagId: kanbanTags.map(t => t.id) }
  });
};

export default RemoveKanbanTicketTagsService;
