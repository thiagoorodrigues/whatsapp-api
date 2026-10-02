import * as Sentry from "@sentry/node";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import { logger } from "../../utils/logger";
import { ticketRoom } from "../../libs/socketRooms";

/**
 * Delivery status of a message (1 sent, 2 server, 3 delivered, 4 read,
 * 5 played), by its id on the channel. The id alone is not unique: the same
 * number paired on two connections has a copy on each.
 */
const UpdateMessageAckService = async (externalId: string, ack: number | null | undefined, whatsappId: number): Promise<void> => {
  if (!externalId || !ack) return;
  // The message may still be being saved.
  await new Promise(r => setTimeout(r, 500));

  try {
    const message = await Message.findOne({
      where: { messagesWhatsappsId: externalId, whatsappId },
      include: ["contact", { model: Message, as: "quotedMsg", include: ["contact"] }]
    });
    if (!message) return;
    await message.update({ ack });

    getIO()
      .to(ticketRoom(message.companyId, message.ticketId.toString()))
      .emit(`company-${message.companyId}-appMessage`, { action: "update", message });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

export default UpdateMessageAckService;
