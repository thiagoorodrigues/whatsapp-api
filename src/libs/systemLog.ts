import crypto from "crypto";
import SystemLog from "../models/SystemLog";

// Logs do sistema: gravados em lote na tabela SystemLogs. Gravar log nunca
// derruba quem chamou: falha ao gravar vai só para o console.

export type LogLevel = "info" | "warn" | "error";
export type LogSource = "api" | "job" | "web";

export interface LogEntry {
  level: LogLevel;
  source: LogSource;
  message: string;
  protocol?: string;
  companyId?: number;
  userId?: number;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  detail?: string;
  context?: unknown;
  createdAt?: Date;
}

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SECRET_KEY = /pass|senha|token|secret|authorization|api[-_]?key|cookie/i;
const BATCH = 200;
const INTERVAL_MS = 2000;
const MAX_QUEUE = 5000;
const MAX_CONTEXT = 4000;

export const newProtocol = (): string =>
  Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join("");

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export const mask = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return cut(value, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map(v => mask(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "***" : mask(v, depth + 1)])
    );
  }
  return value;
};

const limitContext = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  const masked = mask(value);
  const json = JSON.stringify(masked);
  return json.length <= MAX_CONTEXT ? masked : { truncated: true, preview: json.slice(0, MAX_CONTEXT) };
};

const toRow = (entry: LogEntry) => ({
  createdAt: entry.createdAt || new Date(),
  level: entry.level,
  source: entry.source,
  protocol: entry.protocol || null,
  companyId: Number.isFinite(Number(entry.companyId)) && entry.companyId !== undefined ? Number(entry.companyId) : null,
  userId: Number.isFinite(Number(entry.userId)) && entry.userId !== undefined ? Number(entry.userId) : null,
  method: entry.method || null,
  route: entry.route ? cut(entry.route, 250) : null,
  status: entry.status ?? null,
  durationMs: entry.durationMs ?? null,
  code: entry.code ? cut(entry.code, 78) : null,
  message: cut(String(entry.message || ""), 1000),
  detail: entry.detail ? cut(String(entry.detail), 8000) : null,
  context: limitContext(entry.context)
});

let queue: ReturnType<typeof toRow>[] = [];
let dropped = 0;
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

const schedule = (): void => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushLogs();
  }, INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
};

export const flushLogs = (): Promise<void> => {
  if (flushing) return flushing;
  if (!queue.length && !dropped) return Promise.resolve();
  flushing = (async () => {
    try {
      while (queue.length || dropped) {
        const rows = queue.splice(0, BATCH);
        if (dropped) {
          rows.push(toRow({ level: "warn", source: "api", message: `${dropped} registros de log descartados (fila cheia)` }));
          dropped = 0;
        }
        try {
          await SystemLog.bulkCreate(rows as any[]);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`SystemLogs: falha ao gravar ${rows.length} registros: ${(err as Error)?.message || err}`);
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
};

export const recordLog = (entry: LogEntry): void => {
  try {
    if (queue.length >= MAX_QUEUE) {
      dropped += 1;
      return;
    }
    queue.push(toRow(entry));
    if (queue.length >= BATCH) flushLogs();
    else schedule();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`SystemLogs: registro ignorado: ${(err as Error)?.message || err}`);
  }
};

export const resetLogQueueForTests = ({ keepQueue = false } = {}): void => {
  if (!keepQueue) {
    queue = [];
    dropped = 0;
  }
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = null;
};
