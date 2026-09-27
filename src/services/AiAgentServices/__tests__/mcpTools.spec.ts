import dns from "dns";

const accessTokenFor = jest.fn();
jest.mock("../mcpOAuth", () => ({ accessTokenFor: (...args: any[]) => accessTokenFor(...args) }));

// eslint-disable-next-line import/first
import { authError, McpOAuthRequired, openMcpSession, probeMcpServer, readReply, resultText, sanitizeMcpServers, serializeMcpServers } from "../mcpTools";

const fetchMock = jest.fn();

beforeAll(() => {
  process.env.SECRETS_KEY = "test-secrets-key";
  (globalThis as any).fetch = fetchMock;
});

beforeEach(() => {
  fetchMock.mockReset();
  jest.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
});

afterEach(() => jest.restoreAllMocks());

const response = (body: any, headers: Record<string, string> = {}, status = 200) => ({
  status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body))
});

// Fake MCP server answering by JSON-RPC method.
const serve = (tools: any[], callResult: any) =>
  fetchMock.mockImplementation(async (url: string, init: any) => {
    if (init.method === "DELETE") return response("");
    const msg = JSON.parse(init.body);
    if (msg.method === "initialize") {
      return response({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }, { "mcp-session-id": "s1" });
    }
    if (msg.method === "notifications/initialized") return response("", {}, 202);
    if (msg.method === "tools/list") {
      return response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } })}\n\n`, {
        "content-type": "text/event-stream"
      });
    }
    return response({ jsonrpc: "2.0", id: msg.id, result: callResult }, { "content-type": "application/json" });
  });

const server = { name: "Agenda", url: "https://mcp.exemplo.com/mcp", headers: [{ key: "Authorization", value: "Bearer x" }] };

describe("sanitizeMcpServers", () => {
  it("encrypts and masks headers", () => {
    const [saved] = sanitizeMcpServers([server]);
    expect(JSON.stringify(saved)).not.toContain("Bearer x");
    expect(serializeMcpServers([saved])[0].headers).toEqual([{ key: "Authorization", hasValue: true }]);
  });

  it("accepts header names with underscore and rejects invalid ones", () => {
    expect(sanitizeMcpServers([{ ...server, headers: [{ key: "CAL_API_KEY", value: "k" }] }])[0].headers[0].key).toBe("CAL_API_KEY");
    expect(() => sanitizeMcpServers([{ ...server, headers: [{ key: "Minha Chave", value: "k" }] }])).toThrow("cabeçalho inválido");
  });

  it("rejects bad URLs", () => {
    expect(() => sanitizeMcpServers([{ ...server, url: "file:///etc" }])).toThrow("ERR_AI_MCP_INVALID");
  });
});

describe("readReply", () => {
  it("reads SSE and JSON bodies", () => {
    expect(readReply("text/event-stream", 'data: {"jsonrpc":"2.0","id":2,"result":{"a":1}}\n\n', 2)).toEqual({ a: 1 });
    expect(readReply("application/json", '{"jsonrpc":"2.0","id":3,"result":7}', 3)).toBe(7);
    expect(() => readReply("application/json", '{"jsonrpc":"2.0","id":3,"error":{"message":"nope"}}', 3)).toThrow("nope");
  });
});

describe("openMcpSession", () => {
  it("offers the server tools and routes calls to them", async () => {
    serve(
      [
        { name: "buscarHorarios", description: "Lista horários livres", inputSchema: { type: "object", properties: { dia: { type: "string" } } } },
        { name: "apagarTudo", description: "Não use" }
      ],
      { content: [{ type: "text", text: "09:00, 10:00" }] }
    );
    const [saved] = sanitizeMcpServers([{ ...server, allowedTools: ["buscarHorarios"] }]);
    const session = await openMcpSession([saved], { companyId: 1 });
    expect(session.definitions.map(d => d.name)).toEqual(["mcp_agenda__buscarhorarios"]);
    expect(await session.call("mcp_agenda__buscarhorarios", { dia: "hoje" })).toEqual({
      result: "09:00, 10:00",
      error: false
    });
    const call = fetchMock.mock.calls.find(([, init]) => init.body && JSON.parse(init.body).method === "tools/call");
    expect(JSON.parse(call[1].body).params).toEqual({ name: "buscarHorarios", arguments: { dia: "hoje" } });
    expect(call[1].headers["Mcp-Session-Id"]).toBe("s1");
    expect(call[1].headers.Authorization).toBe("Bearer x");
    await session.close();
    expect(fetchMock.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(true);
  });

  it("skips servers that fail and internal addresses", async () => {
    (dns.promises.lookup as jest.Mock).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const session = await openMcpSession(sanitizeMcpServers([server]), { companyId: 1 });
    expect(session.definitions).toEqual([]);
    expect(session.failures).toEqual(["Agenda"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resultText", () => {
  it("joins text parts and falls back to structured content", () => {
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe("a\n[image]");
    expect(resultText({ content: [], structuredContent: { ok: 1 } })).toBe('{"ok":1}');
  });
});

describe("authError", () => {
  it("explains OAuth-only servers and bad credentials", () => {
    expect(authError(401, 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"')).toContain("OAuth");
    expect(authError(401, 'Bearer realm="api"')).toContain('esquema "Bearer"');
    expect(authError(403, null)).toContain("Authorization: Bearer");
    expect(authError(500)).toBe("HTTP 500");
  });
});

describe("OAuth servers", () => {
  const oauthServer = () => sanitizeMcpServers([{ name: "Cal", url: "https://mcp.exemplo.com/mcp", auth: "oauth", id: "srv_aaaaaaaa" }]);

  beforeEach(() => accessTokenFor.mockReset());

  it("sends the account token and refreshes it once on 401", async () => {
    accessTokenFor.mockImplementation(async (companyId: number, id: string, opts: any) =>
      opts?.forceRefresh ? "novo" : "velho"
    );
    serve([{ name: "agendar", description: "Agenda" }], { content: [] });
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url: string, init: any) =>
      init.headers?.Authorization === "Bearer velho" ? response("", {}, 401) : base(url, init)
    );
    const session = await openMcpSession(oauthServer(), { companyId: 7 });
    expect(session.definitions.map(d => d.name)).toEqual(["mcp_cal__agendar"]);
    expect(accessTokenFor).toHaveBeenCalledWith(7, "srv_aaaaaaaa", { forceRefresh: true });
  });

  it("asks for a login when no account is connected", async () => {
    accessTokenFor.mockResolvedValue(null);
    await expect(probeMcpServer(oauthServer()[0], { companyId: 7 })).rejects.toBeInstanceOf(McpOAuthRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects servers that announce OAuth", async () => {
    fetchMock.mockResolvedValue(
      response("", { "www-authenticate": 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' }, 401)
    );
    await expect(probeMcpServer(sanitizeMcpServers([server])[0], { companyId: 7 })).rejects.toBeInstanceOf(McpOAuthRequired);
  });
});
