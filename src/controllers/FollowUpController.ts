import { Request, Response } from "express";
import {
  listRules, showRule, createRule, updateRule, deleteRule, ruleStats, saveStepMedia
} from "../services/FollowUpServices/FollowUpRuleService";
import { activeForTicket, cancelForTicket } from "../services/FollowUpServices/EnrollmentService";

const company = (req: Request) => Number(req.user.companyId);
const num = (value: unknown) => Number(value);

export const index = async (req: Request, res: Response): Promise<Response> => res.json(await listRules(company(req)));

export const show = async (req: Request, res: Response): Promise<Response> =>
  res.json(await showRule(company(req), num(req.params.id)));

export const store = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createRule(company(req), req.body));

export const update = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateRule(company(req), num(req.params.id), req.body));

export const remove = async (req: Request, res: Response): Promise<Response> => {
  await deleteRule(company(req), num(req.params.id));
  return res.status(204).send();
};

export const stats = async (req: Request, res: Response): Promise<Response> =>
  res.json(await ruleStats(company(req), num(req.params.id)));

export const uploadMedia = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await saveStepMedia(company(req), req.file as Express.Multer.File));

export const ticketFollowUp = async (req: Request, res: Response): Promise<Response> =>
  res.json(await activeForTicket(num(req.params.ticketId), company(req)));

export const cancelTicketFollowUp = async (req: Request, res: Response): Promise<Response> => {
  await cancelForTicket(num(req.params.ticketId), company(req), "manual");
  return res.status(204).send();
};
