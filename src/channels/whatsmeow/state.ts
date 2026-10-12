import { gatewayClient, GatewayClient } from "./client";

// Registro em memória do estado de cada conexão no motor whatsmeow, mais a
// saúde do gateway. Só "connected" (confirmado por evento `connection` ou por
// refresh) deixa a conexão pronta para enviar.

export type WhatsmeowStatus =
  | "unknown"
  | "qr"
  | "pair_code"
  | "connected"
  | "disconnected"
  | "logged_out";

const POLL_INTERVAL = 30 * 1000;

const statuses = new Map<number, WhatsmeowStatus>();
// Otimista até o primeiro health falhar: eventos do stream já provam que o
// gateway responde, e isReady continua exigindo "connected".
let up = true;
let timer: NodeJS.Timeout | null = null;

export const setStatus = (connectionId: number, status: WhatsmeowStatus) => {
  statuses.set(connectionId, status);
};

export const getStatus = (connectionId: number): WhatsmeowStatus =>
  statuses.get(connectionId) || "unknown";

export const gatewayUp = (): boolean => up;

export const isReady = (connectionId: number): boolean =>
  up && getStatus(connectionId) === "connected";

// Consulta o gateway e grava o estado confirmado (uso da camada de sessão,
// por exemplo na volta do health).
export const refresh = async (
  connectionId: number,
  client: GatewayClient = gatewayClient()
): Promise<WhatsmeowStatus> => {
  try {
    const { state } = await client.status(connectionId);
    const next: WhatsmeowStatus =
      state === "connecting" ? "unknown" : (state as WhatsmeowStatus);
    setStatus(connectionId, next);
    return next;
  } catch {
    setStatus(connectionId, "unknown");
    return "unknown";
  }
};

// onRecover: chamado quando o gateway volta a responder depois de uma falha
// (a camada de sessão reconfirma quem está conectado; nenhum evento novo
// chega se o gateway não reiniciou).
export const checkHealth = async (
  client: GatewayClient = gatewayClient(),
  onRecover?: () => Promise<void> | void
): Promise<void> => {
  try {
    await client.health();
    const recovered = !up;
    up = true;
    if (recovered && onRecover) {
      try {
        await onRecover();
      } catch {
        // A próxima volta (ou um evento) corrige.
      }
    }
  } catch {
    up = false;
    // Estado "connected" deixa de valer: na volta, só um evento (ou refresh)
    // confirma de novo.
    statuses.forEach((status, id) => {
      if (status === "connected") statuses.set(id, "unknown");
    });
  }
};

export const startHealthPoll = (
  client: GatewayClient = gatewayClient(),
  intervalMs: number = POLL_INTERVAL,
  onRecover?: () => Promise<void> | void
): void => {
  if (timer) return;
  checkHealth(client, onRecover);
  timer = setInterval(() => checkHealth(client, onRecover), intervalMs);
  timer.unref?.();
};

export const stopHealthPoll = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};

// Só para testes.
export const resetState = (): void => {
  statuses.clear();
  up = true;
};
