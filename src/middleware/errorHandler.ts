import { Request, Response, NextFunction } from "express";
import multer from "multer";
import AppError from "../errors/AppError";
import { LogEntry, newProtocol, recordLog } from "../libs/systemLog";
import { rawLogger } from "../utils/logger";
import { routeOf } from "./requestLog";

const requestFields = (req: Request, res: Response): Partial<LogEntry> => {
  const user = (req as any).user;
  const started = res.locals.startedAt as bigint | undefined;
  return {
    source: "api",
    method: req.method,
    route: routeOf(req),
    companyId: user?.companyId,
    userId: user?.id !== undefined ? Number(user.id) : undefined,
    durationMs: started ? Number((process.hrtime.bigint() - started) / BigInt(1000000)) : undefined,
    context: { body: req.body, query: req.query }
  };
};

const codeOf = (message: string): string | undefined => {
  const match = /^([A-Z][A-Z0-9_]{2,})(?::|$)/.exec(message || "");
  return match ? match[1] : undefined;
};

// Todo erro devolvido pela API fica registrado com protocolo; o inesperado
// responde ERR_INTERNAL + protocolo em vez de "Internal server error".
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): Response => {
  const protocol = newProtocol();
  res.locals.logged = true;

  if (err instanceof AppError) {
    recordLog({ ...requestFields(req, res), level: err.statusCode >= 500 ? "error" : "warn", status: err.statusCode, code: codeOf(err.message), message: err.message, protocol } as LogEntry);
    rawLogger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const code = err.code === "LIMIT_FILE_SIZE" ? "ERR_FILE_TOO_LARGE" : "ERR_UPLOAD_INVALID";
    recordLog({ ...requestFields(req, res), level: "warn", status: 400, code, message: err.message, protocol } as LogEntry);
    return res.status(400).json({ error: code });
  }

  recordLog({ ...requestFields(req, res), level: "error", status: 500, code: "ERR_INTERNAL", message: err?.message || String(err), detail: err?.stack, protocol } as LogEntry);
  rawLogger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL", protocol });
};

export default errorHandler;
