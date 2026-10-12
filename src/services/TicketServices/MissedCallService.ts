import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import { getChannel } from "../../channels";
import { isLidJid, toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";

interface Request {
  whatsappId: number;
  companyId: number;
  /** Quem ligou (JID de telefone ou LID). */
  from: string;
  callId: string;
}

const CALL_WARNING =
  "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado";

// Chamada encerrada: com a configuração `call` desabilitada, avisa o contato e
// registra "chamada perdida" no ticket. Comum aos dois motores.
const MissedCallService = async ({ whatsappId, companyId, from, callId }: Request): Promise<void> => {
  const sendMsgCall = await Setting.findOne({ where: { key: "call", companyId } });
  if (sendMsgCall?.value !== "disabled") return;

  // Calls come from a LID or a phone JID (o gateway pode mandar com sufixo de
  // dispositivo, "5531...:12@s.whatsapp.net").
  const userLid = isLidJid(from) ? toUserLid(from) : undefined;
  const number = userLid ? undefined : toPhoneNumber(from);
  const contact = userLid || number
    ? await Contact.findOne({ where: userLid ? { companyId, lid: userLid } : { companyId, number } })
    : null;

  const ticket = contact
    ? await Ticket.findOne({
        where: { contactId: contact.id, whatsappId, companyId },
        include: ["contact"]
      })
    : null;

  if (ticket) {
    await SendTicketMessageService(ticket, { type: "text", text: CALL_WARNING });
  } else {
    await getChannel(whatsappId).send({ jid: from }, { type: "text", text: CALL_WARNING });
  }

  // se não existir o ticket não faz nada.
  if (!ticket) return;

  const date = new Date();
  const body = `Chamada de voz/vídeo perdida às ${date.getHours()}:${date.getMinutes()}`;
  const messageData = {
    id: callId,
    ticketId: ticket.id,
    contactId: contact.id,
    body,
    fromMe: false,
    mediaType: "call_log",
    read: true,
    quotedMsgId: null,
    ack: 1
  };

  await ticket.update({ lastMessage: body });

  if (ticket.status === "closed") {
    await ticket.update({ status: "pending" });
  }

  await CreateMessageService({ messageData, companyId });
};

export default MissedCallService;
