import * as Sentry from "@sentry/node";
import { OutgoingContent } from "../../channels/types";

import { qualifyContactDeal, registerContactDeal } from "../CrmServices/AgentDealService";
import AiAgent from "../../models/AiAgent";
import AiAgentRun from "../../models/AiAgentRun";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { hasPlanFeature } from "../../helpers/planFeature";
import { logger } from "../../utils/logger";
import { agentKey } from "./keys";
import generateReply from "./generateReply";
import { ChatMessage } from "./types";
import { DeferredAction } from "./tools";

// Sends to the ticket and saves the message (see SendTicketMessageService).
type Sender = (content: OutgoingContent) => Promise<unknown>;

// Customers often send several short messages in a row: wait for a pause
// and answer them together.
const DEBOUNCE_MS = Number(process.env.AI_AGENT_DEBOUNCE_MS) || 3000;

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
  !ticket.queueId &&
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
    qualify: () => qualifyContactDeal({ ...target, stageId: cfg.qualifiedStageId })
  };
};

const applyActions = async (ticket: Ticket, actions: DeferredAction[]) => {
  for (const action of actions) {
    if (action.type === "transfer") {
      await ticket.update({ aiStoppedAt: new Date() });
      await UpdateTicketService({
        ticketData: { queueId: action.queueId, status: "pending", chatbot: false } as any,
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

const turn = async (ticketId: number, agentId: number, send: Sender) => {
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
      crm: crmFor(agent, ticket)
    });

    if (result.reply) await send({ type: "text", text: result.reply });
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
const runForTicket = async (ticketId: number, agentId: number, send: Sender) => {
  if (running.has(ticketId)) {
    pendingRerun.add(ticketId);
    return;
  }
  running.add(ticketId);
  try {
    do {
      pendingRerun.delete(ticketId);
      await turn(ticketId, agentId, send);
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
}): Promise<boolean> => {
  const { ticket, whatsapp, send } = params;
  if (!whatsapp.aiAgentId || !agentMayAnswer(ticket)) return false;
  if (!(await hasPlanFeature(ticket.companyId, "useAiAgents"))) return false;

  const agent = await AiAgent.findOne({
    where: { id: whatsapp.aiAgentId, companyId: ticket.companyId, status: "active" },
    attributes: ["id"]
  });
  if (!agent) return false;

  clearTimeout(timers.get(ticket.id));
  timers.set(
    ticket.id,
    setTimeout(() => {
      timers.delete(ticket.id);
      runForTicket(ticket.id, agent.id, send).catch(err => logger.error(`AI agent queue error: ${err}`));
    }, DEBOUNCE_MS)
  );
  return true;
};
