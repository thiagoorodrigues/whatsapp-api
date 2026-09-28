import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import ResolveMentionsService from "./ResolveMentionsService";
import { previewWithMentions } from "../../helpers/mentions";

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
}
interface Request {
  messageData: MessageData;
  companyId: number;
}

const CreateMessageService = async ({ messageData: data, companyId }: Request): Promise<Message> => {
  // A message saved when sent and again from the WhatsApp echo keeps one
  // row: the second save updates the first.
  let messageData = data;
  if (data.messagesWhatsappsId) {
    const existing = await Message.findOne({
      where: { messagesWhatsappsId: data.messagesWhatsappsId, companyId },
      attributes: ["id"]
    });
    if (existing && existing.id !== data.id) messageData = { ...data, id: existing.id };
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
      }
    ]
  });

  if (message.ticket.queueId !== null && message.queueId === null) {
    await message.update({ queueId: message.ticket.queueId });
  }

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  await ResolveMentionsService([message], companyId);
  // The ticket list shows "@Maria", not the digits of the mention.
  const preview = previewWithMentions(message.ticket.lastMessage, message.body, message.mentions);
  if (preview) await message.ticket.update({ lastMessage: preview });

  const io = getIO();
  io.to(message.ticketId.toString())
    .to(message.ticket.status)
    .to("notification")
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });

  return message;
};

export default CreateMessageService;
