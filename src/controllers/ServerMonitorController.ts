import { Request, Response } from "express";
import GetServerMonitorService from "../services/ServerMonitorServices/GetServerMonitorService";
import { clampHours, downsample, getMetricsHistory } from "../services/ServerMonitorServices/metricsHistory";
import { summarizeAlerts } from "../services/ServerMonitorServices/alerts";

export const index = async (_req: Request, res: Response): Promise<Response> =>
  res.json(await GetServerMonitorService());

export const history = async (req: Request, res: Response): Promise<Response> => {
  const hours = clampHours(req.query.hours);
  const points = downsample(await getMetricsHistory(hours));
  return res.json({ hours, points });
};

// O ponto do menu precisa acender justamente quando o monitor falha.
export const alerts = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const monitor = await GetServerMonitorService();
    return res.json(summarizeAlerts(monitor.alerts));
  } catch {
    return res.json({ count: 1, level: "critical" });
  }
};
