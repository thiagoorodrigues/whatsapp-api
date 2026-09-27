import dns from "dns";
import net from "net";
import AppError from "../../errors/AppError";
import { decryptSecret, encryptSecret } from "../../helpers/secretBox";
import { ToolDefinition } from "./types";

// Custom HTTP tools of an agent: the company describes an endpoint and the
// model decides when to call it, filling the declared parameters.

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = typeof HTTP_METHODS[number];
export type ParamType = "string" | "number" | "boolean";

export interface HttpToolParam {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
}

export interface HttpToolHeader {
  key: string;
  // Stored encrypted; clients get `hasValue` only.
  valueEncrypted?: string;
}

export interface HttpTool {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  headers: HttpToolHeader[];
  params: HttpToolParam[];
}

export interface HttpContext {
  contactName?: string;
  contactNumber?: string;
  ticketId?: number | null;
}

export const MAX_HTTP_TOOLS = 10;
export const HTTP_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_CHARS = 4000;

const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/;
// RFC 9110 token characters.
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const BLOCKED_HEADERS = ["host", "content-length", "connection", "transfer-encoding"];

export const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

// Name the model sees: "http_" + slug of the tool name (unique per agent).
export const toolNameOf = (tool: Pick<HttpTool, "name">) => `http_${slug(tool.name) || "ferramenta"}`;

const bad = (message: string) => new AppError(`ERR_AI_HTTP_TOOL_INVALID: ${message}`);

/**
 * Validates the HTTP tools sent by the editor. Header values arrive in clear
 * text and are encrypted here; an empty value keeps the one already stored
 * for the same header of the same tool.
 */
export const sanitizeHttpTools = (input: unknown, previous: HttpTool[] = []): HttpTool[] => {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw bad("lista inválida");
  if (input.length > MAX_HTTP_TOOLS) throw bad(`no máximo ${MAX_HTTP_TOOLS} ferramentas`);

  const names = new Set<string>();
  return input.map((raw: any, index): HttpTool => {
    const name = String(raw?.name || "").trim().slice(0, 60);
    if (!name) throw bad(`ferramenta ${index + 1} sem nome`);
    const toolName = toolNameOf({ name });
    if (names.has(toolName)) throw bad(`nome repetido: ${name}`);
    names.add(toolName);

    const description = String(raw?.description || "").trim().slice(0, 1000);
    if (!description) throw bad(`"${name}" precisa dizer quando usar`);

    const method = String(raw?.method || "GET").toUpperCase() as HttpMethod;
    if (!HTTP_METHODS.includes(method)) throw bad(`método inválido em "${name}"`);

    const url = String(raw?.url || "").trim().slice(0, 2000);
    let parsed: URL;
    try {
      parsed = new URL(url.replace(/{{[^}]*}}|{[^}]*}/g, "x"));
    } catch (e) {
      throw bad(`URL inválida em "${name}"`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw bad(`"${name}" precisa usar http ou https`);

    const id = typeof raw?.id === "string" && raw.id ? raw.id.slice(0, 40) : `http_${Date.now()}_${index}`;
    const before = previous.find(p => p.id === id);

    const params: HttpToolParam[] = (Array.isArray(raw?.params) ? raw.params : []).slice(0, 20).map((p: any) => {
      const paramName = String(p?.name || "").trim();
      if (!PARAM_NAME.test(paramName)) throw bad(`parâmetro inválido "${paramName}" em "${name}"`);
      const type: ParamType = ["string", "number", "boolean"].includes(p?.type) ? p.type : "string";
      return {
        name: paramName,
        type,
        description: String(p?.description || "").trim().slice(0, 300),
        required: !!p?.required
      };
    });

    const headers: HttpToolHeader[] = (Array.isArray(raw?.headers) ? raw.headers : [])
      .slice(0, 20)
      .filter((h: any) => String(h?.key || "").trim())
      .map((h: any) => {
        const key = String(h.key).trim();
        if (!HEADER_NAME.test(key) || BLOCKED_HEADERS.includes(key.toLowerCase())) {
          throw bad(`cabeçalho inválido "${key}" em "${name}"`);
        }
        const value = typeof h.value === "string" ? h.value : "";
        if (value) return { key, valueEncrypted: encryptSecret(value.slice(0, 4000)) };
        const kept = before?.headers.find(x => x.key.toLowerCase() === key.toLowerCase());
        return kept?.valueEncrypted ? { key, valueEncrypted: kept.valueEncrypted } : { key };
      });

    return { id, name, description, method, url, headers, params };
  });
};

// What the editor sees: header values never leave the server.
export const serializeHttpTools = (tools: HttpTool[] = []) =>
  tools.map(t => ({
    ...t,
    headers: (t.headers || []).map(h => ({ key: h.key, hasValue: !!h.valueEncrypted }))
  }));

export const httpToolDefinitions = (tools: HttpTool[] = []): ToolDefinition[] =>
  tools.map(t => ({
    name: toolNameOf(t),
    description: `${t.description}\n(Chamada ${t.method} para um sistema da empresa.)`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        (t.params || []).map(p => [p.name, { type: p.type, description: p.description || p.name }])
      ),
      required: (t.params || []).filter(p => p.required).map(p => p.name),
      additionalProperties: false
    }
  }));

// {{contato.numero}}, {{contato.nome}}, {{ticket.id}} from the conversation.
export const fillContext = (text: string, ctx: HttpContext) =>
  text.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    const value = {
      "contato.nome": ctx.contactName,
      "contato.numero": ctx.contactNumber,
      "ticket.id": ctx.ticketId
    }[key];
    return value === undefined || value === null ? "" : String(value);
  });

const PRIVATE_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const;

const v4ToInt = (ip: string) => ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

export const isPrivateAddress = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const value = v4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (v4ToInt(base) & mask);
    });
  }
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower);
};

// Blocks calls to the server's own network (SSRF).
export const assertPublicHost = async (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("endereço interno não permitido");
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) {
    throw new Error("endereço interno não permitido");
  }
};

/**
 * fetch for addresses chosen by companies: public hosts only, no redirects,
 * with a timeout.
 */
export const publicFetch = async (url: string, init: Record<string, any> = {}, timeoutMs = HTTP_TIMEOUT_MS) => {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("URL precisa usar http ou https");
  await assertPublicHost(target.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await (globalThis as any).fetch(target.toString(), { ...init, redirect: "manual", signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error("tempo esgotado");
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export interface HttpCallResult {
  ok: boolean;
  status?: number;
  body: string;
}

/** Calls the endpoint with the model's arguments; never throws. */
export const callHttpTool = async (
  tool: HttpTool,
  input: Record<string, unknown>,
  ctx: HttpContext
): Promise<HttpCallResult> => {
  try {
    const args: Record<string, unknown> = {};
    for (const p of tool.params || []) {
      const value = input[p.name];
      if (value === undefined || value === null || value === "") {
        if (p.required) return { ok: false, body: `Parâmetro obrigatório ausente: ${p.name}` };
        continue;
      }
      args[p.name] = p.type === "number" ? Number(value) : p.type === "boolean" ? !!value : String(value);
    }

    // {param} in the URL takes that argument (encoded); the rest goes to the
    // query string (GET/DELETE) or the JSON body.
    const used = new Set<string>();
    let url = fillContext(tool.url, ctx).replace(/{(\w+)}/g, (match, key) => {
      if (!(key in args)) return "";
      used.add(key);
      return encodeURIComponent(String(args[key]));
    });
    const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !used.has(k)));
    const target = new URL(url);
    const sendsBody = !["GET", "DELETE"].includes(tool.method);
    if (!sendsBody) Object.entries(rest).forEach(([k, v]) => target.searchParams.set(k, String(v)));
    url = target.toString();

    await assertPublicHost(target.hostname);

    const headers: Record<string, string> = { Accept: "application/json, text/plain;q=0.9, */*;q=0.5" };
    for (const h of tool.headers || []) {
      if (h.valueEncrypted) headers[h.key] = fillContext(decryptSecret(h.valueEncrypted), ctx);
    }
    if (sendsBody) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await (globalThis as any).fetch(url, {
        method: tool.method,
        headers,
        body: sendsBody ? JSON.stringify(rest) : undefined,
        redirect: "manual",
        signal: controller.signal
      });
      const text = String(await response.text());
      const body = text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}… (resposta cortada)` : text;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = (err as Error)?.name === "AbortError" ? "tempo esgotado" : String((err as Error)?.message || err);
    return { ok: false, body: `Falha ao chamar o sistema: ${message}` };
  }
};

export const describeResult = (result: HttpCallResult) =>
  result.status ? `HTTP ${result.status}\n${result.body}` : result.body;
