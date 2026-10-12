import { IntegrationError } from "../types";

export type Query = Record<string, string | undefined>;

interface Options {
  apiUrl: string;
  token: string;
  fetchFn?: (url: string, init: Record<string, any>) => Promise<any>;
  timeoutMs?: number;
}

// GET on the Plamev API. Token goes literally in Authorization, as their
// Swagger defines it (seller token; sales are attributed to its owner).
export const plamevGet = async (
  { apiUrl, token, fetchFn = (globalThis as any).fetch, timeoutMs = 15000 }: Options,
  path: string,
  query: Query = {}
): Promise<unknown> => {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const target = new URL(path, base);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") target.searchParams.append(key, value);
  });
  const url = target.toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: any;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: token, Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "AbortError";
    throw new IntegrationError("unreachable", timedOut ? "A Plamev não respondeu a tempo." : "Falha de rede ao falar com a Plamev.");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationError("auth", "A Plamev recusou o token.");
  }
  if (!response.ok) {
    throw new IntegrationError("unreachable", `A Plamev respondeu com erro ${response.status}.`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError("unreachable", "A Plamev devolveu uma resposta inválida.");
  }
};

// POST com corpo JSON. A Plamev responde 400 com { erro } quando recusa o
// pedido (raça, cupom, campanha): o motivo dela volta como IntegrationError
// "rejected".
export const plamevPost = async (
  { apiUrl, token, fetchFn = (globalThis as any).fetch, timeoutMs = 20000 }: Options,
  path: string,
  body: unknown
): Promise<unknown> => {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const url = new URL(path, base).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: any;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: token, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "AbortError";
    throw new IntegrationError("unreachable", timedOut ? "A Plamev não respondeu a tempo." : "Falha de rede ao falar com a Plamev.");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationError("auth", "A Plamev recusou o token.");
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new IntegrationError("unreachable", "A Plamev devolveu uma resposta inválida.");
  }
  if (!response.ok) {
    const motivo = typeof data?.erro === "string" ? data.erro : typeof data?.mensagem === "string" ? data.mensagem : null;
    if (response.status === 400 && motivo) throw new IntegrationError("rejected", `A Plamev não aceitou: ${motivo}`);
    throw new IntegrationError("unreachable", `A Plamev respondeu com erro ${response.status}.`);
  }
  return data;
};
