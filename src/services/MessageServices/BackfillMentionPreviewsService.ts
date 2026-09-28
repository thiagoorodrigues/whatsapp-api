import { Op } from "sequelize";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { previewWithMentions } from "../../helpers/mentions";
import ResolveMentionsService from "./ResolveMentionsService";

/**
 * Ticket list previews saved before mentions got names still show
 * "@1407...". Rewrites those that are the text of the ticket's last
 * message. Returns how many were changed.
 */
const BackfillMentionPreviewsService = async (): Promise<number> => {
  const tickets = await Ticket.findAll({
    where: { lastMessage: { [Op.regexp]: "@[0-9]{5,}" } },
    attributes: ["id", "companyId", "lastMessage"]
  });

  let changed = 0;
  for (const ticket of tickets) {
    const last = await Message.findOne({
      where: { ticketId: ticket.id },
      attributes: ["id", "body", "dataJson"],
      order: [["createdAt", "DESC"]]
    });
    if (!last) continue;

    await ResolveMentionsService([last], ticket.companyId);
    const preview = previewWithMentions(ticket.lastMessage, last.body, last.mentions);
    if (preview) {
      await ticket.update({ lastMessage: preview });
      changed += 1;
    }
  }
  return changed;
};

export default BackfillMentionPreviewsService;
