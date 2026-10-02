import * as Sentry from "@sentry/node";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import { logger } from "../../utils/logger";

interface Request {
  companyId: number;
  /** Connection that saw the reaction: each one keeps its own copy. */
  whatsappId: number;
  /** Id on the channel of the message reacted to. */
  externalId: string;
  /** Who reacted ("me" for the connection's own account). */
  jid: string;
  fromMe: boolean;
  /** Empty removes that person's reaction. */
  emoji: string;
  at: number;
}

/**
 * A reaction goes on the message it reacts to, never as a new message. Each
 * person has at most one: a new emoji replaces theirs.
 */
const ReactToMessageService = async ({ companyId, whatsappId, externalId, jid, fromMe, emoji, at }: Request): Promise<void> => {
  if (!externalId || !jid) return;

  try {
    const message = await Message.findOne({
      where: { messagesWhatsappsId: externalId, companyId, whatsappId },
      include: ["contact", { model: Message, as: "quotedMsg", include: ["contact"] }]
    });
    if (!message) return;

    const others = (message.reactions || []).filter(r => r.jid !== jid);
    const reactions = emoji ? [...others, { emoji, jid, fromMe, at }] : others;
    await message.update({ reactions: reactions.length ? reactions : null });

    getIO()
      .to(message.ticketId.toString())
      .emit(`company-${message.companyId}-appMessage`, { action: "update", message });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message reaction. Err: ${err}`);
  }
};

export default ReactToMessageService;
