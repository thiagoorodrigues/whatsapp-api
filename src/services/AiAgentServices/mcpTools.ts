import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { decryptSecret, encryptSecret } from "../../helpers/secretBox";
import { HttpToolHeader, MAX_RESPONSE_CHARS, publicFetch, slug } from "./httpTools";
import { accessTokenFor } from "./mcpOAuth";
import { ToolDefinition } from "./types";

// Remote MCP servers (Streamable HTTP) of an agent: their tools are listed at
// the start of each turn and offered to the model next to the built-in ones.

export interface McpServer {
  id: string;
  name: string;
  url: string;
  headers: HttpToolHeader[];
  // "oauth": an account connected by login (see mcpOAuth); headers still apply.
  auth: "headers" | "oauth";
  // Tool names to offer; empty offers all of them.
  allowedTools: string[];
}

export interface McpContext {
  companyId: number;
}

// The server asks for an OAuth login (or the connected account is gone).
export class McpOAuthRequired extends Error {
  constructor(message = "conta não conectada") {
    super(message);
    this.name = "McpOAuthRequired";
  }
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export const MAX_MCP_SERVERS = 5;
export const MAX_TOOLS_PER_SERVER = 40;
const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 2_000_000;
const PROTOCOL_VERSION = "2025-06-18";
// RFC 9110 token characters.
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

const bad = (message: string) => new AppError(`ERR_AI_MCP_INVALID: ${message}`);

export const serverPrefix = (server: Pick<McpServer, "name">) =>
  `mcp_${slug(server.name).slice(0, 20) || "servidor"}`;

export const sanitizeMcpServers = (input: unknown, previous: McpServer[] = []): McpServer[] => {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw bad("lista inválida");
  if (input.length > MAX_MCP_SERVERS) throw bad(`no máximo ${MAX_MCP_SERVERS} servidores`);

  const prefixes = new Set<string>();
  return input.map((raw: any, index): McpServer => {
    const name = String(raw?.name || "").trim().slice(0, 60);
    if (!name) throw bad(`servidor ${index + 1} sem nome`);
    const prefix = serverPrefix({ name });
    if (prefixes.has(prefix)) throw bad(`nome repetido: ${name}`);
    prefixes.add(prefix);

    const url = String(raw?.url || "").trim().slice(0, 2000);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (e) {
      throw bad(`URL inválida em "${name}"`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw bad(`"${name}" precisa usar http ou https`);

    const id = typeof raw?.id === "string" && raw.id ? raw.id.slice(0, 40) : `mcp_${Date.now()}_${index}`;
    const before = previous.find(p => p.id === id);

    const headers: HttpToolHeader[] = (Array.isArray(raw?.headers) ? raw.headers : [])
      .slice(0, 20)
      .filter((h: any) => String(h?.key || "").trim())
      .map((h: any) => {
        const key = String(h.key).trim();
        if (!HEADER_NAME.test(key)) throw bad(`cabeçalho inválido "${key}" em "${name}"`);
        const value = typeof h.value === "string" ? h.value : "";
        if (value) return { key, valueEncrypted: encryptSecret(value.slice(0, 4000)) };
        const kept = before?.headers.find(x => x.key.toLowerCase() === key.toLowerCase());
        return kept?.valueEncrypted ? { key, valueEncrypted: kept.valueEncrypted } : { key };
      });

    const allowedTools = (Array.isArray(raw?.allowedTools) ? raw.allowedTools : [])
      .map((t: unknown) => String(t).slice(0, 128))
      .filter(Boolean)
      .slice(0, 200);

    const auth = raw?.auth === "oauth" ? "oauth" : "headers";
    return { id, name, url, headers, auth, allowedTools };
  });
};

export const serializeMcpServers = (servers: McpServer[] = []) =>
  servers.map(s => ({
    ...s,
    headers: (s.headers || []).map(h => ({ key: h.key, hasValue: !!h.valueEncrypted }))
  }));

// A JSON-RPC reply may come as plain JSON or as an SSE stream.
export const readReply = (contentType: string, text: string, id: number) => {
  const messages: any[] = [];
  if (contentType.includes("text/event-stream")) {
    text.split(/\r?\n\r?\n/).forEach(event => {
      const data = event
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      try {
        messages.push(JSON.parse(data));
      } catch (e) {
        // keep-alives and partial events
      }
    });
  } else if (text) {
    const parsed = JSON.parse(text);
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const reply = messages.find(m => m && m.id === id);
  if (!reply) throw new Error("resposta inválida do servidor MCP");
  if (reply.error) throw new Error(String(reply.error.message || "erro do servidor MCP"));
  return reply.result;
};

// Explains a failed request; servers that require OAuth announce it in
// WWW-Authenticate (resource_metadata, RFC 9728).
export const authError = (status: number, wwwAuthenticate?: string | null) => {
  if (status !== 401 && status !== 403) return `HTTP ${status}`;
  const challenge = String(wwwAuthenticate || "");
  if (/resource_metadata|authorization_uri|oauth/i.test(challenge)) {
    return `HTTP ${status}: este servidor exige login OAuth pelo navegador, que ainda não é suportado. Use um servidor que aceite chave de API em cabeçalho.`;
  }
  const scheme = challenge.split(/\s/)[0];
  return `HTTP ${status}: o servidor recusou a autenticação. Confira o cabeçalho e o valor${
    scheme ? ` (o servidor pede o esquema "${scheme}", ex.: Authorization: ${scheme} sua_chave)` : ", ex.: Authorization: Bearer sua_chave"
  }.`;
};

/**
 * Minimal MCP client over Streamable HTTP (initialize, tools/list,
 * tools/call). Every request goes through the same public-address check as
 * the HTTP tools and never follows redirects.
 */
export class McpClient {
  private nextId = 1;

  private sessionId: string | null = null;

  private protocol = PROTOCOL_VERSION;

  // getToken: OAuth access token of the server (force = refresh it first).
  constructor(
    private server: McpServer,
    private headers: Record<string, string>,
    private getToken?: (force: boolean) => Promise<string | null>
  ) {}

  private async send(body: any, timeoutMs: number, token: string | null) {
    return publicFetch(
      this.server.url,
      {
        method: "POST",
        headers: {
          ...this.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": this.protocol,
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {})
        },
        body: JSON.stringify(body)
      },
      timeoutMs
    );
  }

  private async post(body: any, timeoutMs: number) {
    try {
      let token = this.getToken ? await this.getToken(false) : null;
      if (this.getToken && !token) throw new McpOAuthRequired();
      let response = await this.send(body, timeoutMs, token);
      // An expired OAuth token: refresh once and retry.
      if (response.status === 401 && this.getToken) {
        token = await this.getToken(true);
        if (!token) throw new McpOAuthRequired("o acesso expirou; conecte a conta de novo");
        response = await this.send(body, timeoutMs, token);
      }
      if (response.status >= 300) {
        const message = authError(response.status, response.headers.get("www-authenticate"));
        if (message.includes("OAuth")) throw new McpOAuthRequired(message);
        throw new Error(message);
      }
      const session = response.headers.get("mcp-session-id");
      if (session) this.sessionId = session;
      if (body.id === undefined) return null;
      const text = String(await response.text()).slice(0, MAX_BODY_CHARS);
      return readReply(String(response.headers.get("content-type") || ""), text, body.id);
    } catch (err) {
      if ((err as Error)?.message === "tempo esgotado") throw new Error(`${this.server.name}: tempo esgotado`);
      throw err;
    }
  }

  private request(method: string, params: any, timeoutMs = CONNECT_TIMEOUT_MS) {
    const id = this.nextId++;
    return this.post({ jsonrpc: "2.0", id, method, params }, timeoutMs);
  }

  async connect() {
    const result = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wazzy-ai-agent", version: "1.0.0" }
    });
    if (result?.protocolVersion) this.protocol = result.protocolVersion;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, CONNECT_TIMEOUT_MS);
  }

  async listTools(): Promise<any[]> {
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(page?.tools || []));
      cursor = page?.nextCursor;
    } while (cursor && tools.length < 500);
    return tools;
  }

  callTool(name: string, args: Record<string, unknown>) {
    return this.request("tools/call", { name, arguments: args }, CALL_TIMEOUT_MS);
  }

  // Stateless servers have nothing to end; stateful ones accept DELETE.
  async close() {
    if (!this.sessionId) return;
    try {
      const token = this.getToken ? await this.getToken(false) : null;
      await publicFetch(this.server.url, {
        method: "DELETE",
        headers: {
          ...this.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Mcp-Session-Id": this.sessionId
        }
      });
    } catch (e) {
      // best effort
    }
  }
}

const connect = async (server: McpServer, ctx: McpContext) => {
  const headers: Record<string, string> = {};
  for (const h of server.headers || []) {
    if (h.valueEncrypted) headers[h.key] = decryptSecret(h.valueEncrypted);
  }
  const getToken =
    server.auth === "oauth"
      ? (force: boolean) => accessTokenFor(ctx.companyId, server.id, { forceRefresh: force })
      : undefined;
  const client = new McpClient(server, headers, getToken);
  await client.connect();
  return client;
};

/**
 * Lists the tools a server offers (editor "testar conexão"). Throws
 * McpOAuthRequired when the server needs an account connected first.
 */
export const probeMcpServer = async (server: McpServer, ctx: McpContext): Promise<McpToolInfo[]> => {
  const client = await connect(server, ctx);
  try {
    const tools = await client.listTools();
    return tools.map(t => ({ name: t.name, description: String(t.description || "").slice(0, 500) }));
  } finally {
    await client.close();
  }
};

export const resultText = (result: any): string => {
  const parts = (result?.content || []).map((c: any) => {
    if (c.type === "text") return c.text;
    if (c.type === "resource" && c.resource?.text) return c.resource.text;
    return `[${c.type}]`;
  });
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n");
  return text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}… (resposta cortada)` : text;
};

export interface McpSession {
  definitions: ToolDefinition[];
  handles: (name: string) => boolean;
  call: (name: string, input: Record<string, unknown>) => Promise<{ result: string; error?: boolean }>;
  close: () => Promise<void>;
  // Servers that could not be reached this turn (logged, not fatal).
  failures: string[];
}

/**
 * Connects to the agent's MCP servers for one turn. A server that fails is
 * skipped so the agent still answers with its other tools.
 */
export const openMcpSession = async (servers: McpServer[] = [], ctx: McpContext): Promise<McpSession> => {
  const clients: McpClient[] = [];
  const routes: Record<string, { client: McpClient; tool: string }> = {};
  const definitions: ToolDefinition[] = [];
  const failures: string[] = [];

  await Promise.all(
    servers.map(async server => {
      try {
        const client = await connect(server, ctx);
        clients.push(client);
        const allowed = server.allowedTools || [];
        const tools = (await client.listTools())
          .filter(t => !allowed.length || allowed.includes(t.name))
          .slice(0, MAX_TOOLS_PER_SERVER);
        const prefix = serverPrefix(server);
        tools.forEach(t => {
          const name = `${prefix}__${slug(t.name)}`.slice(0, 64);
          if (routes[name]) return;
          routes[name] = { client, tool: t.name };
          definitions.push({
            name,
            description: `${String(t.description || t.name).slice(0, 1000)}\n(Ferramenta do servidor MCP "${server.name}".)`,
            parameters:
              t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} }
          });
        });
      } catch (err) {
        failures.push(server.name);
        logger.warn(`MCP server "${server.name}" unavailable: ${err}`);
      }
    })
  );

  return {
    definitions,
    failures,
    handles: name => !!routes[name],
    call: async (name, input) => {
      const route = routes[name];
      if (!route) return { result: `Ferramenta desconhecida: ${name}`, error: true };
      try {
        const result = await route.client.callTool(route.tool, input);
        return { result: resultText(result) || "(sem conteúdo)", error: !!result?.isError };
      } catch (err) {
        return { result: `Falha ao chamar a ferramenta: ${String((err as Error)?.message || err)}`, error: true };
      }
    },
    close: async () => {
      await Promise.all(clients.map(c => c.close()));
    }
  };
};
