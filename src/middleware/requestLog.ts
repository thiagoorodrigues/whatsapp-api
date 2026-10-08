import { Request, Response, NextFunction } from "express";
import { newProtocol, recordLog } from "../libs/systemLog";
import { requestContext } from "../libs/requestContext";

// Cada requisição vira um registro; erros já gravados pelo errorHandler
// (res.locals.logged) não se repetem.
const SKIP = [/^\/public\//, /^\/socket\.io/, /^\/system-logs/];

export const routeOf = (req: Request): string => String(req.originalUrl || req.url || "").split("?")[0];

const requestLog = (req: Request, res: Response, next: NextFunction): void => {
  const route = routeOf(req);
  if (req.method === "OPTIONS" || (req.method === "GET" && route === "/") || SKIP.some(r => r.test(route))) {
    next();
    return;
  }
  const started = process.hrtime.bigint();
  res.locals.startedAt = started;
  res.on("finish", () => {
    if (res.locals.logged) return;
    const status = res.statusCode;
    const user = (req as any).user;
    recordLog({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      source: "api",
      method: req.method,
      route,
      status,
      durationMs: Number((process.hrtime.bigint() - started) / BigInt(1000000)),
      companyId: user?.companyId,
      userId: user?.id !== undefined ? Number(user.id) : undefined,
      protocol: status >= 400 ? newProtocol() : undefined,
      message: `${req.method} ${route} ${status}`
    });
  });
  requestContext.run({ req, res }, () => next());
};

export default requestLog;
