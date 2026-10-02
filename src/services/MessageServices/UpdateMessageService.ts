import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import ResolveMentionsService from "./ResolveMentionsService";
import { previewWithMentions } from "../../helpers/mentions";

interface MessageData {
    id: string;
    messagesWhatsappsId: string;
    ticketId: number;
    body: string;
    contactId?: number;
    fromMe?: boolean;
    read?: boolean;
    mediaType?: string;
    mediaUrl?: string;
    ack?: number;
    queueId?: number;
    createdAt?: string
}
interface Request {
    messageData: MessageData;
    companyId: number;
    /** Connection that got the edit: each one keeps its own copy. */
    whatsappId: number;
}

const UpdateMessageService = async ({ messageData, companyId, whatsappId }: Request): Promise<Message> => {

    const messages = await Message.findAll({
        where: { messagesWhatsappsId: messageData.messagesWhatsappsId, companyId, whatsappId },
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

    if (messages.length === 0) {
        throw new Error("ERR_CREATING_MESSAGE");
    }

    await ResolveMentionsService(messages, companyId);

    for (let message of messages) {
        await message.update({ body: messageData.body, isEdited: true });
        await message.ticket.update({
            lastMessage: messageData.body
        });
        const preview = previewWithMentions(message.ticket.lastMessage, messageData.body, message.mentions);
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
    }

    return messages.length > 0 ? messages[0] : {} as Message;
};

export default UpdateMessageService;
