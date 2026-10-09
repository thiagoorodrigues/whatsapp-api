import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { findAgent } from "../services/AiAgentServices/AgentService";
import {
  createFromFile,
  createFromText,
  deleteDocument,
  knowledgeSettings,
  listDocuments,
  reindexDocument,
  searchKnowledge,
  setEmbeddingModel,
  updateDocument
} from "../services/AiAgentServices/knowledge/KnowledgeService";

const admin = (req: Request) => {
  if (req.user.profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403);
};

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listDocuments(req.params.agentId, req.user.companyId));

// A file (multipart "file") or a text typed in the editor.
export const store = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  const file = req.file as Express.Multer.File | undefined;
  const { title, description, text } = req.body || {};
  const document = file
    ? await createFromFile(req.params.agentId, req.user.companyId, file, { title, description })
    : await createFromText(req.params.agentId, req.user.companyId, { title, description, text });
  return res.status(201).json(document);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateDocument(req.params.agentId, req.params.documentId, req.user.companyId, req.body || {}));
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  await deleteDocument(req.params.agentId, req.params.documentId, req.user.companyId);
  return res.status(204).send();
};

export const reindex = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await reindexDocument(req.params.agentId, req.params.documentId, req.user.companyId));
};

// What the agent would find for a question (editor "testar busca").
export const search = async (req: Request, res: Response): Promise<Response> => {
  const agent = await findAgent(req.params.agentId, req.user.companyId);
  return res.json(await searchKnowledge(agent, String(req.body?.query || "")));
};

export const settings = async (req: Request, res: Response): Promise<Response> =>
  res.json(await knowledgeSettings(req.params.agentId, req.user.companyId));

export const updateSettings = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await setEmbeddingModel(req.params.agentId, req.user.companyId, req.body?.embeddingModel));
};
