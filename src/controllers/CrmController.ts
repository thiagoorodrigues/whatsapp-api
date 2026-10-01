import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { getViewer } from "../services/CrmServices/viewer";
import {
  listFunnels, createFunnel, updateFunnel, setFunnelArchived,
  createStage, updateStage, deleteStage, reorderStages
} from "../services/CrmServices/FunnelService";
import {
  listDeals, dealStats, createDeal, showDeal, updateDeal, moveDeal, listContactDeals
} from "../services/CrmServices/DealService";
import { listLossReasons, createLossReason, updateLossReason } from "../services/CrmServices/LossReasonService";
import { listRules, createRule, updateRule, deleteRule } from "../services/CrmServices/FunnelRuleService";

const viewer = (req: Request) => getViewer(req.user as any);
const num = (value: unknown) => Number(value);
const admin = (req: Request) => {
  if (req.user.profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403);
};

export const listFunnelsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listFunnels(await viewer(req), { includeArchived: req.query.includeArchived === "true" }));

export const createFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createFunnel(await viewer(req), req.body));

export const updateFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateFunnel(await viewer(req), num(req.params.funnelId), req.body));

export const archiveFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await setFunnelArchived(await viewer(req), num(req.params.funnelId), req.body.archived !== false));

export const createStageHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createStage(await viewer(req), num(req.params.funnelId), req.body));

export const reorderStagesHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await reorderStages(await viewer(req), num(req.params.funnelId), (req.body.stageIds || []).map(num)));

export const updateStageHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateStage(await viewer(req), num(req.params.funnelId), num(req.params.stageId), req.body));

export const deleteStageHandler = async (req: Request, res: Response): Promise<Response> => {
  const moveTo = req.query.moveTo ? num(req.query.moveTo) : undefined;
  await deleteStage(await viewer(req), num(req.params.funnelId), num(req.params.stageId), moveTo);
  return res.status(204).send();
};

export const listDealsHandler = async (req: Request, res: Response): Promise<Response> => {
  const q = req.query as Record<string, string>;
  return res.json(
    await listDeals(await viewer(req), num(req.params.funnelId), {
      stageId: q.stageId ? num(q.stageId) : undefined,
      page: q.page ? num(q.page) : 1,
      afterPosition: q.afterPosition !== undefined ? num(q.afterPosition) : undefined,
      afterId: q.afterId !== undefined ? num(q.afterId) : undefined,
      search: q.search,
      userId: q.userId ? num(q.userId) : undefined,
      source: q.source || undefined,
      allClosed: q.allClosed === "true"
    })
  );
};

export const dealStatsHandler = async (req: Request, res: Response): Promise<Response> => {
  const q = req.query as Record<string, string>;
  return res.json(
    await dealStats(await viewer(req), num(req.params.funnelId), {
      search: q.search,
      userId: q.userId ? num(q.userId) : undefined,
      source: q.source || undefined
    })
  );
};

export const createDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createDeal(await viewer(req), req.body));

export const showDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await showDeal(await viewer(req), num(req.params.dealId)));

export const updateDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateDeal(await viewer(req), num(req.params.dealId), req.body));

export const moveDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await moveDeal(await viewer(req), num(req.params.dealId), req.body));

export const contactDealsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listContactDeals(await viewer(req), num(req.params.contactId)));

export const listLossReasonsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listLossReasons(req.user.companyId));

export const createLossReasonHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.status(201).json(await createLossReason(req.user.companyId, req.body.name));
};

export const updateLossReasonHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateLossReason(req.user.companyId, num(req.params.id), req.body));
};

export const listRulesHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await listRules(req.user.companyId));
};

export const createRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.status(201).json(await createRule(req.user.companyId, req.body));
};

export const updateRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateRule(req.user.companyId, num(req.params.id), req.body));
};

export const deleteRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  await deleteRule(req.user.companyId, num(req.params.id));
  return res.status(204).send();
};
