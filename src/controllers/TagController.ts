import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import AppError from "../errors/AppError";

import CreateService from "../services/TagServices/CreateService";
import ListService from "../services/TagServices/ListService";
import UpdateService from "../services/TagServices/UpdateService";
import ShowService from "../services/TagServices/ShowService";
import DeleteService from "../services/TagServices/DeleteService";
import SimpleListService from "../services/TagServices/SimpleListService";
import SyncTagService from "../services/TagServices/SyncTagsService";
import KanbanListService from "../services/TagServices/KanbanListService";
import { companyRoom } from "../libs/socketRooms";

type IndexQuery = {
  searchParam?: string;
  pageNumber?: string | number;
  kanban?: number;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { pageNumber, searchParam } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { tags, count, hasMore } = await ListService({
    searchParam,
    pageNumber,
    companyId
  });

  return res.json({ tags, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { name, color, kanban } = req.body;
  const { companyId } = req.user;

  const tag = await CreateService({
    name,
    color,
    companyId,
    kanban
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-tag`, {
    action: "create",
    tag
  });

  return res.status(200).json(tag);
};

export const kanban = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  const tags = await KanbanListService({ companyId });

  return res.json({lista:tags});
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { tagId } = req.params;
  const { companyId } = req.user;

  const tag = await ShowService(tagId, companyId);

  return res.status(200).json(tag);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { tagId } = req.params;
  const { companyId } = req.user;
  const tagData = req.body;

  const tag = await UpdateService({ tagData, id: tagId, companyId });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-tag`, {
    action: "update",
    tag
  });

  return res.status(200).json(tag);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { tagId } = req.params;
  const { companyId } = req.user;

  await DeleteService(tagId, companyId);

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-tag`, {
    action: "delete",
    tagId
  });

  return res.status(200).json({ message: "Tag deleted" });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam } = req.query as IndexQuery;
  const { companyId } = req.user;

  const tags = await SimpleListService({ searchParam, companyId });

  return res.json(tags);
};

export const syncTags = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId, tags: tagList } = req.body;
  const { companyId } = req.user;

  const tags = await SyncTagService({ ticketId, tags: tagList, companyId });

  getIO().to(companyRoom(companyId)).emit(`company-${companyId}-ticketTags`, { action: "update", ticketId });

  return res.json(tags);
};
