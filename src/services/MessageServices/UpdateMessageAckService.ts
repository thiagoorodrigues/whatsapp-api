import * as Sentry from "@sentry/node";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import { logger } from "../../utils/logger";

/**
 * Delivery status of a message (1 sent, 2 server, 3 delivered, 4 read,
 * 5 played), by its id on the channel.
 */
const UpdateMessageAckService = async (externalId: string, ack: number | null | undefined): Promise<void> => {
  if (!externalId || !ack) return;
  // The message may still be being saved.
  await new Promise(r => setTimeout(r, 500));

  try {
    const message = await Message.findOne({
      where: { messagesWhatsappsId: externalId },
      include: ["contact", { model: Message, as: "quotedMsg", include: ["contact"] }]
    });
    if (!message) return;
    await message.update({ ack });

    getIO()
      .to(message.ticketId.toString())
      .emit(`company-${message.companyId}-appMessage`, { action: "update", message });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

export default UpdateMessageAckService;
