import path from "path";
import uploadConfig from "../../config/upload";
import { contentFromFile } from "../../channels/media";
import { formatForTicket } from "../../helpers/Mustache";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Contact from "../../models/Contact";
import Schedule from "../../models/Schedule";
import Whatsapp from "../../models/Whatsapp";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";

// Agendamento sai pela conversa do contato, como no chat: a mensagem fica no
// atendimento, com os ✓ de entrega (antes ia direto ao WhatsApp e nada era
// gravado, então não dava para saber se tinha chegado).
const SendScheduledMessageService = async (scheduleId: number): Promise<Schedule> => {
  const schedule = await Schedule.findByPk(scheduleId, { include: [{ model: Contact, as: "contact" }] });
  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
  if (!schedule.contact) throw new Error(`Schedule ${scheduleId} has no contact`);

  const chosen = schedule.whatsappsId
    ? await Whatsapp.findOne({ where: { id: schedule.whatsappsId, companyId: schedule.companyId, status: "CONNECTED" } })
    : null;
  const whatsapp = chosen || (await GetDefaultWhatsApp(schedule.companyId));

  const ticket = await FindOrCreateTicketService(schedule.contact, whatsapp.id, 0, schedule.companyId);
  const text = await formatForTicket(schedule.body || "", ticket);

  const content = schedule.mediaPath
    ? contentFromFile(
        schedule.mediaName || schedule.mediaPath,
        path.resolve(uploadConfig.directory, schedule.mediaPath),
        text
      )
    : { type: "text" as const, text };

  // Falha ao gravar depois de enviar só vai para o log (o cliente já recebeu).
  await SendTicketMessageService(ticket, content);
  return schedule;
};

export default SendScheduledMessageService;
