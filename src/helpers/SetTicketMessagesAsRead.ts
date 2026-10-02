import { cacheLayer } from "../libs/cache";
import { unreadsKey } from "./unreadsKey";
import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import { logger } from "../utils/logger";
import { getTicketChannel, messageRef, ticketAddress } from "../channels";

const SetTicketMessagesAsRead = async (ticket: Ticket): Promise<void> => {
  await ticket.update({ unreadMessages: 0 });
  // Incoming messages count from this cache; left as is, the next message
  // brings back every message already read.
  await cacheLayer.set(unreadsKey(ticket.contactId, ticket.whatsappId), "0");

  const unread = await Message.findAll({
    where: {
      ticketId: ticket.id,
      fromMe: false,
      read: false
    },
    attributes: ["id", "messagesWhatsappsId", "remoteJid", "participant", "fromMe", "dataJson"],
    order: [["createdAt", "DESC"]],
    limit: 100
  });

  // Read in the system even when WhatsApp can't be told.
  await Message.update(
    { read: true },
    {
      where: {
        ticketId: ticket.id,
        read: false
      }
    }
  );

  const received = unread.filter(m => m.messagesWhatsappsId);
  if (received.length) {
    try {
      const channel = await getTicketChannel(ticket);
      await channel.markRead(ticketAddress(ticket), received.map(messageRef));
    } catch (err) {
      logger.warn(
        `Could not send read receipts for ticket ${ticket.id}. Maybe whatsapp session disconnected? Err: ${err}`
      );
    }
  }

  const io = getIO();
  io.to(ticket.status).to("notification").emit(`company-${ticket.companyId}-ticket`, {
    action: "updateUnread",
    ticketId: ticket.id
  });
};

export default SetTicketMessagesAsRead;
