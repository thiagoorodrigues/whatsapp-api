import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";
import ResolveMentionsService from "./ResolveMentionsService";
import { previewWithMentions } from "../../helpers/mentions";
import { notificationRoom, statusRoom, ticketRoom } from "../../libs/socketRooms";

interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  ack?: number;
  queueId?: number;
  createdAt?: string;
  messagesWhatsappsId?: string;
  quotedMsgId?: string;
  remoteJid?: string | null;
  participant?: string | null;
  dataJson?: string | null;
  isEdited?: boolean;
  isForwarded?: boolean;
  isPrivate?: boolean;
  userId?: number;
  /** Connection of the message; taken from the ticket when left out. */
  whatsappId?: number;
  /** Sent by a follow-up rule. */
  followUpEnrollmentId?: number | null;
}
interface Request {
  messageData: MessageData;
  companyId: number;
}

const CreateMessageService = async ({ messageData: data, companyId }: Request): Promise<Message> => {
  const whatsappId = data.whatsappId ?? (await Ticket.findByPk(data.ticketId, { attributes: ["whatsappId"] }))?.whatsappId;

  // A message saved when sent and again from the WhatsApp echo keeps one
  // row: the second save updates the first. Per connection: the same number
  // on another connection keeps its own copy.
  let messageData: MessageData = { ...data, whatsappId };
  if (data.messagesWhatsappsId) {
    const existing = await Message.findOne({
      where: { messagesWhatsappsId: data.messagesWhatsappsId, companyId, whatsappId: whatsappId ?? null },
      attributes: ["id"]
    });
    if (existing && existing.id !== data.id) messageData = { ...messageData, id: existing.id };
  }

  await Message.upsert({ ...messageData, companyId });

  const message = await Message.findByPk(messageData.id, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          "contact",
          "queue",
          {
            model: Whatsapp,
            as: "whatsapp",
            attributes: ["name"]
          }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      },
      { model: User, as: "user", attributes: ["id", "name"] }
    ]
  });

  if (message.ticket.queueId !== null && message.queueId === null) {
    await message.update({ queueId: message.ticket.queueId });
  }

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  await ResolveMentionsService([message], companyId);
  // The ticket list shows "@Maria", not the digits of the mention. An
  // internal note is not part of the conversation with the customer.
  if (!message.isPrivate) {
    const preview = previewWithMentions(message.ticket.lastMessage, message.body, message.mentions);
    if (preview) await message.ticket.update({ lastMessage: preview });
  }

  const io = getIO();
  io.to(ticketRoom(companyId, message.ticketId.toString()))
    .to(statusRoom(companyId, message.ticket.status))
    .to(notificationRoom(companyId))
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });

  return message;
};

export default CreateMessageService;
