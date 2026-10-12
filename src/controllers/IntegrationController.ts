import { Request, Response } from "express";
import * as Service from "../services/IntegrationServices/CompanyIntegrationService";
import * as PlamevRede from "../services/IntegrationServices/PlamevRedeService";

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

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const plamevEstados = async (req: Request, res: Response): Promise<Response> =>
  res.json(await PlamevRede.estados(req.user.companyId));

export const plamevCidades = async (req: Request, res: Response): Promise<Response> =>
  res.json(await PlamevRede.cidades(req.user.companyId, str(req.query.estadoId) || ""));

export const plamevBairros = async (req: Request, res: Response): Promise<Response> =>
  res.json(await PlamevRede.bairros(req.user.companyId, str(req.query.cidadeId) || ""));

export const plamevCredenciados = async (req: Request, res: Response): Promise<Response> =>
  res.json(
    await PlamevRede.credenciados(req.user.companyId, {
      estadoId: str(req.query.estadoId),
      cidadeId: str(req.query.cidadeId),
      cep: str(req.query.cep),
      bairro: str(req.query.bairro)
    })
  );
