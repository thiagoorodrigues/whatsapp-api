import moment from "moment";
import { getContactJid } from "../../helpers/GetPhoneJid";
import * as Sentry from "@sentry/node";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";
import SetTicketMessagesAsRead from "../../helpers/SetTicketMessagesAsRead";
import { getIO } from "../../libs/socket";
import Ticket from "../../models/Ticket";
import Setting from "../../models/Setting";
import Queue from "../../models/Queue";
import ShowTicketService from "./ShowTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import { closingUserId } from "../ReportService/trackingRules";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import { verifyMessage } from "../WbotServices/wbotMessageListener";
import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne"; //NOVO PLW DESIGN//
import ShowUserService from "../UserServices/ShowUserService"; //NOVO PLW DESIGN//
import { isNil } from "lodash";
import { logger } from "../../utils/logger";
import Logs from "../../models/Logs";

interface TicketData {
  status?: string;
  userId?: number | null;
  queueId?: number | null;
  chatbot?: boolean;
  whatsappId?: string;
  useIntegration?: boolean;
  integrationId?: number | null;
  Transferido?: boolean
}

interface Request {
  ticketData: TicketData;
  ticketId: string | number;
  companyId: number;
  userLoggedId?: string | number;
}

interface Response {
  ticket: Ticket;
  oldStatus: string;
  oldUserId: number | undefined;
}

const UpdateTicketService = async ({ ticketData, ticketId, companyId, userLoggedId }: Request): Promise<Response> => {

  try {
    const { status, Transferido } = ticketData;
    let { queueId, userId, whatsappId } = ticketData;
    let chatbot: boolean | null = ticketData.chatbot || false;
    let useIntegration: boolean | null = ticketData.useIntegration || false;
    let integrationId: number | null = ticketData.integrationId || null;

    const io = getIO();

    const key = "userRating";
    const setting = await Setting.findOne({
      where: {
        companyId,
        key
      }
    });

    const ticket = await ShowTicketService(ticketId, companyId);



    if (isNil(whatsappId)) {
      whatsappId = ticket.whatsappId.toString();
    }

    await SetTicketMessagesAsRead(ticket);

    const oldStatus = ticket.status;
    const oldUserId = ticket.user?.id;
    const oldQueueId = ticket.queueId;
    let isTransfer = !!Transferido

    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId,
      companyId,
      whatsappId: ticket.whatsappId,
    });

    if (oldStatus === "closed" || Number(whatsappId) !== ticket.whatsappId) {
      // let otherTicket = await Ticket.findOne({
      //   where: {
      //     contactId: ticket.contactId,
      //     status: { [Op.or]: ["open", "pending", "group"] },
      //     whatsappId
      //   }
      // });
      // if (otherTicket) {
      //     otherTicket = await ShowTicketService(otherTicket.id, companyId)

      //     await ticket.update({status: "closed"})

      //     io.to(oldStatus).emit(`company-${companyId}-ticket`, {
      //       action: "delete",
      //       ticketId: ticket.id
      //     });

      //     return { ticket: otherTicket, oldStatus, oldUserId }
      // }
      await CheckContactOpenTickets(ticket.contact.id, whatsappId);
      chatbot = null;
    }

    if (status !== undefined && ["closed"].indexOf(status) > -1) {
      const { complationMessage, ratingMessage } = await ShowWhatsAppService(
        ticket.whatsappId,
        companyId
      );

      if (setting?.value === "enabled") {
        
        if (ticketTraking.ratingAt == null) {
          const ratingTxt = ratingMessage || "";
          let bodyRatingMessage = `\u200e${ratingTxt}\n\n`;
          bodyRatingMessage += "Digite de 1 à 10 para qualificar nosso atendimento onde:\n*1* - _Muito Ruim_\n*10* - _Excelente_";
          await SendWhatsAppMessage({ body: bodyRatingMessage, ticket, ratingMsg: true });

          await ticketTraking.update({
            ratingAt: moment().toDate(),
            userId: closingUserId({
              ticketUserId: ticket.userId,
              trackingUserId: ticketTraking.userId,
              closerUserId: userLoggedId
            })
          });

          io.to("open")
            .to(ticketId.toString())
            .emit(`company-${ticket.companyId}-ticket`, {
              action: "delete",
              ticketId: ticket.id
            });

          return { ticket, oldStatus, oldUserId };
        }
        ticketTraking.ratingAt = moment().toDate();
        ticketTraking.rated = false;
      }

      if (!isNil(complationMessage) && complationMessage !== "") {
        const body = `\u200e${complationMessage}`;
        await SendWhatsAppMessage({ body, ticket });
      }

      await ticket.update({
        integrationId: null,
        useIntegration: false,
        typebotStatus: false,
        typebotSessionId: null,
        flowId: null,
        flowNodeId: null,
        flowVariables: null
      })

      ticketTraking.finishedAt = moment().toDate();
      ticketTraking.whatsappId = ticket.whatsappId;
      ticketTraking.userId = closingUserId({
        ticketUserId: ticket.userId,
        trackingUserId: ticketTraking.userId,
        closerUserId: userLoggedId
      });

      /*    queueId = null;
            userId = null; */
    }

    if (queueId !== undefined && queueId !== null) {
      ticketTraking.queuedAt = moment().toDate();
    }

    const settingsTransfTicket = await ListSettingsServiceOne({ companyId: companyId, key: "sendMsgTransfTicket" });

    if (status === "closed" && userLoggedId) {
      const user = await ShowUserService(userLoggedId);
      const msgtxt = `_*${user.name}*_ finalizou o atendimento  - _*${moment().format('DD/MM/YYYY HH:mm:ss')}*_`;

      await Logs.create({
        observation: msgtxt,
        contactId: Number(ticket.contact.id),
        userId: Number(userLoggedId),
        ticketId: Number(ticketId),
        companyId: Number(companyId)
      })
    }

    if ((oldStatus === "open" || oldStatus === "closed") && status === "pending" && userLoggedId) {
      const user = await ShowUserService(userLoggedId);
      const msgtxt = `_*${user.name}*_ encaminhou o atendimento para fila  - _*${moment().format('DD/MM/YYYY HH:mm:ss')}*_`;

      await Logs.create({
        observation: msgtxt,
        contactId: Number(ticket.contact.id),
        userId: Number(userLoggedId),
        ticketId: Number(ticketId),
        companyId: Number(companyId)
      })
    }

    if (oldStatus === "closed" && status === "open" && userLoggedId) {
      const user = await ShowUserService(userLoggedId);
      const msgtxt = `_*${user.name}*_ reabriu o atendimento  - _*${moment().format('DD/MM/YYYY HH:mm:ss')}*_`;

      await Logs.create({
        observation: msgtxt,
        contactId: Number(ticket.contact.id),
        userId: Number(userLoggedId),
        ticketId: Number(ticketId),
        companyId: Number(companyId)
      })
    }

    if (oldStatus === "pending" && status === "open" && userLoggedId) {
      const user = await ShowUserService(userLoggedId);
      const msgtxt = `_*${user.name}*_ iniciou o atendimento  - _*${moment().format('DD/MM/YYYY HH:mm:ss')}*_`;

      await Logs.create({
        observation: msgtxt,
        contactId: Number(ticket.contact.id),
        userId: Number(userLoggedId),
        ticketId: Number(ticketId),
        companyId: Number(companyId)
      })
    }

    if (settingsTransfTicket?.value === "enabled") {
      // Mensagem de transferencia da FILA

      if (oldQueueId !== queueId && oldUserId === userId && !isNil(oldQueueId) && !isNil(queueId)) {
        const queue = await Queue.findByPk(queueId);
        const wbot = await GetTicketWbot(ticket);
        const msgtxt = "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "*\naguarde, já vamos te atender! - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";
        isTransfer = true

        const queueChangedMessage = await wbot.sendMessage(
          getContactJid(ticket.contact, ticket.isGroup),
          {
            text: msgtxt
          }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);

        if (userLoggedId) {
          //Log de transferência
          const user = await ShowUserService(userLoggedId);
          const msgLog = "O usuário _*" + user.name + "*_ transferiu o atendimento para o departamento _*" + queue?.name + "*_ - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

          await Logs.create({
            observation: msgLog,
            contactId: Number(ticket.contact.id),
            userId: Number(userLoggedId),
            ticketId: Number(ticketId),
            companyId: Number(companyId)
          })
        }
      } else if (oldUserId !== userId && oldQueueId === queueId && !isNil(oldUserId) && !isNil(userId)) {
        // Mensagem de transferencia do ATENDENTE
        const wbot = await GetTicketWbot(ticket);
        const nome = await ShowUserService(ticketData.userId);
        const msgtxt = "*Mensagem automática*:\nVocê foi transferido para o atendente *" + nome.name + "*\naguarde, já vamos te atender! - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";
        isTransfer = true

        const queueChangedMessage = await wbot.sendMessage(
          getContactJid(ticket.contact, ticket.isGroup),
          {
            text: msgtxt
          }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);

        if (userLoggedId) {
          //Log de transferência
          const user = await ShowUserService(userLoggedId);
          const msgLog = "O usuário _*" + user.name + "*_  transferiu o atendimento para o atendente _*" + nome.name + "*_ - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

          await Logs.create({
            observation: msgLog,
            contactId: Number(ticket.contact.id),
            userId: Number(userLoggedId),
            ticketId: Number(ticketId),
            companyId: Number(companyId)
          })
        }
      } else if (oldUserId !== userId && !isNil(oldUserId) && !isNil(userId) && oldQueueId !== queueId && !isNil(oldQueueId) && !isNil(queueId)) {
        // Mensagem de transferencia do ATENDENTE e da FILA
        isTransfer = true

        const wbot = await GetTicketWbot(ticket);
        const queue = await Queue.findByPk(queueId);
        const nome = await ShowUserService(ticketData.userId);
        const msgtxt = "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "* e contará com a presença de *" + nome.name + "*\naguarde, já vamos te atender! - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

        const queueChangedMessage = await wbot.sendMessage(
          getContactJid(ticket.contact, ticket.isGroup),
          {
            text: msgtxt
          }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);

        if (userLoggedId) {
          //Log de transferência
          const user = await ShowUserService(userLoggedId);
          const msgLog = "O usuário _*" + user.name + "*_  transferiu o atendimento para o departamento *" + queue?.name + "* e contará com a presença de _*" + nome.name + "*_ - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

          await Logs.create({
            observation: msgLog,
            contactId: Number(ticket.contact.id),
            userId: Number(userLoggedId),
            ticketId: Number(ticketId),
            companyId: Number(companyId)
          })
        }
      } else if (oldUserId !== undefined && isNil(userId) && oldQueueId !== queueId && !isNil(queueId)) {
        const queue = await Queue.findByPk(queueId);
        const wbot = await GetTicketWbot(ticket);
        const msgtxt = "*Mensagem automática*:\nVocê foi transferido para o departamento *" + queue?.name + "*\naguarde, já vamos te atender! - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";
        isTransfer = true

        const queueChangedMessage = await wbot.sendMessage(
          getContactJid(ticket.contact, ticket.isGroup),
          {
            text: msgtxt
          }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);

        if (userLoggedId) {
          //Log de transferência
          const user = await ShowUserService(userLoggedId);
          const msgLog = "O usuário _*" + user.name + "*_  transferiu o atendimento para o departamento _*" + queue?.name + "*_ - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

          await Logs.create({
            observation: msgLog,
            contactId: Number(ticket.contact.id),
            userId: Number(userLoggedId),
            ticketId: Number(ticketId),
            companyId: Number(companyId)
          })
        }

      } else if (!isNil(oldUserId) && !isNil(userId) && oldUserId !== userId && (isNil(oldQueueId) || isNil(queueId))) {
        // Mensagem de transferencia do ATENDENTE SEM FILA
        const wbot = await GetTicketWbot(ticket);
        const nome = await ShowUserService(ticketData.userId);
        const msgtxt = "*Mensagem automática*:\nVocê foi transferido para o atendente _*" + nome.name + "*_\naguarde, já vamos te atender! - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

        const queueChangedMessage = await wbot.sendMessage(
          getContactJid(ticket.contact, ticket.isGroup),
          { text: msgtxt }
        );

        await verifyMessage(queueChangedMessage, ticket, ticket.contact);

        isTransfer = true
        if (userLoggedId) {
          //Log de transferência
          const user = await ShowUserService(userLoggedId);
          const msgLog = "O usuário _*" + user.name + "*_  transferiu o atendimento para o atendente _*" + nome.name + "*_ - _*" + moment().format('DD/MM/YYYY HH:mm:ss') + "*_";

          await Logs.create({
            observation: msgLog,
            contactId: Number(ticket.contact.id),
            userId: Number(userLoggedId),
            ticketId: Number(ticketId),
            companyId: Number(companyId)
          })
        }
      }

    }

    await ticket.update({
      status,
      queueId,
      userId,
      whatsappId,
      chatbot
    });

    await ticket.reload();

    if (status !== undefined && ["pending"].indexOf(status) > -1 && !isTransfer) {
      // Back in the queue: reset the wait clock but keep who held it, so
      // "Enviados para fila" and a later close still know the attendant.
      ticketTraking.update({
        whatsappId,
        queuedAt: moment().toDate(),
        startedAt: null
      });
    }

    if (status !== undefined && ["open"].indexOf(status) > -1 && !isTransfer) {
      ticketTraking.update({
        startedAt: moment().toDate(),
        ratingAt: null,
        rated: false,
        whatsappId,
        userId: ticket.userId
      });
    }

    if (!!isTransfer) {
      FindOrCreateATicketTrakingService({
        ticketId,
        companyId,
        whatsappId,
        userId: ticket.user?.id,
        oldUserId: oldUserId.toString(),
        startedAt: status !== undefined && ["pending"].indexOf(status) > -1 ? null : moment().toDate(),
      })

      ticketTraking.update({
        finishedAt: moment().toDate()
      })
    }

    await ticketTraking.save();



    if (ticket.status !== oldStatus || ticket.user?.id !== oldUserId) {

      io.to(oldStatus).emit(`company-${companyId}-ticket`, {
        action: "delete",
        ticketId: ticket.id
      });
    }

    io.to(ticket.status)
      .to("notification")
      .to(ticketId.toString())
      .emit(`company-${companyId}-ticket`, {
        action: "update",
        ticket
      });

    return { ticket, oldStatus, oldUserId };
  } catch (err) {
    Sentry.captureException(err);
  }
};

export default UpdateTicketService;
