import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";

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
}

const UpdateMessageService = async ({ messageData, companyId }: Request): Promise<Message> => {

    const messages = await Message.findAll({
        where: { messagesWhatsappsId: messageData.messagesWhatsappsId },
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

    for (let message of messages) {
        await message.update({ body: messageData.body, isEdited: true });
        await message.ticket.update({
            lastMessage: messageData.body
        });

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
