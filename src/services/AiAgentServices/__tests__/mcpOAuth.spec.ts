import crypto from "crypto";
import dns from "dns";

// In-memory stand-ins for the two tables.
const rows: any[] = [];
const clients: any[] = [];
const matches = (row: any, where: any) =>
  Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
const wrap = (row: any) =>
  Object.assign(row, {
    update: async (values: any) => Object.assign(row, values)
  });

jest.mock("../../../models/AiMcpConnection", () => ({
  __esModule: true,
  default: {
    findOne: async ({ where }: any) => rows.find(r => matches(r, where)) || null,
    findAll: async ({ where }: any) => rows.filter(r => matches(r, where)),
    create: async (values: any) => {
      const row = wrap({ id: rows.length + 1, ...values });
      rows.push(row);
      return row;
    },
    destroy: async ({ where }: any) => {
      const keep = rows.filter(r => !matches(r, where));
      rows.splice(0, rows.length, ...keep);
    }
  }
}));
jest.mock("../../../models/AiOAuthClient", () => ({
  __esModule: true,
  default: {
    findOne: async ({ where }: any) => clients.find(c => matches(c, where)) || null,
    create: async (values: any) => clients.push(values)
  }
}));

// eslint-disable-next-line import/first
import {
  accessTokenFor,
  completeAuthorization,
  connectionStatuses,
  createPkce,
  discover,
  parseChallenge,
  redirectUri,
  startAuthorization
} from "../mcpOAuth";

const fetchMock = jest.fn();
const MCP = "https://mcp.agenda.com/mcp";
const AS = "https://auth.agenda.com";

const res = (status: number, body: any = "", headers: Record<string, string> = {}) => ({
  status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body))
});

let tokenCalls: URLSearchParams[] = [];
let registrations = 0;

const fakeServers = () =>
  fetchMock.mockImplementation(async (url: string, init: any = {}) => {
    if (url === MCP) {
      return res(401, "", {
        "www-authenticate": `Bearer resource_metadata="https://mcp.agenda.com/.well-known/oauth-protected-resource/mcp", scope="agenda.read"`
      });
    }
    if (url === "https://mcp.agenda.com/.well-known/oauth-protected-resource/mcp") {
      return res(200, { resource: MCP, authorization_servers: [AS] });
    }
    if (url === `${AS}/.well-known/oauth-authorization-server`) {
      return res(200, {
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        registration_endpoint: `${AS}/register`,
        code_challenge_methods_supported: ["S256"]
      });
    }
    if (url === `${AS}/register`) {
      registrations += 1;
      return res(201, { client_id: "cli_123", token_endpoint_auth_method: "none" });
    }
    if (url === `${AS}/token`) {
      const body = new URLSearchParams(init.body);
      tokenCalls.push(body);
      if (body.get("grant_type") === "refresh_token") {
        return res(200, { access_token: "novo_token", expires_in: 3600 });
      }
      return res(200, { access_token: "token_1", refresh_token: "refresh_1", expires_in: 3600 });
    }
    return res(404);
  });

beforeAll(() => {
  process.env.SECRETS_KEY = "test-secrets-key";
  process.env.BACKEND_URL = "https://api.weconex.com";
  (globalThis as any).fetch = fetchMock;
});

beforeEach(() => {
  rows.splice(0);
  clients.splice(0);
  tokenCalls = [];
  registrations = 0;
  fetchMock.mockReset();
  fakeServers();
  jest.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
});

afterEach(() => jest.restoreAllMocks());

const login = async (companyId: number, serverId: string) => {
  const url = new URL(await startAuthorization({ companyId, serverId, serverUrl: MCP }));
  return completeAuthorization({ state: url.searchParams.get("state"), code: `code_${serverId}` });
};

describe("helpers", () => {
  it("parses WWW-Authenticate", () => {
    expect(parseChallenge('Bearer realm="x", resource_metadata="https://a/b", scope=read')).toEqual({
      realm: "x",
      resource_metadata: "https://a/b",
      scope: "read"
    });
  });

  it("creates an S256 PKCE pair", () => {
    const { verifier, challenge } = createPkce();
    const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("uses the backend URL for the callback", () => {
    expect(redirectUri()).toBe("https://api.weconex.com/ai-tools/mcp/oauth/callback");
  });
});

describe("discover", () => {
  it("follows protected resource and authorization server metadata", async () => {
    const found = await discover(MCP);
    expect(found).toEqual({
      resource: MCP,
      scope: "agenda.read",
      server: expect.objectContaining({ issuer: AS, tokenEndpoint: `${AS}/token` })
    });
  });

  it("returns null when the server needs no login", async () => {
    fetchMock.mockResolvedValue(res(200, "{}"));
    expect(await discover(MCP)).toBeNull();
  });
});

describe("authorization", () => {
  it("builds the login URL with PKCE and the resource", async () => {
    const url = new URL(await startAuthorization({ companyId: 1, serverId: "srv_aaaaaaaa", serverUrl: MCP }));
    expect(url.origin + url.pathname).toBe(`${AS}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("cli_123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(MCP);
    expect(url.searchParams.get("scope")).toBe("agenda.read");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri());
  });

  it("exchanges the code and stores tokens encrypted", async () => {
    const result = await login(1, "srv_aaaaaaaa");
    expect(result.ok).toBe(true);
    const exchange = tokenCalls[0];
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code_verifier")).toBeTruthy();
    expect(exchange.get("client_id")).toBe("cli_123");
    expect(JSON.stringify(rows[0])).not.toContain("token_1");
    expect(rows[0].state).toBeNull();
    expect(await accessTokenFor(1, "srv_aaaaaaaa")).toBe("token_1");
  });

  it("registers the app once per authorization server", async () => {
    await login(1, "srv_aaaaaaaa");
    await login(2, "srv_bbbbbbbb");
    await login(1, "srv_cccccccc");
    expect(registrations).toBe(1);
  });

  it("keeps each company's and each server's account apart", async () => {
    await login(1, "srv_aaaaaaaa");
    await login(1, "srv_bbbbbbbb");
    expect(rows).toHaveLength(2);
    expect(await accessTokenFor(2, "srv_aaaaaaaa")).toBeNull();
    const statuses = await connectionStatuses(1, ["srv_aaaaaaaa", "srv_bbbbbbbb", "srv_nada"]);
    expect(statuses.srv_aaaaaaaa.status).toBe("connected");
    expect(statuses.srv_bbbbbbbb.status).toBe("connected");
    expect(statuses.srv_nada).toBeUndefined();
  });

  it("rejects unknown or reused states", async () => {
    expect((await completeAuthorization({ state: "inventado", code: "x" })).ok).toBe(false);
    const url = new URL(await startAuthorization({ companyId: 1, serverId: "srv_aaaaaaaa", serverUrl: MCP }));
    const state = url.searchParams.get("state");
    expect((await completeAuthorization({ state, code: "x" })).ok).toBe(true);
    expect((await completeAuthorization({ state, code: "x" })).ok).toBe(false);
  });

  it("reports a cancelled login", async () => {
    const url = new URL(await startAuthorization({ companyId: 1, serverId: "srv_aaaaaaaa", serverUrl: MCP }));
    const result = await completeAuthorization({ state: url.searchParams.get("state"), error: "access_denied" });
    expect(result.ok).toBe(false);
    expect(rows[0].status).toBe("error");
  });
});

describe("accessTokenFor", () => {
  it("refreshes an expiring token", async () => {
    await login(1, "srv_aaaaaaaa");
    rows[0].expiresAt = new Date(Date.now() + 10_000);
    expect(await accessTokenFor(1, "srv_aaaaaaaa")).toBe("novo_token");
    expect(tokenCalls[1].get("grant_type")).toBe("refresh_token");
    expect(tokenCalls[1].get("resource")).toBe(MCP);
  });

  it("marks the connection when the refresh fails", async () => {
    await login(1, "srv_aaaaaaaa");
    fetchMock.mockResolvedValue(res(400, { error: "invalid_grant" }));
    expect(await accessTokenFor(1, "srv_aaaaaaaa", { forceRefresh: true })).toBeNull();
    expect(rows[0].status).toBe("error");
    expect(rows[0].lastError).toContain("invalid_grant");
  });
});
