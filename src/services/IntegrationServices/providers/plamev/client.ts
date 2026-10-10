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
