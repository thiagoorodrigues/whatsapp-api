import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";

interface Request {
  ticketId: number | string;
  tagId: number | string;
  companyId: number;
}

const AddTicketTagService = async ({
  ticketId,
  tagId,
  companyId
}: Request): Promise<TicketTag> => {
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const tag = await Tag.findOne({ where: { id: tagId, companyId } });
  if (!tag) {
    throw new AppError("ERR_NO_TAG_FOUND", 404);
  }

  return TicketTag.create({ ticketId: ticket.id, tagId: tag.id });
};

export default AddTicketTagService;
