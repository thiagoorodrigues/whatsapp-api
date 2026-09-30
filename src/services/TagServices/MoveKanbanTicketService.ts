import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";

interface Request {
  ticketId: number | string;
  tagId: number | string | null;
  companyId: number;
}

// Moves a ticket to one Kanban column: drops every Kanban tag it has and adds
// the target one. A null tagId sends it back to "Em aberto" (no Kanban tag).
// Tags that are not shown on the Kanban stay untouched.
const MoveKanbanTicketService = async ({
  ticketId,
  tagId,
  companyId
}: Request): Promise<void> => {
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  if (tagId !== null) {
    const tag = await Tag.findOne({ where: { id: tagId, companyId, kanban: 1 } });
    if (!tag) {
      throw new AppError("ERR_NO_TAG_FOUND", 404);
    }
  }

  const kanbanTags = await Tag.findAll({
    where: { companyId, kanban: 1 },
    attributes: ["id"]
  });

  await TicketTag.sequelize!.transaction(async transaction => {
    await TicketTag.destroy({
      where: { ticketId: ticket.id, tagId: kanbanTags.map(t => t.id) },
      transaction
    });
    if (tagId !== null) {
      await TicketTag.create({ ticketId: ticket.id, tagId }, { transaction });
    }
  });
};

export default MoveKanbanTicketService;
