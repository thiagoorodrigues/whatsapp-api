import { AnyMessageContent, proto } from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";

import Contact from "../../models/Contact";
import Flow from "../../models/Flow";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import formatBody from "../../helpers/Mustache";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { logger } from "../../utils/logger";
import { continueFlow, FlowAction, FlowGraph, FlowResult, startFlow } from "./FlowEngine";
import { isFlowBuilderEnabled } from "./assertFlowBuilderEnabled";

type Sender = (content: AnyMessageContent) => Promise<proto.IWebMessageInfo | undefined>;

interface Request {
  ticket: Ticket;
  contact: Contact;
  whatsapp: Whatsapp;
  body: string;
  // Sends through the connection and stores the message on the ticket
  // (wbotMessageListener passes wbot.sendMessage + verifyMessage).
  send: Sender;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4"
};

const fileNameOf = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "arquivo");
  } catch (e) {
    return "arquivo";
  }
};

const mimeOf = (url: string, fallback: string) =>
  EXTENSION_MIME[(fileNameOf(url).split(".").pop() || "").toLowerCase()] || fallback;

const mediaContent = (
  action: Extract<FlowAction, { type: "media" }>,
  contact: Contact
): AnyMessageContent => {
  const caption = action.caption ? formatBody(action.caption, contact) : undefined;
  switch (action.mediaType) {
    case "video":
      return { video: { url: action.url }, caption };
    case "audio":
      return { audio: { url: action.url }, mimetype: mimeOf(action.url, "audio/mpeg") };
    case "document":
      return {
        document: { url: action.url },
        fileName: fileNameOf(action.url),
        mimetype: mimeOf(action.url, "application/octet-stream"),
        caption
      };
    case "image":
    default:
      return { image: { url: action.url }, caption };
  }
};

const execute = async (actions: FlowAction[], { ticket, contact, send }: Request) => {
  for (const action of actions) {
    switch (action.type) {
      case "text":
        await send({ text: formatBody(`‎${action.text}`, contact) });
        break;
      case "media":
        await send(mediaContent(action, contact));
        break;
      case "wait":
        await sleep(action.seconds * 1000);
        break;
      case "transfer":
        await UpdateTicketService({
          ticketData: {
            queueId: action.queueId,
            userId: action.userId,
            status: action.userId ? "open" : "pending",
            chatbot: false
          } as any,
          ticketId: ticket.id,
          companyId: ticket.companyId
        });
        break;
      case "end":
        if (action.closeTicket) {
          await UpdateTicketService({
            ticketData: { status: "closed" } as any,
            ticketId: ticket.id,
            companyId: ticket.companyId
          });
        }
        break;
      default:
    }
  }
};

const loadFlow = async (id: number | null | undefined, companyId: number) =>
  id ? Flow.findOne({ where: { id, companyId, isActive: true } }) : null;

/**
 * Runs the connection's chatbot flow for an incoming customer message.
 * Returns true when the flow handled the message (the caller must skip the
 * legacy queue menu).
 *
 * Ticket fields: flowId set + flowNodeId set = waiting for an answer;
 * flowId set + flowNodeId null = flow finished, humans take over (it does not
 * restart until the ticket is closed, which clears both).
 */
const RunFlowService = async (request: Request): Promise<boolean> => {
  const { ticket, whatsapp, body } = request;

  if (ticket.flowId && !ticket.flowNodeId) return false;

  const inProgress = !!(ticket.flowId && ticket.flowNodeId);
  if (!inProgress && (!whatsapp.flowId || ticket.queueId)) return false;
  if (!(await isFlowBuilderEnabled(ticket.companyId))) return false;

  const flow = await loadFlow(inProgress ? ticket.flowId : whatsapp.flowId, ticket.companyId);
  if (!flow) {
    if (inProgress) await ticket.update({ flowNodeId: null });
    return false;
  }

  const graph: FlowGraph = { nodes: flow.nodes || [], edges: flow.edges || [] };
  const result: FlowResult = inProgress
    ? continueFlow(graph, { nodeId: ticket.flowNodeId, variables: ticket.flowVariables || {} }, body)
    : startFlow(graph);

  // Save the position first: an answer arriving while we send keeps going
  // from the right node.
  await ticket.update({
    flowId: flow.id,
    flowNodeId: result.state.nodeId,
    flowVariables: result.state.variables,
    chatbot: false
  });

  try {
    await execute(result.actions, request);
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Flow ${flow.id} failed on ticket ${ticket.id}: ${err}`);
  }

  return true;
};

export default RunFlowService;
