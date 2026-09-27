import { Request, Response } from "express";
import AppError from "../errors/AppError";
import Company from "../models/Company";
import Queue from "../models/Queue";
import {
  listAgents,
  showAgent,
  findAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  setAgentConnections,
  listRuns
} from "../services/AiAgentServices/AgentService";
import { agentKey, listModelsWithKey } from "../services/AiAgentServices/keys";
import generateReply from "../services/AiAgentServices/generateReply";
import { ChatMessage } from "../services/AiAgentServices/types";
import { callHttpTool, sanitizeHttpTools } from "../services/AiAgentServices/httpTools";
import { McpOAuthRequired, probeMcpServer, sanitizeMcpServers } from "../services/AiAgentServices/mcpTools";
import {
  completeAuthorization,
  connectionStatuses,
  disconnect,
  startAuthorization
} from "../services/AiAgentServices/mcpOAuth";

const admin = (req: Request) => {
  if (req.user.profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403);
};

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listAgents(req.user.companyId));

export const show = async (req: Request, res: Response): Promise<Response> =>
  res.json(await showAgent(req.params.agentId, req.user.companyId));

export const store = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.status(200).json(await createAgent(req.body, req.user.companyId));
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateAgent(req.params.agentId, req.body, req.user.companyId));
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  await deleteAgent(req.params.agentId, req.user.companyId);
  return res.status(200).json({ message: "Agent deleted" });
};

export const connections = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await setAgentConnections(req.params.agentId, req.body.whatsappIds, req.user.companyId));
};

export const runs = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listRuns(req.user.companyId, req.query.agentId as string | undefined));

// Models of a provider, with the key being typed (not saved yet) or the
// agent's saved key when it keeps the same provider.
export const models = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const { provider } = req.params;
  let apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey && req.body.agentId) {
    const agent = await findAgent(req.body.agentId, req.user.companyId);
    if (agent.provider === provider) apiKey = agentKey(agent) || "";
  }
  if (!apiKey) throw new AppError("ERR_AI_KEY_MISSING");
  return res.json(await listModelsWithKey(provider, apiKey));
};

// Test console: runs the agent on a conversation typed in the panel.
// Ticket actions (transfer/close) are reported, never applied.
export const test = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const { companyId } = req.user;
  const agent = await findAgent(req.params.agentId, companyId);
  const apiKey = agentKey(agent);
  if (!apiKey) throw new AppError("ERR_AI_KEY_MISSING");

  const history: ChatMessage[] = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .slice(-40)
    .map((m: any) => ({
      role: m && m.role === "assistant" ? "assistant" : "user",
      text: String((m && m.text) || "").slice(0, 4000)
    }));
  if (!history.length) throw new AppError("ERR_AI_TEST_EMPTY");

  const [queues, company] = await Promise.all([
    Queue.findAll({ where: { companyId }, attributes: ["id", "name"] }),
    Company.findByPk(companyId, { attributes: ["name"] })
  ]);

  try {
    const result = await generateReply({
      agent,
      apiKey,
      history,
      queues: queues.map(q => ({ id: q.id, name: q.name })),
      companyName: company?.name,
      contactName: "Cliente de teste"
    });
    return res.json(result);
  } catch (err) {
    throw new AppError(`ERR_AI_PROVIDER: ${String((err as Error)?.message || err).slice(0, 300)}`, 502);
  }
};

// Stored settings of the agent being edited, so a header left blank in the
// editor reuses its saved value when testing.
const savedTools = async (req: Request) =>
  req.body.agentId ? (await findAgent(req.body.agentId, req.user.companyId)).tools || {} : {};

export const testHttpTool = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const [tool] = sanitizeHttpTools([req.body.tool], (await savedTools(req)).http);
  const input = req.body.input && typeof req.body.input === "object" ? req.body.input : {};
  return res.json(
    await callHttpTool(tool, input, { contactName: "Cliente de teste", contactNumber: "5511999999999", ticketId: 0 })
  );
};

export const probeMcp = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const [server] = sanitizeMcpServers([req.body.server], (await savedTools(req)).mcp);
  try {
    return res.json({ tools: await probeMcpServer(server, { companyId: req.user.companyId }) });
  } catch (err) {
    // The editor then offers "Conectar conta".
    if (err instanceof McpOAuthRequired) return res.json({ oauthRequired: true, message: err.message, tools: [] });
    throw new AppError(`ERR_AI_MCP_UNREACHABLE: ${String((err as Error)?.message || err).slice(0, 300)}`, 502);
  }
};

const serverIdOf = (value: unknown) => {
  const id = String(value || "");
  if (!/^[\w-]{8,40}$/.test(id)) throw new AppError("ERR_AI_MCP_INVALID: servidor sem identificador");
  return id;
};

export const startMcpOAuth = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const [server] = sanitizeMcpServers([req.body.server]);
  const clientId = String(req.body.clientId || "").trim();
  const clientSecret = String(req.body.clientSecret || "").trim();
  if (req.body.agentId) await findAgent(req.body.agentId, req.user.companyId);
  try {
    const authorizationUrl = await startAuthorization({
      companyId: req.user.companyId,
      agentId: req.body.agentId ? Number(req.body.agentId) : null,
      serverId: serverIdOf(req.body.server?.id),
      serverUrl: server.url,
      client: clientId ? { clientId, clientSecret: clientSecret || undefined } : null
    });
    return res.json({ authorizationUrl });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`ERR_AI_MCP_OAUTH_FAILED: ${String((err as Error)?.message || err).slice(0, 300)}`, 502);
  }
};

export const mcpOAuthStatus = async (req: Request, res: Response): Promise<Response> => {
  const serverId = serverIdOf(req.query.serverId);
  const statuses = await connectionStatuses(req.user.companyId, [serverId]);
  return res.json(statuses[serverId] || { status: "none" });
};

export const disconnectMcpOAuth = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  await disconnect(req.user.companyId, serverIdOf(req.params.serverId));
  return res.status(204).send();
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Public: the login window lands here; the state ties it to the connection.
export const mcpOAuthCallback = async (req: Request, res: Response): Promise<Response> => {
  const result = await completeAuthorization(req.query as any);
  const origin = JSON.stringify(process.env.FRONTEND_URL || "*");
  const payload = JSON.stringify({ type: "mcp-oauth", ok: result.ok });
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  return res.status(result.ok ? 200 : 400).send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${result.ok ? "Conta conectada" : "Conta não conectada"}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f6f6f7;color:#1f2328}
main{max-width:420px;margin:16px;padding:28px;border-radius:14px;background:#fff;border:1px solid #e3e3e6;text-align:center}
h1{margin:0 0 8px;font-size:19px}p{margin:0;font-size:14px;line-height:1.5;color:#555}</style></head>
<body><main><h1>${result.ok ? "Conta conectada" : "Conta não conectada"}</h1><p>${escapeHtml(result.message)}</p></main>
<script>try{window.opener&&window.opener.postMessage(${payload},${origin});}catch(e){}${result.ok ? "setTimeout(function(){window.close();},1200);" : ""}</script>
</body></html>`);
};
