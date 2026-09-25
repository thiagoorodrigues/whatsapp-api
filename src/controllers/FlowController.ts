import { Request, Response } from "express";
import AppError from "../errors/AppError";
import assertFlowBuilderEnabled from "../services/FlowServices/assertFlowBuilderEnabled";
import {
  listFlows,
  showFlow,
  createFlow,
  updateFlow,
  duplicateFlow,
  deleteFlow,
  setFlowConnections
} from "../services/FlowServices/FlowService";

const guard = async (req: Request, adminOnly = false): Promise<number> => {
  const { companyId, profile } = req.user;
  await assertFlowBuilderEnabled(companyId);
  if (adminOnly && profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  return companyId;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req);
  return res.json(await listFlows(companyId));
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req);
  return res.json(await showFlow(req.params.flowId, companyId));
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req, true);
  return res.status(200).json(await createFlow(req.body, companyId));
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req, true);
  return res.json(await updateFlow(req.params.flowId, req.body, companyId));
};

export const duplicate = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req, true);
  return res.status(200).json(await duplicateFlow(req.params.flowId, companyId));
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req, true);
  await deleteFlow(req.params.flowId, companyId);
  return res.status(200).json({ message: "Flow deleted" });
};

export const connections = async (req: Request, res: Response): Promise<Response> => {
  const companyId = await guard(req, true);
  const { whatsappIds } = req.body;
  return res.json(await setFlowConnections(req.params.flowId, whatsappIds, companyId));
};
