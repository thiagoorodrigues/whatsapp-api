import * as Sentry from "@sentry/node";
import { head, isNil } from "lodash";
import moment from "moment";
import { InboundMessage } from "../../channels/inbound";
import { deliverWebhook, isWebhook } from "../QueueIntegrationServices/webhook";
import { formatForTicket, matchesTemplate } from "../../helpers/Mustache";
import { debounce } from "../../helpers/Debounce";
import { cacheLayer } from "../../libs/cache";
import { unreadsKey } from "../../helpers/unreadsKey";
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
import ApplyFunnelRulesService from "../CrmServices/ApplyFunnelRulesService";
import typebotListener from "../TypebotServices/typebotListener";
import { provider } from "../WbotServices/providers";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { followUpOnAgentMessage, followUpOnCustomerMessage } from "../FollowUpServices/hooks";
import SaveInboundMessageService from "./SaveInboundMessageService";
import VerifyContactService from "./VerifyContactService";
import { logger } from "../../utils/logger";
import { statusRoom, ticketRoom } from "../../libs/socketRooms";
import { getTicketChannel, ticketAddress } from "../../channels";

// eslint-disable-next-line @typescript-eslint/no-var-requires

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
    await SendTicketMessageService(ticket, { type: "text", text: await formatForTicket(firstQueue.greetingMessage, ticket, contact) });
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
    const body = await formatForTicket(complationMessage, ticket);
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

  io.to(statusRoom(ticket.companyId, "open")).emit(`company-${ticket.companyId}-ticket`, {
    action: "delete",
    ticket,
    ticketId: ticket.id,
  });

  io.to(statusRoom(ticket.companyId, ticket.status))
    .to(ticketRoom(ticket.companyId, ticket.id.toString()))
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
  if (isWebhook(queueIntegration)) {
    // Not awaited: the webhook's response time must not hold the message.
    void deliverWebhook(queueIntegration, inbound, ticket);
  } else if (queueIntegration.type === "typebot") {
    // await typebots(ticket, msg, wbot, queueIntegration);
    await typebotListener({ ticket, inbound, typebot: queueIntegration });

  }
}


// The webhook of the ticket (its integration, its sector's or its
// connection's), for messages outside the bot phase.
const notifyTicketWebhook = async (inbound: InboundMessage, ticket: Ticket, connectionIntegrationId?: number | null) => {
  try {
    let integrationId = ticket.integrationId;
    if (!integrationId && ticket.queueId) {
      const queue = await Queue.findByPk(ticket.queueId, { attributes: ["integrationId"] });
      integrationId = queue?.integrationId;
    }
    integrationId = integrationId || connectionIntegrationId;
    if (!integrationId) return;
    const integration = await ShowQueueIntegrationService(`${integrationId}`, ticket.companyId);
    if (isWebhook(integration)) await deliverWebhook(integration, inbound, ticket);
  } catch (err) {
    logger.warn(`Ticket ${ticket.id} webhook not sent: ${err}`);
  }
};

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

    // Old messages from the history import do not touch the unread counter.
    if (inbound.history) {
      // unreadMessages stays 0
    } else if (inbound.fromMe) {
      await cacheLayer.set(unreadsKey(chatContact.id, inbound.connectionId), "0");
    } else {
      const unreads = await cacheLayer.get(unreadsKey(chatContact.id, inbound.connectionId));
      unreadMessages = +unreads + 1;
      await cacheLayer.set(
        unreadsKey(chatContact.id, inbound.connectionId),
        `${unreadMessages}`
      );
    }

    const lastMessage = await Message.findOne({
      where: {
        contactId: contact.id,
        companyId,
        isPrivate: false,
      },
      order: [["createdAt", "DESC"]],
    });

    if (
      !inbound.history &&
      unreadMessages === 0 &&
      whatsapp.complationMessage &&
      lastMessage &&
      matchesTemplate(lastMessage.body.trim().toLowerCase(), whatsapp.complationMessage.trim().toLowerCase(), true)
    ) {
      return;
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      inbound.connectionId,
      unreadMessages,
      companyId,
      groupContact,
      inbound.history,
      inbound.history ? new Date(inbound.timestamp) : undefined,
      whatsapp.closeImportedTickets === false ? "pending" : "closed"
    );

    // CRM rules run alongside the message; the service logs its own failures.
    if (!inbound.fromMe && !isGroup && !inbound.history) void ApplyFunnelRulesService(ticket as any);

    if (!isGroup && !inbound.history) await provider(ticket, inbound, companyId, contact);


    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId: whatsapp?.id
    });

    try {
      if (!inbound.fromMe && !inbound.history) {
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
    // History messages leave the conversation alone: an update here would
    // move its date to now and break the list order.
    try {
      if (!inbound.history) await ticket.update({ fromMe: inbound.fromMe, });
    } catch (e) {
      Sentry.captureException(e);
      console.log(e);
    }

    await SaveInboundMessageService(inbound, ticket, contact);

    // History import: answering hundreds of old conversations at once looks
    // like spam to WhatsApp and gets the number blocked.
    if (inbound.history) return;

    // Webhook options beyond the bot phase (handleMessageIntegration covers
    // the customer's messages while the integration answers): messages from
    // our own number and tickets with an attendant.
    if (!isGroup && (inbound.fromMe || ticket.userId)) {
      void notifyTicketWebhook(inbound, ticket, whatsapp?.integrationId);
    }

    // Follow-up: the customer answered, or we wrote from the phone.
    if (!isGroup) {
      if (inbound.fromMe) await followUpOnAgentMessage(ticket as any);
      else await followUpOnCustomerMessage(ticket);
    }

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
          const body = await formatForTicket(whatsapp.outOfHoursMessage, ticket);

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
              const body = await formatForTicket(`${queue.outOfHoursMessage}`, ticket);
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
        send: async content => {
          const sent = await SendTicketMessageService(ticket, content);
          await followUpOnAgentMessage(ticket as any);
          return sent;
        },
        typing: async on => (await getTicketChannel(ticket)).sendTyping(ticketAddress(ticket), on)
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
            const body = await formatForTicket(queue.outOfHoursMessage, ticket);
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
          fromMe: true,
          isPrivate: false
        },
        order: [["createdAt", "DESC"]]
      });

      if (lastMessage && matchesTemplate(lastMessage.body, whatsapp.greetingMessage)) {
        return;
      }

      if (whatsapp.greetingMessage) {

        const debouncedSentMessage = debounce(
          async () => {
            await SendTicketMessageService(ticket, { type: "text", text: await formatForTicket(whatsapp.greetingMessage, ticket, contact) });
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
