import pino from "pino";
import { LogEntry, newProtocol, recordLog } from "../libs/systemLog";
import { requestContext } from "../libs/requestContext";

// pino-pretty roda numa worker thread: fora dos testes.
const base = process.env.NODE_ENV === "test"
  ? {}
  : { transport: { target: "pino-pretty", options: { levelFirst: true, translateTime: true, colorize: true } } };

const describe = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// warn/error do código viram registros em SystemLogs.
export const logEntryFromArgs = (level: "warn" | "error", args: unknown[]): LogEntry => {
  let error: Error | undefined;
  const textParts: string[] = [];
  const context: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Error) {
      if (!error) error = arg;
      else textParts.push(arg.message);
    } else if (arg && typeof arg === "object") {
      const { err, ...rest } = arg as Record<string, unknown>;
      if (err instanceof Error && !error) error = err;
      else if (err !== undefined) textParts.push(describe(err));
      Object.assign(context, rest);
    } else {
      const text = describe(arg);
      if (text) textParts.push(text);
    }
  }
  const text = textParts.join(" ");
  const message = error ? (text ? `${text}: ${error.message}` : error.message) : text;
  const ctx = requestContext.getStore();
  const req = ctx?.req as any;
  return {
    level,
    source: req ? "api" : "job",
    message,
    detail: error?.stack,
    context: Object.keys(context).length ? context : undefined,
    protocol: newProtocol(),
    companyId: req?.user?.companyId,
    userId: req?.user?.id !== undefined ? Number(req.user.id) : undefined,
    method: req?.method,
    route: req?.originalUrl ? String(req.originalUrl).split("?")[0] : undefined
  };
};

// Só console: para quem já gravou o registro (tratador de erros da API).
export const rawLogger = pino(base);

const logger = pino({
  ...base,
  hooks: {
    logMethod(args: any[], method: (...a: any[]) => void, level: number) {
      if (level >= 40) {
        try {
          recordLog(logEntryFromArgs(level >= 50 ? "error" : "warn", args));
        } catch (e) {
          // Gravar log nunca derruba quem chamou.
          console.error("Falha ao registrar log do sistema:", e);
        }
      }
      return method.apply(this, args);
    }
  }
});

export { logger };
