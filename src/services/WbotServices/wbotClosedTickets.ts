import { Op } from "sequelize";
import Ticket from "../../models/Ticket"
import Whatsapp from "../../models/Whatsapp"
import { getIO } from "../../libs/socket"
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import moment from "moment";
import ShowTicketService from "../TicketServices/ShowTicketService";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";
import { expiringWhatsapps } from "./autoTicketRules";

export const ClosedAllOpenTickets = async (companyId: number): Promise<void> => {

  // @ts-ignore: Unreachable code error
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    logger.info("====ENTREI PRA FECHAR====")
    if (currentStatus === 'nps') {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else if (currentStatus === 'open') {

      await ticket.update({
        status: "closed",
        //  userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        unreadMessages: 0
      });
    }
  };

  const io = getIO();

  try {


    // Só faz sentido percorrer tickets se alguma conexão tem expiração configurada;
    // e a conexão é lida uma vez, sem a sessão do Baileys, não uma vez por ticket.
    const whatsapps = expiringWhatsapps(
      await Whatsapp.findAll({
        where: { companyId },
        attributes: ["id", "expiresTicket", "expiresInactiveMessage"]
      })
    );
    if (whatsapps.length === 0) return;
    const byId = new Map(whatsapps.map(w => [w.id, w]));

    let subtractHour = moment().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss')

    const { rows: tickets } = await Ticket.findAndCountAll({
      where: {
        status: { [Op.in]: ["open", "pending"] },
        companyId,
        whatsappId: { [Op.in]: whatsapps.map(w => w.id) },
        updatedAt: { [Op.lte]: subtractHour }
      },
      order: [["updatedAt", "DESC"]]
    });

    if(!tickets || tickets.length == 0) return

    tickets.forEach(async ticket => {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = byId.get(showTicket?.whatsappId);
      const ticketTraking = await TicketTraking.findOne({
        where: {
          ticketId: ticket.id,
          finishedAt: null,
        }
      })

      if (!whatsapp) return;

      let {
        expiresInactiveMessage, //mensage de encerramento por inatividade      
        expiresTicket //tempo em horas para fechar ticket automaticamente
      } = whatsapp


      // @ts-ignore: Unreachable code error
      if (expiresTicket && expiresTicket !== "" &&
        // @ts-ignore: Unreachable code error
        expiresTicket !== "0" && Number(expiresTicket) > 0) {

        //mensagem de encerramento por inatividade
        const bodyExpiresMessageInactive = formatBody(expiresInactiveMessage, showTicket.contact);

        // let dataLimite = new Date();
        // dataLimite.setMinutes(dataLimite.getMinutes() - Number(expiresTicket));

        if ((showTicket.status === "pending" || showTicket.status === "open") && !showTicket.isGroup) {
          const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt)

          // if (dataUltimaInteracaoChamado > dataLimite) {
            closeTicket(showTicket, showTicket.status, bodyExpiresMessageInactive);

            if (expiresInactiveMessage !== "" && expiresInactiveMessage !== undefined) {
              await SendWhatsAppMessage({ body: bodyExpiresMessageInactive, ticket: showTicket });
            }

            await ticketTraking.update({
              finishedAt: moment().toDate(),
              closedAt: moment().toDate(),
              whatsappId: ticket.whatsappId,
              userId: ticket.userId,
            })

            io.to("pending")
              .emit(`company-${companyId}-ticket`, {
                action: "delete",
                ticketId: showTicket.id
              });
          // }
        }
      }
    });

  } catch (e: any) {
    console.log('e', e)
  }

}
