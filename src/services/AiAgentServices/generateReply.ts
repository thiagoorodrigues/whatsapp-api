import AiAgent from "../../models/AiAgent";
import { getProvider } from "./providers";
import { buildContext, buildSystemPrompt } from "./prompt";
import { buildToolSet, DeferredAction } from "./tools";
import { HttpContext } from "./httpTools";
import { openMcpSession } from "./mcpTools";
import { ChatMessage, ToolCallRecord } from "./types";

export const MAX_TOOL_STEPS = 8;

export interface ReplyResult {
  reply: string;
  actions: DeferredAction[];
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  // MCP servers that could not be reached this turn.
  unavailableServers: string[];
}

// One agent reply for a conversation, shared by live chats and the test
// console so both behave the same.
const generateReply = async (params: {
  agent: AiAgent;
  apiKey: string;
  history: ChatMessage[];
  queues: { id: number; name: string }[];
  companyName?: string;
  contactName?: string;
  httpContext?: HttpContext;
}): Promise<ReplyResult> => {
  const { agent, apiKey, history, queues } = params;
  const toolSet = buildToolSet(agent.tools || {}, {
    queues,
    http: params.httpContext || { contactName: params.contactName }
  });
  const mcp = await openMcpSession(agent.tools?.mcp || [], { companyId: agent.companyId });

  const executeTool = (name: string, input: unknown) =>
    mcp.handles(name)
      ? mcp.call(name, input && typeof input === "object" ? (input as Record<string, unknown>) : {})
      : toolSet.execute(name, input);

  const result = await getProvider(agent.provider).runTurn({
    apiKey,
    model: agent.model,
    effort: agent.effort,
    maxTokens: agent.maxTokens,
    temperature: agent.temperature,
    system: buildSystemPrompt(agent.prompt || ""),
    systemContext: buildContext({ companyName: params.companyName, contactName: params.contactName }),
    history,
    tools: [...toolSet.definitions, ...mcp.definitions],
    executeTool,
    maxSteps: MAX_TOOL_STEPS
  }).finally(() => mcp.close());

  return {
    reply: result.text,
    actions: toolSet.actions,
    toolCalls: result.toolCalls,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    stopReason: result.stopReason,
    unavailableServers: mcp.failures
  };
};

export default generateReply;
