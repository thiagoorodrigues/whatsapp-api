import * as Sentry from "@sentry/node";
import { OutgoingContent } from "../../channels/types";

import { moveContactDeal, registerContactDeal } from "../CrmServices/AgentDealService";
import AiAgent from "../../models/AiAgent";
import AiAgentRun from "../../models/AiAgentRun";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import ShowTicketService from "../TicketServices/ShowTicketService";
import AddTicketTagService from "../TagServices/AddTicketTagService";
import TicketTag from "../../models/TicketTag";
import { getIO } from "../../libs/socket";
import { notificationRoom, statusRoom, ticketRoom } from "../../libs/socketRooms";
import { hasPlanFeature } from "../../helpers/planFeature";
import { sleep } from "../../helpers/botUtils";
import { logger } from "../../utils/logger";
import { agentKey } from "./keys";
import generateReply from "./generateReply";
import { ChatMessage } from "./types";
import { DeferredAction } from "./tools";
import { splitReply, typingDelay } from "./messageParts";
import { AgentMediaFile, contentFor, mediaPath } from "./mediaTools";

// Sends to the ticket and saves the message (see SendTicketMessageService).
type Sender = (content: OutgoingContent) => Promise<unknown>;
// Shows or hides "typing..." to the contact.
type Typing = (typing: boolean) => Promise<void>;

// Customers often send several short messages in a row: wait for a pause
// and answer them together. Agents may set their own wait (tools.wait).
const DEBOUNCE_MS = Number(process.env.AI_AGENT_DEBOUNCE_MS) || 3000;

export const debounceMs = (agent: Pick<AiAgent, "tools">): number =>
  agent.tools?.wait?.enabled && agent.tools.wait.seconds ? agent.tools.wait.seconds * 1000 : DEBOUNCE_MS;

// The agent reads the ticket's conversation. Very long tickets are cut to
// their most recent part so the prompt stays within model limits and cost.
export const HISTORY_MAX_MESSAGES = 200;
export const HISTORY_MAX_CHARS = 60000;

const timers = new Map<number, NodeJS.Timeout>();
const running = new Set<number>();
const pendingRerun = new Set<number>();

// A ticket the agent may answer: not with people yet, not handed off.
export const agentMayAnswer = (ticket: Ticket): boolean =>
  !!ticket &&
  ticket.status !== "closed" &&
  !ticket.isGroup &&
  !ticket.userId &&
  (!ticket.queueId || !!ticket.aiAgentKept) &&
  !ticket.useIntegration &&
  !ticket.aiStoppedAt;

const mediaLabel = (mediaType?: string) => {
  switch (mediaType) {
    case "image":
      return "[o cliente enviou uma imagem]";
    case "audio":
    case "ptt":
      return "[o cliente enviou um áudio]";
    case "video":
      return "[o cliente enviou um vídeo]";
    case "document":
    case "application":
      return "[o cliente enviou um arquivo]";
    case "location":
      return "[o cliente enviou uma localização]";
    default:
      return "";
  }
};

export const toHistory = (messages: Message[]): ChatMessage[] =>
  messages
    // Internal notes are for the team, never part of the conversation.
    .filter(m => !m.isDeleted && !m.isPrivate)
    .map(m => ({
      role: (m.fromMe ? "assistant" : "user") as ChatMessage["role"],
      text: (m.body || "").trim() || (m.fromMe ? "" : mediaLabel(m.mediaType))
    }))
    .filter(m => m.text);

// Keeps the newest messages that fit in the character budget.
export const trimHistory = (history: ChatMessage[], maxChars = HISTORY_MAX_CHARS): ChatMessage[] => {
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    total += history[i].text.length;
    if (total > maxChars && kept.length) break;
    kept.unshift(history[i]);
  }
  return kept;
};

// The agent works on the deal of this conversation's contact only.
const crmFor = (agent: AiAgent, ticket: Ticket) => {
  const cfg = agent.tools?.crm;
  if (!cfg?.enabled || !cfg.funnelId || !cfg.stageId || !ticket.contactId) return undefined;
  const target = { companyId: ticket.companyId, contactId: ticket.contactId, funnelId: cfg.funnelId };
  return {
    register: (input: { summary: string; title?: string; value?: number | string; source?: string }) =>
      registerContactDeal({ ...target, stageId: cfg.stageId, ...input }),
    move: (stageId: number) => moveContactDeal({ ...target, stageId })
  };
};

// The agent's "adicionar_tag": tags the ticket and refreshes it on screen.
const tagAdder = (ticket: Ticket) => async (tagId: number) => {
  const exists = await TicketTag.findOne({ where: { ticketId: ticket.id, tagId } });
  if (exists) return { ok: true, message: "O atendimento já tinha essa tag." };
  await AddTicketTagService({ ticketId: ticket.id, tagId, companyId: ticket.companyId });
  const fresh = await ShowTicketService(ticket.id, ticket.companyId);
  getIO()
    .to(statusRoom(ticket.companyId, fresh.status))
    .to(notificationRoom(ticket.companyId))
    .to(ticketRoom(ticket.companyId, ticket.id.toString()))
    .emit(`company-${ticket.companyId}-ticket`, { action: "update", ticket: fresh });
  return { ok: true, message: "Tag adicionada ao atendimento." };
};

const applyActions = async (ticket: Ticket, actions: DeferredAction[]) => {
  for (const action of actions) {
    if (action.type === "transfer" && action.keepAgent && action.queueId) {
      // Only the queue changes: the agent goes on answering.
      await ticket.update({ aiAgentKept: true });
      await UpdateTicketService({
        ticketData: { queueId: action.queueId, chatbot: false } as any,
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
    } else if (action.type === "transfer") {
      await ticket.update({ aiStoppedAt: new Date(), aiAgentKept: false });
      await UpdateTicketService({
        ticketData: (action.userId
          ? { userId: action.userId, status: "open", chatbot: false }
          : { queueId: action.queueId, status: "pending", chatbot: false }) as any,
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
    }
    if (action.type === "close") {
      await UpdateTicketService({
        ticketData: { status: "closed" } as any,
        ticketId: ticket.id,
        companyId: ticket.companyId
      });
    }
  }
};

// The reply in one message, or in parts with "typing..." before each one.
// Stops if people take over the conversation between parts.
const sendReply = async (ticket: Ticket, agent: AiAgent, reply: string, send: Sender, typing?: Typing) => {
  const split = agent.tools?.split;
  if (!split?.enabled) {
    await send({ type: "text", text: reply });
    return;
  }
  const parts = splitReply(reply);
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) {
      const current = await Ticket.findByPk(ticket.id);
      if (!current || !agentMayAnswer(current)) return;
    }
    await typing?.(true).catch(() => undefined);
    await sleep(typingDelay(parts[i], split.delay));
    await send({ type: "text", text: parts[i] });
  }
};

const turn = async (ticketId: number, agentId: number, send: Sender, typing?: Typing) => {
  const ticket = await Ticket.findByPk(ticketId, { include: [{ model: Contact, as: "contact" }] });
  if (!ticket || !agentMayAnswer(ticket)) return;

  const agent = await AiAgent.findOne({ where: { id: agentId, companyId: ticket.companyId, status: "active" } });
  if (!agent) return;

  const started = Date.now();
  const run = {
    companyId: ticket.companyId,
    agentId: agent.id,
    ticketId: ticket.id,
    provider: agent.provider,
    model: agent.model
  };

  try {
    const apiKey = agentKey(agent);
    if (!apiKey) throw new Error("O agente não tem chave de API cadastrada");

    const recent = await Message.findAll({
      where: { ticketId: ticket.id, isPrivate: false },
      order: [["createdAt", "DESC"]],
      limit: HISTORY_MAX_MESSAGES
    });
    const history = trimHistory(toHistory(recent.reverse()));
    // Nothing new from the customer since the last reply.
    if (!history.length || history[history.length - 1].role !== "user") return;

    const [queues, company] = await Promise.all([
      Queue.findAll({ where: { companyId: ticket.companyId }, attributes: ["id", "name"] }),
      Company.findByPk(ticket.companyId, { attributes: ["name"] })
    ]);

    const media: AgentMediaFile[] = [];
    const result = await generateReply({
      agent,
      apiKey,
      history,
      queues: queues.map(q => ({ id: q.id, name: q.name })),
      companyName: company?.name,
      contactName: ticket.contact?.name,
      httpContext: {
        contactName: ticket.contact?.name,
        contactNumber: ticket.contact?.number,
        ticketId: ticket.id
      },
      crm: crmFor(agent, ticket),
      addTag: tagAdder(ticket),
      sendMedia: async file => {
        media.push(file);
        return { ok: true, message: `O arquivo "${file.name}" será enviado logo depois da sua mensagem.` };
      }
    });

    if (result.reply) await sendReply(ticket, agent, result.reply, send, typing);
    for (const file of media) {
      try {
        await send(contentFor(file, mediaPath(ticket.companyId, agent.id, file)));
      } catch (err) {
        logger.error(`AI agent ${agent.id} could not send "${file.name}" on ticket ${ticket.id}: ${err}`);
      }
    }
    await applyActions(ticket, result.actions);

    await AiAgentRun.create({
      ...run,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      toolCalls: result.toolCalls,
      reply: result.reply || null,
      error: result.reply || result.actions.length ? null : `Sem resposta (${result.stopReason})`,
      durationMs: Date.now() - started
    } as any);
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`AI agent ${agent.id} failed on ticket ${ticket.id}: ${err}`);
    await AiAgentRun.create({
      ...run,
      error: String((err as Error)?.message || err).slice(0, 2000),
      durationMs: Date.now() - started
    } as any);
  }
};

// One turn at a time per ticket; messages that arrive meanwhile trigger
// one more turn when it ends.
const runForTicket = async (ticketId: number, agentId: number, send: Sender, typing?: Typing) => {
  if (running.has(ticketId)) {
    pendingRerun.add(ticketId);
    return;
  }
  running.add(ticketId);
  try {
    do {
      pendingRerun.delete(ticketId);
      await turn(ticketId, agentId, send, typing);
    } while (pendingRerun.has(ticketId));
  } finally {
    running.delete(ticketId);
  }
};

/**
 * Called for each incoming customer message. Returns true when the
 * connection's AI agent owns the conversation (the caller must skip the
 * chatbot flow and queue routing); the reply is sent after a short pause.
 */
export const handleAiAgentMessage = async (params: {
  ticket: Ticket;
  whatsapp: Whatsapp;
  send: Sender;
  typing?: Typing;
}): Promise<boolean> => {
  const { ticket, whatsapp, send, typing } = params;
  if (!whatsapp.aiAgentId || !agentMayAnswer(ticket)) return false;
  if (!(await hasPlanFeature(ticket.companyId, "useAiAgents"))) return false;

  const agent = await AiAgent.findOne({
    where: { id: whatsapp.aiAgentId, companyId: ticket.companyId, status: "active" },
    attributes: ["id", "tools"]
  });
  if (!agent) return false;

  clearTimeout(timers.get(ticket.id));
  timers.set(
    ticket.id,
    setTimeout(() => {
      timers.delete(ticket.id);
      runForTicket(ticket.id, agent.id, send, typing).catch(err => logger.error(`AI agent queue error: ${err}`));
    }, debounceMs(agent))
  );
  return true;
};
