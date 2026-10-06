import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import AiAgent, { AiAgentTools } from "../../models/AiAgent";
import AiAgentRun from "../../models/AiAgentRun";
import Whatsapp from "../../models/Whatsapp";
import { isProviderName } from "./providers";
import { validateKey } from "./keys";
import { sanitizeHttpTools, serializeHttpTools } from "./httpTools";
import { sanitizeMcpServers, serializeMcpServers } from "./mcpTools";
import { connectionStatuses, syncAgentConnections } from "./mcpOAuth";
import { splitToolConfig, waitToolConfig } from "./messageParts";
import { assertCrmToolConfig, crmConfigChanged, crmToolConfig } from "../CrmServices/AgentDealService";

const EFFORTS = ["low", "medium", "high"];
const STATUSES = ["draft", "active", "paused"];

interface AgentData {
  name?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  effort?: string | null;
  tools?: AiAgentTools;
  status?: string;
  maxTokens?: number | null;
  temperature?: number | null;
  // Write-only: validated and stored encrypted; empty keeps the current one.
  apiKey?: string;
}

const connectionAttributes = ["id", "name", "status"];

const clean = (data: AgentData, partial: boolean, previous: AiAgentTools = {}) => {
  const out: Record<string, unknown> = {};
  if (data.name !== undefined || !partial) {
    const name = (data.name || "").trim();
    if (!name) throw new AppError("ERR_AI_AGENT_NAME_REQUIRED");
    out.name = name.slice(0, 120);
  }
  if (data.provider !== undefined || !partial) {
    if (!isProviderName(data.provider)) throw new AppError("ERR_AI_PROVIDER_INVALID");
    out.provider = data.provider;
  }
  if (data.model !== undefined || !partial) {
    const model = (data.model || "").trim();
    if (!model) throw new AppError("ERR_AI_MODEL_REQUIRED");
    out.model = model;
  }
  if (data.prompt !== undefined) out.prompt = String(data.prompt).slice(0, 60000);
  if (data.effort !== undefined) out.effort = EFFORTS.includes(data.effort) ? data.effort : null;
  if (data.status !== undefined) out.status = STATUSES.includes(data.status) ? data.status : "draft";
  if (data.maxTokens !== undefined) {
    const value = Number(data.maxTokens);
    out.maxTokens = value ? Math.min(Math.max(Math.round(value), 256), 16000) : null;
  }
  if (data.temperature !== undefined) {
    const value = data.temperature === null || data.temperature === ("" as any) ? NaN : Number(data.temperature);
    out.temperature = Number.isFinite(value) ? Math.min(Math.max(value, 0), 2) : null;
  }
  if (data.tools !== undefined) {
    const tools = data.tools || {};
    out.tools = {
      transfer: {
        enabled: !!tools.transfer?.enabled,
        queueIds: (tools.transfer?.queueIds || []).map(Number).filter(Boolean)
      },
      close: { enabled: !!tools.close?.enabled },
      http: sanitizeHttpTools(tools.http, previous.http),
      mcp: sanitizeMcpServers(tools.mcp, previous.mcp),
      crm: crmToolConfig(tools.crm),
      split: splitToolConfig(tools.split),
      wait: waitToolConfig(tools.wait)
    };
  }
  return out;
};

// What clients see: never the key itself.
export const serializeAgent = (agent: AiAgent) => {
  const { apiKeyEncrypted, ...rest } = agent.toJSON() as any;
  const tools = rest.tools || {};
  return {
    ...rest,
    tools: { ...tools, http: serializeHttpTools(tools.http), mcp: serializeMcpServers(tools.mcp) },
    hasKey: !!apiKeyEncrypted
  };
};

export const listAgents = async (companyId: number) => {
  const agents = await AiAgent.findAll({
    where: { companyId },
    include: [{ model: Whatsapp, attributes: connectionAttributes }],
    order: [["name", "ASC"]]
  });
  return agents.map(serializeAgent);
};

// Full record, key included: server-side use only.
export const findAgent = async (id: number | string, companyId: number) => {
  if (!/^\d+$/.test(String(id))) throw new AppError("ERR_AI_AGENT_NOT_FOUND", 404);
  const agent = await AiAgent.findOne({
    where: { id, companyId },
    include: [{ model: Whatsapp, attributes: connectionAttributes }]
  });
  if (!agent) throw new AppError("ERR_AI_AGENT_NOT_FOUND", 404);
  return agent;
};

// With the login status of its OAuth MCP servers.
export const showAgent = async (id: number | string, companyId: number) => {
  const data: any = serializeAgent(await findAgent(id, companyId));
  const oauthIds = (data.tools.mcp || []).filter((m: any) => m.auth === "oauth").map(m => m.id);
  const statuses = await connectionStatuses(companyId, oauthIds);
  data.tools.mcp = data.tools.mcp.map((m: any) =>
    m.auth === "oauth" ? { ...m, oauth: statuses[m.id] || { status: "none" } } : m
  );
  return data;
};

const oauthServerIds = (tools: AiAgentTools = {}) => (tools.mcp || []).filter(m => m.auth === "oauth").map(m => m.id);

export const createAgent = async (data: AgentData, companyId: number) => {
  const values = clean(
    {
      prompt: "",
      tools: { transfer: { enabled: true }, close: { enabled: true } },
      ...data
    },
    false
  );
  await assertCrmToolConfig(companyId, crmToolConfig((values.tools as AiAgentTools | undefined)?.crm));
  const key = data.apiKey ? await validateKey(values.provider as string, data.apiKey) : {};
  const agent = await AiAgent.create({ ...values, ...key, companyId } as any);
  await syncAgentConnections(companyId, agent.id, oauthServerIds(agent.tools));
  return showAgent(agent.id, companyId);
};

export const updateAgent = async (id: number | string, data: AgentData, companyId: number) => {
  const agent = await findAgent(id, companyId);
  const values = clean(data, true, agent.tools || {});
  // Only a changed CRM setting is checked again, so an agent whose funnel was
  // archived (or whose plan lost the CRM) can still be saved and fixed.
  const nextCrm = values.tools ? crmToolConfig((values.tools as AiAgentTools).crm) : null;
  if (nextCrm && crmConfigChanged(agent.tools?.crm, nextCrm)) await assertCrmToolConfig(companyId, nextCrm);
  const provider = (values.provider as string) || agent.provider;
  let key: Record<string, unknown> = {};
  if (data.apiKey) {
    key = await validateKey(provider, data.apiKey);
  } else if (provider !== agent.provider) {
    // A key belongs to one provider.
    key = { apiKeyEncrypted: null, keyHint: null };
  }
  await agent.update({ ...values, ...key });
  if (values.tools) await syncAgentConnections(companyId, agent.id, oauthServerIds(agent.tools));
  return showAgent(id, companyId);
};

export const deleteAgent = async (id: number | string, companyId: number) => {
  const agent = await findAgent(id, companyId);
  await Whatsapp.update({ aiAgentId: null } as any, { where: { aiAgentId: agent.id, companyId } });
  await agent.destroy();
};

// A connection is answered by at most one agent; choosing it here takes it
// from any other agent. A connection with an agent does not run its flow.
export const setAgentConnections = async (id: number | string, whatsappIds: number[], companyId: number) => {
  const agent = await findAgent(id, companyId);
  const ids = (whatsappIds || []).map(Number).filter(Boolean);
  await Whatsapp.update({ aiAgentId: null } as any, {
    where: { aiAgentId: agent.id, companyId, id: { [Op.notIn]: ids.length ? ids : [0] } }
  });
  if (ids.length) {
    await Whatsapp.update({ aiAgentId: agent.id } as any, { where: { id: ids, companyId } });
  }
  return showAgent(id, companyId);
};

export const listRuns = (companyId: number, agentId?: number | string) =>
  AiAgentRun.findAll({
    where: { companyId, ...(agentId ? { agentId } : {}) },
    order: [["createdAt", "DESC"]],
    limit: 50
  });
