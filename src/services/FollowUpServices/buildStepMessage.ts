import path from "path";
import uploadConfig from "../../config/upload";
import formatBody from "../../helpers/Mustache";
import { contentFromFile } from "../../channels/media";
import { OutgoingContent } from "../../channels/types";
import AiAgent from "../../models/AiAgent";
import Message from "../../models/Message";
import FollowUpRule from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { getProvider } from "../AiAgentServices/providers";
import { agentKey } from "../AiAgentServices/keys";
import { toHistory, trimHistory } from "../AiAgentServices/RunAiAgentService";

export const AI_TIMEOUT_MS = 30000;
const AI_HISTORY = 20;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const fixedContent = (step: FollowUpStep, ticket: Ticket): OutgoingContent => {
  const text = formatBody(step.body, ticket.contact);
  const own = step.mediaPath && step.mediaPath.startsWith(`company${ticket.companyId}/`) && !step.mediaPath.includes("..");
  if (!own) {
    if (step.mediaPath) logger.warn(`Follow-up step ${step.id} has media outside company ${ticket.companyId}; sending text only`);
    return { type: "text", text };
  }
  return contentFromFile(step.mediaName || "", path.resolve(uploadConfig.directory, step.mediaPath), text);
};

const aiText = async (step: FollowUpStep, ticket: Ticket, rule: FollowUpRule): Promise<string | null> => {
  if (!rule.aiAgentId) return null;
  const agent = await AiAgent.findOne({ where: { id: rule.aiAgentId, companyId: ticket.companyId } });
  const apiKey = agent ? agentKey(agent) : null;
  if (!agent || !apiKey) return null;
  const recent = await Message.findAll({
    where: { ticketId: ticket.id, isPrivate: false },
    order: [["createdAt", "DESC"]],
    limit: AI_HISTORY
  });
  const history = trimHistory(toHistory(recent.reverse()));
  // The conversation ends with our message; the request to write the
  // follow-up goes as the last turn so every provider accepts it.
  history.push({
    role: "user",
    text:
      `[Instrução interna, não é do cliente] O cliente não respondeu à última mensagem. ${step.aiInstruction}\n` +
      "Escreva somente a mensagem que será enviada ao cliente, curta e natural, sem aspas."
  });
  const result = await withTimeout(
    getProvider(agent.provider).runTurn({
      apiKey,
      model: agent.model,
      system: agent.prompt || "",
      systemContext: `Contato: ${ticket.contact?.name || ""}`,
      history,
      tools: [],
      executeTool: async () => ({ result: "", error: true }),
      maxSteps: 1
    }),
    AI_TIMEOUT_MS
  );
  return result.text?.trim() || null;
};

export const buildStepMessage = async (step: FollowUpStep, ticket: Ticket, rule: FollowUpRule): Promise<OutgoingContent> => {
  if (step.mode === "ai") {
    try {
      const text = await aiText(step, ticket, rule);
      if (text) return { type: "text", text };
      logger.warn(`Follow-up step ${step.id}: AI unavailable, sending the fixed text`);
    } catch (err) {
      logger.warn(`Follow-up step ${step.id}: AI failed (${err}), sending the fixed text`);
    }
  }
  return fixedContent(step, ticket);
};
