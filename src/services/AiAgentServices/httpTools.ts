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

// One field of the JSON body, addressed by path: "a", "a.b", "a[].b" (a field
// of each item of list a) or "a[]" (list of plain values). The model fills it,
// or it takes a fixed value (which may use the {{contato.*}} variables; "json"
// fixed values are kept as written). Derived from the tool's body template.
export interface HttpBodyField {
  path: string;
  type: ParamType | "json";
  fixed: boolean;
  value: string;
  description: string;
  required: boolean;
}

export interface HttpTool {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  headers: HttpToolHeader[];
  params: HttpToolParam[];
  // Seconds to wait for the response.
  timeout?: number;
  // JSON as the company wrote it: {{name}} is filled by the model. The URL
  // takes {{name}} too; `params` only remain in tools saved before that.
  queryTemplate?: string;
  query?: HttpBodyField[];
  bodyTemplate?: string;
  body?: HttpBodyField[];
  // Fields of the JSON response the model sees; empty sends it all.
  responseTemplate?: string;
}

export interface HttpContext {
  contactName?: string;
  contactNumber?: string;
  ticketId?: number | null;
}

export const MAX_HTTP_TOOLS = 10;
export const HTTP_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_S = 60;
export const MAX_RESPONSE_CHARS = 20_000;

export const MAX_BODY_FIELDS = 100;
export const MAX_TEMPLATE_CHARS = 20_000;
export const MAX_BODY_DEPTH = 5;

const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/;
const BODY_SEGMENT = /^([A-Za-z0-9_-]{1,60})(\[\])?$/;
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

type BodyNode =
  | { kind: "leaf"; field: HttpBodyField }
  | { kind: "object"; children: Map<string, BodyNode> }
  | { kind: "array"; item: BodyNode };

const newObject = (): BodyNode => ({ kind: "object", children: new Map() });

// Tree of the body fields; throws a message on a malformed path or conflict.
const bodyTree = (fields: HttpBodyField[]) => {
  const root = newObject() as Extract<BodyNode, { kind: "object" }>;
  fields.forEach(field => {
    const segments = field.path.split(".");
    if (segments.length > MAX_BODY_DEPTH) throw new Error(`"${field.path}" passa de ${MAX_BODY_DEPTH} níveis`);
    let parent = root;
    segments.forEach((segment, i) => {
      const match = BODY_SEGMENT.exec(segment);
      if (!match) throw new Error(`campo inválido "${field.path}"`);
      const [, key, isList] = match;
      const last = i === segments.length - 1;
      const inner: BodyNode = last ? { kind: "leaf", field } : newObject();
      const wanted: BodyNode = isList ? { kind: "array", item: inner } : inner;
      const existing = parent.children.get(key);
      const leafOf = (n: BodyNode) => (n.kind === "array" ? n.item.kind : n.kind) === "leaf";
      if (!existing) parent.children.set(key, wanted);
      else if (last && existing.kind === wanted.kind && leafOf(existing)) throw new Error(`campo repetido "${field.path}"`);
      else if (existing.kind !== wanted.kind || last || leafOf(existing)) {
        throw new Error(`campo em conflito "${field.path}"`);
      }
      const node = parent.children.get(key)!;
      const next = node.kind === "array" ? node.item : node;
      if (!last) parent = next as Extract<BodyNode, { kind: "object" }>;
    });
  });
  return root;
};

const CONTEXT_KEYS = ["contato.nome", "contato.numero", "ticket.id"];
const PLACEHOLDER = /{{\s*([^{}]+?)\s*}}/g;
const FILLED_BY_MODEL = /^{{\s*([^{}:?]+?)\s*(?::\s*(numero|número|simnao|texto)\s*)?(\?)?\s*}}$/i;

const modelPlaceholder = (value: string) => {
  const match = FILLED_BY_MODEL.exec(value.trim());
  if (!match || CONTEXT_KEYS.includes(match[1].trim())) return null;
  const kind = (match[2] || "").toLowerCase();
  const type: ParamType = kind.startsWith("n") ? "number" : kind === "simnao" ? "boolean" : "string";
  return { type, description: match[1].replace(/_/g, " ").trim(), required: !match[3] };
};

const hasModelPlaceholder = (value: unknown): boolean => {
  if (typeof value === "string") {
    return Array.from(value.matchAll(PLACEHOLDER)).some(m => !CONTEXT_KEYS.includes(m[1].trim()));
  }
  if (Array.isArray(value)) return value.some(hasModelPlaceholder);
  if (value && typeof value === "object") return Object.values(value).some(hasModelPlaceholder);
  return false;
};

const fixedField = (path: string, value: unknown): HttpBodyField => {
  const base = { path, fixed: true, description: "", required: false };
  if (typeof value === "string") return { ...base, type: "string", value };
  if (typeof value === "number") return { ...base, type: "number", value: String(value) };
  if (typeof value === "boolean") return { ...base, type: "boolean", value: String(value) };
  return { ...base, type: "json", value: JSON.stringify(value) };
};

// Body fields from the template: {{name}} values become fields the model
// fills; a list holding {{...}} is the model of each item.
const fieldsFromTemplate = (template: Record<string, unknown>): HttpBodyField[] => {
  const fields: HttpBodyField[] = [];
  const walk = (value: unknown, path: string) => {
    if (!hasModelPlaceholder(value)) return fields.push(fixedField(path, value));
    if (typeof value === "string") {
      const placeholder = modelPlaceholder(value);
      if (!placeholder) throw new Error(`em "${path}", o {{campo}} do agente precisa ser o valor inteiro`);
      return fields.push({ path, value: "", fixed: false, ...placeholder });
    }
    if (Array.isArray(value)) {
      if (value.length !== 1) throw new Error(`a lista "${path}" precisa de um item só, o modelo de cada item`);
      return walk(value[0], `${path}[]`);
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => walk(child, path ? `${path}.${key}` : key));
  };
  walk(template, "");
  return fields;
};

// Parses a JSON template written by the company ("corpo" or "query").
const parseTemplate = (input: unknown, label: string, name: string) => {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return { text: "", template: null as Record<string, unknown> | null };
  if (text.length > MAX_TEMPLATE_CHARS) throw bad(`${label} grande demais em "${name}"`);
  let template: unknown;
  try {
    template = JSON.parse(text);
  } catch (e) {
    throw bad(`${label} com JSON inválido em "${name}"`);
  }
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw bad(`${label} de "${name}" precisa ser um objeto JSON, entre { }`);
  }
  return { text, template: template as Record<string, unknown> };
};

const sanitizeQuery = (input: unknown, name: string) => {
  const { text, template } = parseTemplate(input, "a query", name);
  if (!template) return { queryTemplate: "", query: [] as HttpBodyField[] };
  if (Object.values(template).some(v => v !== null && typeof v === "object")) {
    throw bad(`a query de "${name}" só aceita valores simples (texto, número, sim/não)`);
  }
  try {
    return { queryTemplate: text, query: fieldsFromTemplate(template) };
  } catch (err) {
    throw bad(`${(err as Error).message} em "${name}"`);
  }
};

// Fields the model fills in the URL: {{numero do pedido}} → numero_do_pedido.
export const urlFields = (url: string): HttpBodyField[] => {
  const fields: HttpBodyField[] = [];
  Array.from(url.matchAll(PLACEHOLDER)).forEach(match => {
    const placeholder = modelPlaceholder(match[0]);
    if (!placeholder) return;
    const path = slug(placeholder.description);
    if (!path) throw new Error(`{{${match[1]}}} da URL precisa de um nome com letras ou números`);
    if (!fields.some(f => f.path === path)) fields.push({ path, value: "", fixed: false, ...placeholder });
  });
  return fields;
};

const sanitizeResponse = (input: unknown, name: string) => {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return "";
  if (text.length > MAX_TEMPLATE_CHARS) throw bad(`filtro da resposta grande demais em "${name}"`);
  let filter: unknown;
  try {
    filter = JSON.parse(text);
  } catch (e) {
    throw bad(`filtro da resposta com JSON inválido em "${name}"`);
  }
  if (!filter || typeof filter !== "object") throw bad(`o filtro da resposta de "${name}" precisa ser um objeto ou lista JSON`);
  return text;
};

/**
 * Keeps only the fields the filter names. A list in the filter is the model
 * of every item (also of objects keyed by number, like {"1": {...}}); any
 * other value keeps the field whole.
 */
export const filterResponse = (data: unknown, filter: unknown): unknown => {
  if (!filter || typeof filter !== "object") return data;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(filter)) {
    const item = filter[0];
    if (Array.isArray(data)) return data.map(d => filterResponse(d, item));
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, filterResponse(v, item)]));
  }
  if (Array.isArray(data)) return data.map(d => filterResponse(d, filter));
  const source = data as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(filter as Record<string, unknown>)
      .filter(([key]) => key in source)
      .map(([key, sub]) => [key, filterResponse(source[key], sub)])
  );
};

// What the model reads: JSON compacted (and filtered), cut at the limit.
export const responseForModel = (text: string, responseTemplate?: string) => {
  let out = text;
  try {
    const data = JSON.parse(text);
    out = JSON.stringify(responseTemplate ? filterResponse(data, JSON.parse(responseTemplate)) : data);
  } catch (e) {
    // not JSON: as received
  }
  return out.length > MAX_RESPONSE_CHARS
    ? `${out.slice(0, MAX_RESPONSE_CHARS)}… (resposta cortada: mostrando ${MAX_RESPONSE_CHARS} de ${out.length} caracteres)`
    : out;
};

const sanitizeBody = (input: unknown, name: string, params: HttpToolParam[]) => {
  const { text: bodyTemplate, template } = parseTemplate(input, "o corpo", name);
  if (!template) return { bodyTemplate: "", body: [] as HttpBodyField[] };
  let body: HttpBodyField[];
  let root;
  try {
    body = fieldsFromTemplate(template);
    if (body.length > MAX_BODY_FIELDS) throw new Error(`no máximo ${MAX_BODY_FIELDS} campos no corpo`);
    root = bodyTree(body);
  } catch (err) {
    throw bad(`${(err as Error).message} em "${name}"`);
  }
  const clash = params.find(p => root.children.has(p.name));
  if (clash) throw bad(`"${clash.name}" já é um parâmetro em "${name}"`);
  return { bodyTemplate, body };
};

// JSON Schema of the fields the model fills; null when there are none.
const nodeSchema = (node: BodyNode, label: string): { schema: Record<string, unknown>; required: boolean } | null => {
  if (node.kind === "leaf") {
    if (node.field.fixed) return null;
    return {
      schema: { type: node.field.type, description: node.field.description || label },
      required: node.field.required
    };
  }
  if (node.kind === "array") {
    const item = nodeSchema(node.item, label);
    if (!item) return null;
    return { schema: { type: "array", items: item.schema }, required: item.required };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  node.children.forEach((child, key) => {
    const built = nodeSchema(child, key);
    if (!built) return;
    properties[key] = built.schema;
    if (built.required) required.push(key);
  });
  if (!Object.keys(properties).length) return null;
  return { schema: { type: "object", properties, required }, required: required.length > 0 };
};

const coerce = (type: HttpBodyField["type"], value: unknown): unknown => {
  if (type === "json") return JSON.parse(String(value));
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "boolean") return value === true || value === "true" || value === 1 || value === "1";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const asList = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // not JSON
    }
  }
  return undefined;
};

const empty = (value: unknown) => value === undefined || value === null || value === "";

// Value of a node from the model input; missing required fields go to `missing`.
const buildNode = (node: BodyNode, input: unknown, at: string, ctx: HttpContext, missing: string[]): unknown => {
  if (node.kind === "leaf") {
    const { field } = node;
    if (field.fixed) {
      if (field.type === "json") return coerce("json", field.value);
      const text = fillContext(field.value, ctx);
      return field.type !== "string" && text === "" ? undefined : coerce(field.type, text);
    }
    const value = empty(input) ? undefined : coerce(field.type, input);
    if (value === undefined && field.required) missing.push(at);
    return value;
  }
  if (node.kind === "array") {
    const list = asList(input);
    const needsModel = !!nodeSchema(node.item, at);
    if (!list) {
      if (!needsModel) return [buildNode(node.item, undefined, `${at}[0]`, ctx, missing)];
      if (nodeSchema(node, at)?.required) missing.push(at);
      return undefined;
    }
    return list
      .map((item, i) => buildNode(node.item, item, `${at}[${i}]`, ctx, missing))
      .filter(v => v !== undefined);
  }
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  node.children.forEach((child, key) => {
    const value = buildNode(child, source[key], at ? `${at}.${key}` : key, ctx, missing);
    if (value !== undefined) out[key] = value;
  });
  return Object.keys(out).length ? out : undefined;
};

/** Assembles the JSON body from the model input; lists the missing fields. */
export const buildBody = (fields: HttpBodyField[], input: Record<string, unknown>, ctx: HttpContext) => {
  const missing: string[] = [];
  const body = (buildNode(bodyTree(fields), input, "", ctx, missing) as Record<string, unknown>) || {};
  return { body, missing };
};

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
        if (hasModelPlaceholder(value)) {
          throw bad(`o cabeçalho "${key}" de "${name}" só aceita valores fixos e {{contato.*}}`);
        }
        if (value) return { key, valueEncrypted: encryptSecret(value.slice(0, 4000)) };
        const kept = before?.headers.find(x => x.key.toLowerCase() === key.toLowerCase());
        return kept?.valueEncrypted ? { key, valueEncrypted: kept.valueEncrypted } : { key };
      });

    const { bodyTemplate, body } = ["GET", "DELETE"].includes(method)
      ? { bodyTemplate: "", body: [] }
      : sanitizeBody(raw?.bodyTemplate, name, params);

    const seconds = Math.round(Number(raw?.timeout));
    const timeout = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_TIMEOUT_S) : HTTP_TIMEOUT_MS / 1000;

    const { queryTemplate, query } = sanitizeQuery(raw?.queryTemplate, name);
    const responseTemplate = sanitizeResponse(raw?.responseTemplate, name);
    let fromUrl: HttpBodyField[];
    try {
      fromUrl = params.length ? [] : urlFields(url);
    } catch (err) {
      throw bad(`${(err as Error).message} em "${name}"`);
    }
    // The model gets one object: names from params, URL, query and body.
    const topOf = (fields: HttpBodyField[]) =>
      Array.from(new Set(fields.filter(f => !f.fixed).map(f => f.path.split(/[.[]/)[0])));
    const topNames = [...params.map(p => p.name), ...fromUrl.map(f => f.path), ...topOf(query), ...topOf(body)];
    const repeated = topNames.find((n, i) => topNames.indexOf(n) !== i);
    if (repeated) throw bad(`campo "${repeated}" repetido entre URL, query e corpo em "${name}"`);

    return { id, name, description, method, url, timeout, headers, params, queryTemplate, query, bodyTemplate, body, responseTemplate };
  });
};

// What the editor sees: header values never leave the server.
export const serializeHttpTools = (tools: HttpTool[] = []) =>
  tools.map(t => ({
    ...t,
    headers: (t.headers || []).map(h => ({ key: h.key, hasValue: !!h.valueEncrypted }))
  }));

export const httpToolDefinitions = (tools: HttpTool[] = []): ToolDefinition[] =>
  tools.map(t => {
    const schemaOf = (fields?: HttpBodyField[]) =>
      fields?.length ? (nodeSchema(bodyTree(fields), "") as any)?.schema : null;
    const query = schemaOf(t.query);
    const body = schemaOf(t.body);
    return {
      name: toolNameOf(t),
      description: `${t.description}\n(Chamada ${t.method} para um sistema da empresa.)`,
      parameters: {
        type: "object",
        properties: {
          ...Object.fromEntries(
            (t.params || []).map(p => [p.name, { type: p.type, description: p.description || p.name }])
          ),
          ...Object.fromEntries(
            (t.params?.length ? [] : urlFields(t.url)).map(f => [f.path, { type: f.type, description: f.description }])
          ),
          ...(query?.properties || {}),
          ...(body?.properties || {})
        },
        required: [
          ...(t.params || []).filter(p => p.required).map(p => p.name),
          ...(t.params?.length ? [] : urlFields(t.url)).filter(f => f.required).map(f => f.path),
          ...(query?.required || []),
          ...(body?.required || [])
        ],
        additionalProperties: false
      }
    };
  });

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

    // {{field}} in the URL takes the model's value (encoded).
    const missing: string[] = [];
    let url = tool.params?.length
      ? tool.url
      : tool.url.replace(PLACEHOLDER, match => {
          const placeholder = modelPlaceholder(match);
          if (!placeholder) return match;
          const key = slug(placeholder.description);
          const value = empty(input[key]) ? undefined : coerce(placeholder.type, input[key]);
          if (value === undefined) {
            if (placeholder.required) missing.push(key);
            return "";
          }
          return encodeURIComponent(String(value));
        });

    // Older tools: {param} in the URL takes that argument (encoded); the rest
    // goes to the query string (GET/DELETE) or the JSON body.
    const used = new Set<string>();
    url = fillContext(url, ctx).replace(/{(\w+)}/g, (match, key) => {
      if (!(key in args)) return "";
      used.add(key);
      return encodeURIComponent(String(args[key]));
    });
    const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !used.has(k)));
    const target = new URL(url);
    const sendsBody = !["GET", "DELETE"].includes(tool.method);
    let payload: Record<string, unknown> = rest;
    if (sendsBody && tool.body?.length) {
      const built = buildBody(tool.body, input, ctx);
      missing.push(...built.missing);
      payload = { ...rest, ...built.body };
    }
    if (tool.query?.length) {
      const built = buildBody(tool.query, input, ctx);
      missing.push(...built.missing);
      Object.entries(built.body).forEach(([k, v]) => {
        if (v !== null) target.searchParams.set(k, String(v));
      });
    }
    if (missing.length) return { ok: false, body: `Campos obrigatórios ausentes: ${missing.join(", ")}` };
    if (!sendsBody) Object.entries(rest).forEach(([k, v]) => target.searchParams.set(k, String(v)));
    url = target.toString();

    await assertPublicHost(target.hostname);

    const headers: Record<string, string> = { Accept: "application/json, text/plain;q=0.9, */*;q=0.5" };
    for (const h of tool.headers || []) {
      if (h.valueEncrypted) headers[h.key] = fillContext(decryptSecret(h.valueEncrypted), ctx);
    }
    if (sendsBody) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (tool.timeout || HTTP_TIMEOUT_MS / 1000) * 1000);
    try {
      const response = await (globalThis as any).fetch(url, {
        method: tool.method,
        headers,
        body: sendsBody ? JSON.stringify(payload) : undefined,
        redirect: "manual",
        signal: controller.signal
      });
      const body = responseForModel(String(await response.text()), tool.responseTemplate);
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
