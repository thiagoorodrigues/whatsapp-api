import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";

interface Request {
  tags: Tag[];
  ticketId: number;
  companyId: number;
}

// Tags of other companies sent in the body are dropped, not linked.
const SyncTags = async ({
  tags,
  ticketId,
  companyId
}: Request): Promise<Ticket | null> => {
  const ticket = await Ticket.findOne({
    where: { id: ticketId, companyId },
    include: [Tag]
  });
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const allowed = await Tag.findAll({
    where: { id: (tags || []).map(t => t.id), companyId },
    attributes: ["id"]
  });

  const tagList = allowed.map(t => ({ tagId: t.id, ticketId: ticket.id }));

  await TicketTag.destroy({ where: { ticketId: ticket.id } });
  await TicketTag.bulkCreate(tagList);

  await ticket.reload();

  return ticket;
};

export default SyncTags;
