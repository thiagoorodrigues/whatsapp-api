import { Request, Response } from "express";
import * as Service from "../services/IntegrationServices/CompanyIntegrationService";

export const catalog = async (_req: Request, res: Response): Promise<Response> =>
  res.json(Service.listCatalog());

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.listForCompany(req.user.companyId));

export const update = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.connect(req.user.companyId, req.params.provider, req.body?.token));

export const test = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.testSaved(req.user.companyId, req.params.provider));

export const remove = async (req: Request, res: Response): Promise<Response> => {
  await Service.disconnect(req.user.companyId, req.params.provider);
  return res.status(204).send();
};
