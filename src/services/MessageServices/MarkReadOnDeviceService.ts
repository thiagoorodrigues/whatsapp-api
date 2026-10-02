import { Op } from "sequelize";
import { cacheLayer } from "../../libs/cache";
import { unreadsKey } from "../../helpers/unreadsKey";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";

/**
 * Received messages read on the phone or another linked device: like on
 * WhatsApp, everything up to the newest one read is read in the ticket too.
 */
const MarkReadOnDeviceService = async (externalIds: string[], companyId: number, whatsappId: number): Promise<void> => {
  if (!externalIds.length) return;
  try {
    const read = await Message.findAll({
      where: { messagesWhatsappsId: { [Op.in]: externalIds }, fromMe: false, companyId, whatsappId },
      attributes: ["ticketId", "createdAt"]
    });

    const newest = new Map<number, Date>();
    read.forEach(m => {
      const at = newest.get(m.ticketId);
      if (!at || m.createdAt > at) newest.set(m.ticketId, m.createdAt);
    });

    await Promise.all(
      [...newest].map(async ([ticketId, upTo]) => {
        await Message.update(
          { read: true },
          { where: { ticketId, fromMe: false, read: false, createdAt: { [Op.lte]: upTo } } }
        );
        const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
        if (!ticket) return;

        const unread = await Message.count({
          where: { ticketId, fromMe: false, read: false, isPrivate: false, createdAt: { [Op.gt]: upTo } }
        });
        if (unread >= ticket.unreadMessages) return;

        await ticket.update({ unreadMessages: unread });
        await cacheLayer.set(unreadsKey(ticket.contactId, ticket.whatsappId), `${unread}`);
        if (unread === 0) {
          getIO().to(ticket.status).to("notification").emit(`company-${companyId}-ticket`, {
            action: "updateUnread",
            ticketId: ticket.id
          });
        }
      })
    );
  } catch (err) {
    logger.warn(`Could not apply reads from the phone: ${err}`);
  }
};

export default MarkReadOnDeviceService;
