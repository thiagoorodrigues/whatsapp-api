import crypto from "crypto";
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { decryptSecret, encryptSecret } from "../../helpers/secretBox";
import AiMcpConnection from "../../models/AiMcpConnection";
import AiOAuthClient from "../../models/AiOAuthClient";
import { publicFetch } from "./httpTools";

// OAuth 2.1 for remote MCP servers, following the MCP authorization spec:
// protected resource metadata (RFC 9728) -> authorization server metadata
// (RFC 8414 / OIDC discovery) -> client (platform config, cached dynamic
// registration or RFC 7591 registration) -> authorization code + PKCE with
// the resource indicator (RFC 8707) -> tokens stored encrypted per MCP
// server of an agent, refreshed when they expire.

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;

export interface AuthServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  authMethods?: string[];
}

export interface Discovery {
  resource: string;
  scope?: string;
  server: AuthServer;
}

export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
  authMethod?: string;
}

export const redirectUri = () =>
  process.env.MCP_OAUTH_REDIRECT_URL ||
  `${String(process.env.BACKEND_URL || "").replace(/\/+$/, "")}/ai-tools/mcp/oauth/callback`;

const base64url = (buffer: Buffer) =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const createPkce = () => {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

// Bearer resource_metadata="...", scope="..." -> { resource_metadata, scope }
export const parseChallenge = (header?: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  let match = re.exec(String(header || ""));
  while (match) {
    out[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3];
    match = re.exec(String(header || ""));
  }
  return out;
};

const fetchJson = async (url: string): Promise<any | null> => {
  try {
    const response = await publicFetch(url, { headers: { Accept: "application/json" } });
    if (response.status !== 200) return null;
    return JSON.parse(String(await response.text()).slice(0, 200_000));
  } catch (e) {
    return null;
  }
};

const firstJson = async (urls: string[]) => {
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(url);
    if (data) return data;
  }
  return null;
};

// Well-known URLs with the path inserted after the well-known segment.
const wellKnown = (target: string, name: string) => {
  const url = new URL(target);
  const path = url.pathname.replace(/\/+$/, "");
  const urls = [];
  if (path) urls.push(`${url.origin}/.well-known/${name}${path}`);
  urls.push(`${url.origin}/.well-known/${name}`);
  return urls;
};

export const canonicalResource = (serverUrl: string) => {
  const url = new URL(serverUrl);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const authServerMetadata = async (issuer: string): Promise<AuthServer | null> => {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  const candidates = [
    ...wellKnown(issuer, "oauth-authorization-server"),
    ...(path ? [`${url.origin}/.well-known/openid-configuration${path}`] : []),
    `${url.origin}${path}/.well-known/openid-configuration`
  ];
  const meta = await firstJson(Array.from(new Set(candidates)));
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) return null;
  const methods: string[] | undefined = meta.code_challenge_methods_supported;
  if (methods && !methods.includes("S256")) throw new Error("o servidor de login não suporta PKCE (S256)");
  return {
    issuer: meta.issuer || issuer,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
    authMethods: meta.token_endpoint_auth_methods_supported
  };
};

/**
 * Finds how to log in to an MCP server. Returns null when the server does
 * not ask for OAuth.
 */
export const discover = async (serverUrl: string): Promise<Discovery | null> => {
  const probe = await publicFetch(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weconex-ai-agent", version: "1.0.0" } }
    })
  });
  if (probe.status !== 401 && probe.status !== 403) return null;

  const challenge = parseChallenge(probe.headers.get("www-authenticate"));
  const prm = await firstJson([
    ...(challenge.resource_metadata ? [challenge.resource_metadata] : []),
    ...wellKnown(serverUrl, "oauth-protected-resource")
  ]);

  // Older servers (2025-03-26 spec) are their own authorization server.
  const issuer = prm?.authorization_servers?.[0] || new URL(serverUrl).origin;
  const origin = new URL(issuer).origin;
  const server = (await authServerMetadata(issuer)) || {
    issuer,
    authorizationEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/token`,
    registrationEndpoint: `${origin}/register`
  };

  const scopes: string[] | undefined = prm?.scopes_supported;
  return {
    resource: prm?.resource || canonicalResource(serverUrl),
    scope: challenge.scope || (scopes && scopes.length ? scopes.join(" ") : undefined),
    server
  };
};

// Platform clients registered by hand, by issuer:
// MCP_OAUTH_CLIENTS={"https://auth.exemplo.com":{"clientId":"...","clientSecret":"..."}}
const platformClient = (issuer: string): ClientCredentials | null => {
  try {
    const all = JSON.parse(process.env.MCP_OAUTH_CLIENTS || "{}");
    const entry = all[issuer] || all[issuer.replace(/\/+$/, "")];
    return entry?.clientId ? { clientId: entry.clientId, clientSecret: entry.clientSecret, authMethod: entry.authMethod } : null;
  } catch (e) {
    return null;
  }
};

const pickAuthMethod = (server: AuthServer, hasSecret: boolean) => {
  if (!hasSecret) return "none";
  const methods = server.authMethods || [];
  return methods.length && !methods.includes("client_secret_basic") && methods.includes("client_secret_post")
    ? "client_secret_post"
    : "client_secret_basic";
};

/**
 * Client used at an authorization server: the one typed for this server,
 * the platform's, one registered before, or a new dynamic registration.
 */
export const resolveClient = async (server: AuthServer, manual?: ClientCredentials | null): Promise<ClientCredentials> => {
  if (manual?.clientId) {
    return { ...manual, authMethod: manual.authMethod || pickAuthMethod(server, !!manual.clientSecret) };
  }
  const platform = platformClient(server.issuer);
  if (platform) return { ...platform, authMethod: platform.authMethod || pickAuthMethod(server, !!platform.clientSecret) };

  const redirect = redirectUri();
  const cached = await AiOAuthClient.findOne({ where: { issuer: server.issuer, redirectUri: redirect } });
  if (cached) {
    return {
      clientId: cached.clientId,
      clientSecret: cached.clientSecretEncrypted ? decryptSecret(cached.clientSecretEncrypted) : undefined,
      authMethod: cached.authMethod || "none"
    };
  }

  if (!server.registrationEndpoint) throw new AppError("ERR_AI_MCP_OAUTH_CLIENT_REQUIRED");
  const response = await publicFetch(server.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Weconex - Agentes de IA",
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  const text = String(await response.text()).slice(0, 20_000);
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 404 || response.status === 405) throw new AppError("ERR_AI_MCP_OAUTH_CLIENT_REQUIRED");
    throw new AppError(`ERR_AI_MCP_OAUTH_FAILED: cadastro do aplicativo recusado (HTTP ${response.status})`);
  }
  const data = JSON.parse(text);
  if (!data.client_id) throw new AppError("ERR_AI_MCP_OAUTH_FAILED: cadastro do aplicativo sem client_id");
  const client = {
    clientId: String(data.client_id),
    clientSecret: data.client_secret ? String(data.client_secret) : undefined,
    authMethod: data.token_endpoint_auth_method || (data.client_secret ? "client_secret_basic" : "none")
  };
  await AiOAuthClient.create({
    issuer: server.issuer,
    redirectUri: redirect,
    clientId: client.clientId,
    clientSecretEncrypted: client.clientSecret ? encryptSecret(client.clientSecret) : null,
    authMethod: client.authMethod
  } as any);
  return client;
};

export const buildAuthorizationUrl = (params: {
  server: AuthServer;
  clientId: string;
  state: string;
  challenge: string;
  resource: string;
  scope?: string;
}) => {
  const url = new URL(params.server.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", params.resource);
  if (params.scope) url.searchParams.set("scope", params.scope);
  return url.toString();
};

/** Starts the login for one MCP server; returns the URL to open. */
export const startAuthorization = async (params: {
  companyId: number;
  agentId?: number | null;
  serverId: string;
  serverUrl: string;
  client?: ClientCredentials | null;
}) => {
  const discovery = await discover(params.serverUrl);
  if (!discovery) throw new AppError("ERR_AI_MCP_OAUTH_NOT_REQUIRED");
  const client = await resolveClient(discovery.server, params.client);
  const pkce = createPkce();
  const state = base64url(crypto.randomBytes(24));

  const values = {
    companyId: params.companyId,
    agentId: params.agentId || null,
    serverId: params.serverId,
    serverUrl: params.serverUrl,
    issuer: discovery.server.issuer,
    tokenEndpoint: discovery.server.tokenEndpoint,
    resource: discovery.resource,
    scope: discovery.scope || null,
    clientId: client.clientId,
    clientSecretEncrypted: client.clientSecret ? encryptSecret(client.clientSecret) : null,
    authMethod: client.authMethod || "none",
    state,
    codeVerifierEncrypted: encryptSecret(pkce.verifier),
    stateExpiresAt: new Date(Date.now() + STATE_TTL_MS),
    lastError: null
  };
  const existing = await AiMcpConnection.findOne({ where: { companyId: params.companyId, serverId: params.serverId } });
  if (existing) {
    // A new login replaces the account; the old tokens stay until it completes.
    await existing.update(values);
  } else {
    await AiMcpConnection.create({ ...values, status: "pending" } as any);
  }

  return buildAuthorizationUrl({
    server: discovery.server,
    clientId: client.clientId,
    state,
    challenge: pkce.challenge,
    resource: discovery.resource,
    scope: discovery.scope
  });
};

const tokenRequest = async (connection: AiMcpConnection, params: Record<string, string>) => {
  const body = new URLSearchParams({ ...params, resource: connection.resource || "" });
  if (!connection.resource) body.delete("resource");
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  };
  const secret = connection.clientSecretEncrypted ? decryptSecret(connection.clientSecretEncrypted) : "";
  if (secret && connection.authMethod !== "client_secret_post") {
    const encode = (v: string) => encodeURIComponent(v);
    headers.Authorization = `Basic ${Buffer.from(`${encode(connection.clientId)}:${encode(secret)}`).toString("base64")}`;
  } else {
    body.set("client_id", connection.clientId);
    if (secret) body.set("client_secret", secret);
  }

  const response = await publicFetch(connection.tokenEndpoint, { method: "POST", headers, body: body.toString() });
  const text = String(await response.text()).slice(0, 50_000);
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch (e) {
    // some servers answer form-encoded
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (response.status !== 200 || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(String(reason).slice(0, 300));
  }
  return data;
};

const saveTokens = (connection: AiMcpConnection, data: any) =>
  connection.update({
    status: "connected",
    accessTokenEncrypted: encryptSecret(String(data.access_token)),
    // Servers that don't rotate refresh tokens keep the current one.
    refreshTokenEncrypted: data.refresh_token ? encryptSecret(String(data.refresh_token)) : connection.refreshTokenEncrypted,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
    scope: data.scope || connection.scope,
    lastError: null
  });

/** Callback of the login window. Never throws: returns what to show. */
export const completeAuthorization = async (query: { state?: string; code?: string; error?: string; error_description?: string }) => {
  const state = String(query.state || "");
  const connection = state ? await AiMcpConnection.findOne({ where: { state } }) : null;
  if (!connection || !connection.stateExpiresAt || connection.stateExpiresAt.getTime() < Date.now()) {
    return { ok: false, message: "Este link de login expirou. Volte ao sistema e clique em Conectar conta de novo." };
  }
  const verifier = decryptSecret(connection.codeVerifierEncrypted);
  await connection.update({ state: null, codeVerifierEncrypted: null, stateExpiresAt: null });

  if (query.error || !query.code) {
    const message = String(query.error_description || query.error || "login cancelado").slice(0, 300);
    await connection.update({ lastError: message, ...(connection.accessTokenEncrypted ? {} : { status: "error" }) });
    return { ok: false, message: `A conta não foi conectada: ${message}` };
  }

  try {
    const data = await tokenRequest(connection, {
      grant_type: "authorization_code",
      code: String(query.code),
      redirect_uri: redirectUri(),
      code_verifier: verifier
    });
    await saveTokens(connection, data);
    await connection.update({ connectedAt: new Date() });
    return { ok: true, message: "Conta conectada. Você já pode fechar esta janela." };
  } catch (err) {
    const message = String((err as Error)?.message || err);
    await connection.update({ lastError: message, ...(connection.accessTokenEncrypted ? {} : { status: "error" }) });
    return { ok: false, message: `A conta não foi conectada: ${message}` };
  }
};

// One refresh at a time per connection.
const refreshing = new Map<number, Promise<string | null>>();

const refresh = (connection: AiMcpConnection): Promise<string | null> => {
  const running = refreshing.get(connection.id);
  if (running) return running;
  const job = (async () => {
    if (!connection.refreshTokenEncrypted) {
      await connection.update({ status: "error", lastError: "O acesso expirou. Conecte a conta de novo." });
      return null;
    }
    try {
      const data = await tokenRequest(connection, {
        grant_type: "refresh_token",
        refresh_token: decryptSecret(connection.refreshTokenEncrypted)
      });
      await saveTokens(connection, data);
      return String(data.access_token);
    } catch (err) {
      await connection.update({
        status: "error",
        lastError: `Não foi possível renovar o acesso (${String((err as Error)?.message || err)}). Conecte a conta de novo.`
      });
      return null;
    }
  })().finally(() => refreshing.delete(connection.id));
  refreshing.set(connection.id, job);
  return job;
};

/** Valid access token for an MCP server, refreshed when needed. */
export const accessTokenFor = async (companyId: number, serverId: string, options: { forceRefresh?: boolean } = {}) => {
  const connection = await AiMcpConnection.findOne({ where: { companyId, serverId } });
  if (!connection || !connection.accessTokenEncrypted || connection.status === "error") return null;
  const expiring = connection.expiresAt && connection.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (options.forceRefresh || expiring) return refresh(connection);
  return decryptSecret(connection.accessTokenEncrypted);
};

export interface ConnectionStatus {
  status: "none" | "pending" | "connected" | "error";
  connectedAt?: Date | null;
  lastError?: string | null;
}

export const connectionStatuses = async (companyId: number, serverIds: string[]) => {
  const out: Record<string, ConnectionStatus> = {};
  if (!serverIds.length) return out;
  const rows = await AiMcpConnection.findAll({
    where: { companyId, serverId: serverIds },
    attributes: ["serverId", "status", "connectedAt", "lastError", "accessTokenEncrypted"]
  });
  rows.forEach(row => {
    out[row.serverId] = {
      // A pending re-login keeps the account that is still connected.
      status: row.accessTokenEncrypted && row.status !== "error" ? "connected" : row.status,
      connectedAt: row.connectedAt,
      lastError: row.lastError
    };
  });
  return out;
};

export const disconnect = (companyId: number, serverId: string) =>
  AiMcpConnection.destroy({ where: { companyId, serverId } });

/**
 * After an agent is saved: its OAuth servers own their connections, and
 * connections of servers removed from it are deleted.
 */
export const syncAgentConnections = async (companyId: number, agentId: number, oauthServerIds: string[]) => {
  if (oauthServerIds.length) {
    await AiMcpConnection.update({ agentId } as any, { where: { companyId, serverId: oauthServerIds } });
  }
  await AiMcpConnection.destroy({
    where: {
      companyId,
      agentId,
      ...(oauthServerIds.length ? { serverId: { [Op.notIn]: oauthServerIds } } : {})
    }
  });
};
