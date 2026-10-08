import { Request, Response } from "express";
import ListSystemLogsService from "../services/SystemLogServices/ListSystemLogsService";
import SummarySystemLogsService from "../services/SystemLogServices/SummarySystemLogsService";
import { acceptClientLog } from "../services/SystemLogServices/clientLogLimiter";
import { newProtocol, recordLog } from "../libs/systemLog";

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await ListSystemLogsService(req.query as Record<string, string>));

export const summary = async (_req: Request, res: Response): Promise<Response> =>
  res.json(await SummarySystemLogsService());

const KINDS = ["render", "runtime", "network"];

export const client = async (req: Request, res: Response): Promise<Response> => {
  const userId = Number(req.user.id);
  if (!acceptClientLog(userId)) return res.status(204).send();
  const { message, detail, url, kind } = req.body || {};
  const protocol = newProtocol();
  recordLog({
    level: "error",
    source: "web",
    protocol,
    companyId: req.user.companyId,
    userId,
    route: url ? String(url).slice(0, 250) : undefined,
    code: KINDS.includes(kind) ? `WEB_${String(kind).toUpperCase()}` : "WEB_RUNTIME",
    message: String(message || "Erro no navegador"),
    detail: detail ? String(detail) : undefined,
    context: { userAgent: req.headers["user-agent"] }
  });
  return res.json({ protocol });
};
