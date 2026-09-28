import * as Sentry from "@sentry/node";
import { head, isNil } from "lodash";
import moment from "moment";
import { InboundMessage, normalizedForWebhook } from "../../channels/inbound";
import formatBody from "../../helpers/Mustache";
import { debounce } from "../../helpers/Debounce";
import { cacheLayer } from "../../libs/cache";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import QueueIntegrations from "../../models/QueueIntegrations";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import TicketTraking from "../../models/TicketTraking";
import UserRating from "../../models/UserRating";
import { handleAiAgentMessage } from "../AiAgentServices/RunAiAgentService";
import VerifyCurrentSchedule from "../CompanyService/VerifyCurrentSchedule";
import RunFlowService from "../FlowServices/RunFlowService";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import ShowQueueIntegrationService from "../QueueIntegrationServices/ShowQueueIntegrationService";
import FindOrCreateATicketTrakingService from "../TicketServices/FindOrCreateATicketTrakingService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import typebotListener from "../TypebotServices/typebotListener";
import { provider } from "../WbotServices/providers";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SaveInboundMessageService from "./SaveInboundMessageService";
import VerifyContactService from "./VerifyContactService";
import { logger } from "../../utils/logger";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const request = require("request");

// What happens when a message arrives on a connection, whatever the channel:
// contact and ticket, rating, business hours, AI agent, chatbot flow, queue
// and integrations. Channel specifics stay in channels/ (Baileys: toInbound).

// Connection with a single queue: the ticket goes straight into it (with the
// queue greeting and integration). With several queues the ticket waits
// without a queue; routing between queues is done by the chatbot flow.
const verifyQueue = async (inbound: InboundMessage, ticket: Ticket, contact: Contact) => {
  const companyId = ticket.companyId;

  const { queues } = await ShowWhatsAppService(inbound.connectionId, ticket.companyId);

  if (queues.length !== 1) return;

  const firstQueue = head(queues);

  //inicia integração dialogflow/n8n
  if (
    !inbound.fromMe &&
    !ticket.isGroup &&
    !isNil(queues[0]?.integrationId)
  ) {
    const integrations = await ShowQueueIntegrationService(queues[0].integrationId, companyId);

    await handleMessageIntegration(inbound, integrations, ticket)

    await ticket.update({
      useIntegration: true,
      integrationId: integrations.id
    })
    // return;
  }

  await UpdateTicketService({
    ticketData: { queueId: firstQueue?.id, chatbot: false },
    ticketId: ticket.id,
    companyId: ticket.companyId,
  });

  // Greets the customer on arrival in the queue.
  if (firstQueue?.greetingMessage && isNil(firstQueue?.integrationId)) {
    await SendTicketMessageService(ticket, { type: "text", text: formatBody(firstQueue.greetingMessage, contact) });
  }
};

export const verifyRating = (ticketTraking: TicketTraking) => {
  if (
    ticketTraking &&
    ticketTraking.finishedAt === null &&
    ticketTraking.userId !== null &&
    ticketTraking.ratingAt !== null
  ) {
    return true;
  }
  return false;
};

export const handleRating = async (
  rate: number,
  ticket: Ticket,
  ticketTraking: TicketTraking
) => {
  const io = getIO();

  const { complationMessage } = await ShowWhatsAppService(
    ticket.whatsappId,
    ticket.companyId
  );

  let finalRate = rate;

  if (rate < 1) {
    finalRate = 1;
  }
  if (rate > 10) {
    finalRate = 10;
  }

  await UserRating.create({
    ticketId: ticketTraking.ticketId,
    companyId: ticketTraking.companyId,
    userId: ticketTraking.userId,
    rate: finalRate,
  });

  if (complationMessage) {
    const body = formatBody(complationMessage, ticket.contact);
    await SendWhatsAppMessage({ body, ticket });
  }

  await ticketTraking.update({
    finishedAt: moment().toDate(),
    rated: true,
  });

  await ticket.update({
    queueId: null,
    chatbot: null,
    userId: null,
    status: "closed",
  });

  io.to("open").emit(`company-${ticket.companyId}-ticket`, {
    action: "delete",
    ticket,
    ticketId: ticket.id,
  });

  io.to(ticket.status)
    .to(ticket.id.toString())
    .emit(`company-${ticket.companyId}-ticket`, {
      action: "update",
      ticket,
      ticketId: ticket.id,
    });
};

export const handleMessageIntegration = async (
  inbound: InboundMessage,
  queueIntegration: QueueIntegrations,
  ticket: Ticket
): Promise<void> => {
  if (queueIntegration.type === "n8n" || queueIntegration.type === "webhook") {
    if (queueIntegration?.urlN8N) {
      const options = {
        method: "POST",
        url: queueIntegration?.urlN8N,
        headers: {
          "Content-Type": "application/json"
        },
        // The channel's own payload, as before, plus the channel-neutral
        // view in `normalized`.
        json: { ...(inbound.raw as object), normalized: normalizedForWebhook(inbound) }
      };
      try {
        request(options, function (error, response) {
          if (error) {
            throw new Error(error);
          }
          else {
            console.log(response.body);
          }
        });
      } catch (error) {
        throw new Error(error);
      }
    }

  } else if (queueIntegration.type === "typebot") {
    // await typebots(ticket, msg, wbot, queueIntegration);
    await typebotListener({ ticket, inbound, typebot: queueIntegration });

  }
}


const ProcessInboundMessage = async (inbound: InboundMessage): Promise<void> => {
  const { companyId } = inbound;

  try {
    let groupContact: Contact | undefined;

    const isGroup = inbound.chat.isGroup;

    // "Ignorar mensagens de grupos" (Configurações > Opções).
    if (isGroup) {
      const msgIsGroupBlock = await Setting.findOne({ where: { companyId, key: "CheckMsgIsGroup" } });
      if (msgIsGroupBlock?.value === "enabled") return;
    }

    const bodyMessage = inbound.text;
    const msgType = inbound.channelType;
    const hasMedia = inbound.hasMedia;

    // From the phone we only keep text and media (no reactions, edits...).
    if (inbound.fromMe && !hasMedia && msgType !== "conversation" && msgType !== "extendedTextMessage") return;

    if (isGroup) {
      groupContact = await VerifyContactService({
        jid: inbound.chat.jid,
        name: inbound.chat.name,
        connectionId: inbound.connectionId,
        companyId
      });
    }

    const whatsapp = await ShowWhatsAppService(inbound.connectionId, companyId);
    // Our own messages in a group belong to the group, not to a contact
    // with our own number.
    const contact = isGroup && inbound.fromMe && groupContact
      ? groupContact
      : await VerifyContactService({
        jid: inbound.sender.jid,
        name: inbound.sender.name,
        lid: inbound.sender.lid,
        connectionId: inbound.connectionId,
        companyId
      });
    // Unread counters are per conversation (the group, for group members).
    const chatContact = groupContact || contact;

    let unreadMessages = 0;

    if (inbound.fromMe) {
      await cacheLayer.set(`contacts:${chatContact.id}:unreads`, "0");
    } else {
      const unreads = await cacheLayer.get(`contacts:${chatContact.id}:unreads`);
      unreadMessages = +unreads + 1;
      await cacheLayer.set(
        `contacts:${chatContact.id}:unreads`,
        `${unreadMessages}`
      );
    }

    const lastMessage = await Message.findOne({
      where: {
        contactId: contact.id,
        companyId,
      },
      order: [["createdAt", "DESC"]],
    });

    if (
      unreadMessages === 0 &&
      whatsapp.complationMessage &&
      formatBody(whatsapp.complationMessage, contact).trim().toLowerCase() ===
      lastMessage?.body.trim().toLowerCase()
    ) {
      return;
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      inbound.connectionId,
      unreadMessages,
      companyId,
      groupContact
    );

    if (!isGroup) await provider(ticket, inbound, companyId, contact);


    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId: whatsapp?.id
    });

    try {
      if (!inbound.fromMe) {
        /**
         * Tratamento para avaliação do atendente
         */

        //  // dev Ricardo: insistir a responder avaliação
        //  const rate_ = Number(bodyMessage);

        //  if ((ticket?.lastMessage.includes('_Insatisfeito_') || ticket?.lastMessage.includes('Por favor avalie nosso atendimento.')) &&  (!isFinite(rate_))) {
        //      const debouncedSentMessage = debounce(
        //        async () => {
        //          await wbot.sendMessage(
        //            `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"
        //            }`,
        //            {
        //              text: 'Por favor avalie nosso atendimento.'
        //            }
        //          );
        //        },
        //        1000,
        //        ticket.id
        //      );
        //      debouncedSentMessage();
        //      return;
        //  }
        //  // dev Ricardo

        if (!isGroup && ticketTraking !== null && verifyRating(ticketTraking) && !isNaN(parseFloat(bodyMessage))) {

          handleRating(parseFloat(bodyMessage), ticket, ticketTraking);
          return;
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    // Atualiza o ticket se a ultima mensagem foi enviada por mim, para que possa ser finalizado. 
    try {
      await ticket.update({ fromMe: inbound.fromMe, });
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    await SaveInboundMessageService(inbound, ticket, contact);

    const currentSchedule = await VerifyCurrentSchedule(companyId);
    const scheduleType = await Setting.findOne({
      where: {
        companyId,
        key: "scheduleType"
      }
    });


    try {
      if (!inbound.fromMe && !isGroup && scheduleType) {
        /**
         * Tratamento para envio de mensagem quando a empresa está fora do expediente
         */
        if (
          scheduleType.value === "company" &&
          !isNil(currentSchedule) &&
          (!currentSchedule || currentSchedule.inActivity === false)
        ) {
          const body = formatBody(whatsapp.outOfHoursMessage, ticket.contact);

          const debouncedSentMessage = debounce(
            async () => {
              await SendTicketMessageService(ticket, { type: "text", text: body });
            },
            3000,
            ticket.id
          );
          debouncedSentMessage();
          return;
        }


        if (scheduleType.value === "queue" && ticket.queueId !== null) {

          /**
           * Tratamento para envio de mensagem quando a fila está fora do expediente
           */
          const queue = await Queue.findByPk(ticket.queueId);

          const { schedules }: any = queue;
          const now = moment();
          const weekday = now.format("dddd").toLowerCase();
          let schedule = null;

          if (Array.isArray(schedules) && schedules.length > 0) {
            schedule = schedules.find(
              s =>
                s.weekdayEn === weekday &&
                s.startTime !== "" &&
                s.startTime !== null &&
                s.endTime !== "" &&
                s.endTime !== null
            );
          }

          if (
            scheduleType.value === "queue" &&
            queue.outOfHoursMessage !== null &&
            queue.outOfHoursMessage !== "" &&
            !isNil(schedule)
          ) {
            const startTime = moment(schedule.startTime, "HH:mm");
            const endTime = moment(schedule.endTime, "HH:mm");

            if (now.isBefore(startTime) || now.isAfter(endTime)) {
              const body = `${queue.outOfHoursMessage}`;
              const debouncedSentMessage = debounce(
                async () => {
                  await SendTicketMessageService(ticket, { type: "text", text: body });
                },
                3000,
                ticket.id
              );
              debouncedSentMessage();
              return;
            }
          }
        }

      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    try {
      if (!inbound.fromMe) {
        if (!isGroup && ticketTraking !== null && verifyRating(ticketTraking) && !isNaN(parseFloat(bodyMessage))) {

          handleRating(parseFloat(bodyMessage), ticket, ticketTraking);
          return;
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }


    // AI agent of the connection: owns new conversations until it hands
    // them to people (then the flow and queues below do not run).
    if (!inbound.fromMe && !ticket.isGroup) {
      const handledByAgent = await handleAiAgentMessage({
        ticket,
        whatsapp,
        send: content => SendTicketMessageService(ticket, content)
      });
      if (handledByAgent) return;
    }

    // Chatbot flow of the connection (replaces the queue menu). While the
    // ticket belongs to a flow, the legacy queue chatbot stays out of it.
    if (!inbound.fromMe && !ticket.isGroup && !ticket.userId && !ticket.useIntegration) {
      const handledByFlow = await RunFlowService({
        ticket,
        contact,
        whatsapp,
        body: bodyMessage || "",
        send: content => SendTicketMessageService(ticket, content)
      });
      if (handledByFlow || (!ticket.queueId && (ticket.flowId || whatsapp.flowId))) return;
    }

    //integraçao na conexao
    if (
      !inbound.fromMe &&
      !ticket.isGroup &&
      !ticket.queue &&
      !ticket.user &&
      ticket.chatbot &&
      !isNil(whatsapp.integrationId) &&
      !ticket.useIntegration
    ) {

      const integrations = await ShowQueueIntegrationService(whatsapp.integrationId, companyId);

      await handleMessageIntegration(inbound, integrations, ticket)

      return
    }


    if (
      !inbound.fromMe &&
      !ticket.isGroup &&
      !ticket.userId &&
      ticket.integrationId &&
      ticket.useIntegration &&
      ticket.queue
    ) {
      const integrations = await ShowQueueIntegrationService(ticket.integrationId, companyId);
      await handleMessageIntegration(inbound, integrations, ticket)
    }

    if (
      !ticket.queue &&
      !ticket.isGroup &&
      !inbound.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length === 1 &&
      !ticket.useIntegration
    ) {

      await verifyQueue(inbound, ticket, contact);
    }

    await ticket.reload();

    try {
      //Fluxo fora do expediente
      if (!inbound.fromMe && !isGroup && scheduleType && ticket.queueId !== null) {
        /**
         * Tratamento para envio de mensagem quando a fila está fora do expediente
         */
        const queue = await Queue.findByPk(ticket.queueId);

        const { schedules }: any = queue;
        const now = moment();
        const weekday = now.format("dddd").toLowerCase();
        let schedule = null;

        if (Array.isArray(schedules) && schedules.length > 0) {
          schedule = schedules.find(
            s =>
              s.weekdayEn === weekday &&
              s.startTime !== "" &&
              s.startTime !== null &&
              s.endTime !== "" &&
              s.endTime !== null
          );
        }

        if (
          scheduleType.value === "queue" &&
          queue.outOfHoursMessage !== null &&
          queue.outOfHoursMessage !== "" &&
          !isNil(schedule)
        ) {
          const startTime = moment(schedule.startTime, "HH:mm");
          const endTime = moment(schedule.endTime, "HH:mm");

          if (now.isBefore(startTime) || now.isAfter(endTime)) {
            const body = queue.outOfHoursMessage;
            const debouncedSentMessage = debounce(
              async () => {
                await SendTicketMessageService(ticket, { type: "text", text: body });
              },
              3000,
              ticket.id
            );
            debouncedSentMessage();
            return;
          }
        }
      }
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }



    if (!whatsapp?.queues?.length && !ticket.userId && !isGroup && !inbound.fromMe) {

      const lastMessage = await Message.findOne({
        where: {
          ticketId: ticket.id,
          fromMe: true
        },
        order: [["createdAt", "DESC"]]
      });

      if (lastMessage && lastMessage.body.includes(whatsapp.greetingMessage)) {
        return;
      }

      if (whatsapp.greetingMessage) {

        const debouncedSentMessage = debounce(
          async () => {
            await SendTicketMessageService(ticket, { type: "text", text: whatsapp.greetingMessage });
          },
          1000,
          ticket.id
        );
        debouncedSentMessage();
        return;
      }

    }


  } catch (err) {
    console.log(err)
    Sentry.captureException(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

export default ProcessInboundMessage;
