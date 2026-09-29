// O que fazer quando a conexão com o WhatsApp fecha, pelo código do motivo.
// Códigos do DisconnectReason do Baileys (não importado: pacote ESM).
const LOGGED_OUT = 401; // DisconnectReason.loggedOut
const FORBIDDEN = 403; // DisconnectReason.forbidden
const RESTART_REQUIRED = 515; // DisconnectReason.restartRequired
const NO_RECONNECT = new Set([LOGGED_OUT, 402, FORBIDDEN, 406]);

const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000];

export type ReconnectDecision = { action: "logout" } | { action: "reconnect"; delayMs: number };

export const reconnectDecision = (statusCode: number | undefined, attempt: number): ReconnectDecision => {
  if (statusCode !== undefined && NO_RECONNECT.has(statusCode)) return { action: "logout" };
  if (statusCode === RESTART_REQUIRED) return { action: "reconnect", delayMs: 0 };
  const index = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1);
  return { action: "reconnect", delayMs: BACKOFF_MS[index] };
};
