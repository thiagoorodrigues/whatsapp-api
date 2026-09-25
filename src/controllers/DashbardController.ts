import { Request, Response } from "express";

import DashboardDataService, {
  DashboardData,
  Params
} from "../services/ReportService/DashbardDataService";
import HourlyAttendancesService from "../services/ReportService/HourlyAttendancesService";
import AppError from "../errors/AppError";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const params: Params = req.query;
  const { companyId } = req.user;
  let daysInterval = 3;

  const dashboardData: DashboardData = await DashboardDataService(
    companyId,
    params
  );
  return res.status(200).json(dashboardData);
};

// GET /dashboard/hourly?date=YYYY-MM-DD (local date; defaults to today).
export const hourly = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const date = `${req.query.date || ""}`;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError("ERR_INVALID_DATE", 400);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const rows = await HourlyAttendancesService(companyId, date || today);
  return res.status(200).json(rows);
};
