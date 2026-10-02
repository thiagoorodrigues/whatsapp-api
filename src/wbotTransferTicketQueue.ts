import { Op } from "sequelize";
import TicketTraking from "./models/TicketTraking";
import { format } from "date-fns";
import moment from "moment";
import Ticket from "./models/Ticket";
import Whatsapp from "./models/Whatsapp";
import { getIO } from "./libs/socket";
import { logger } from "./utils/logger";
import ShowTicketService from "./services/TicketServices/ShowTicketService";
import { transferringWhatsapps } from "./services/WbotServices/autoTicketRules";
import { notificationRoom, statusRoom, ticketRoom } from "./libs/socketRooms";


export const TransferTicketQueue = async (): Promise<void> => {

  try {
    const io = getIO();

    // Só percorre tickets das conexões com transferência configurada, lidas
    // uma vez e sem a sessão do Baileys.
    const whatsapps = transferringWhatsapps(
      await Whatsapp.findAll({ attributes: ["id", "timeToTransfer", "transferQueueId"] })
    );
    if (whatsapps.length === 0) return;
    const byId = new Map(whatsapps.map(w => [w.id, w]));

    //buscar os tickets que em pendentes e sem fila
    const tickets = await Ticket.findAll({
      where: {
        status: "pending",
        queueId: { [Op.is]: null },
        whatsappId: { [Op.in]: whatsapps.map(w => w.id) }
      },
    });

    // varrer os tickets e verificar se algum deles está com o tempo estourado
    tickets.forEach(async ticket => {
      const wpp = byId.get(ticket.whatsappId);
      if (!wpp) return;

      let dataLimite = new Date(ticket.updatedAt);
      dataLimite.setMinutes(dataLimite.getMinutes() + wpp.timeToTransfer);

      if (new Date() > dataLimite) {

        await ticket.update({

          queueId: wpp.transferQueueId,

        });

        const ticketTraking = await TicketTraking.findOne({
          where: {
            ticketId: ticket.id
          },
          order: [["createdAt", "DESC"]]
        });

        await ticketTraking.update({
          queuedAt: moment().toDate(),
          queueId: wpp.transferQueueId,
        });

        const currentTicket = await ShowTicketService(ticket.id, ticket.companyId);

        io.to(statusRoom(ticket.companyId, ticket.status))
          .to(notificationRoom(ticket.companyId))
          .to(ticketRoom(ticket.companyId, ticket.id.toString()))
          .emit(`company-${ticket.companyId}-ticket`, {
            action: "update",
            ticket: currentTicket,
            traking: "created ticket 33"
          });

        logger.info(`Transferencia de ticket automatica ticket id ${ticket.id} para a fila ${wpp.transferQueueId}`);

      }
    });

  } catch (error) {
    logger.error([`Erro wbotTransferTicketQueue => `, error, JSON.stringify(error)])
  }

}
