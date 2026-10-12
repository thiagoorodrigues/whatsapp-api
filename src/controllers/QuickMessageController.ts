import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import ListService from "../services/QuickMessageService/ListService";
import CreateService from "../services/QuickMessageService/CreateService";
import UpdateService from "../services/QuickMessageService/UpdateService";
import DeleteService from "../services/QuickMessageService/DeleteService";
import FindService from "../services/QuickMessageService/FindService";
import {
  findCompanyQuickMessage,
  removeQuickMessageMedia,
  saveQuickMessageMedia
} from "../services/QuickMessageService/MediaService";

import QuickMessage from "../models/QuickMessage";

import { head } from "lodash";

import AppError from "../errors/AppError";
import { companyRoom } from "../libs/socketRooms";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  userId: string | number;
};

type StoreData = {
  shortcode: string;
  message: string;
  userId: number | number;
};

type FindParams = {
  companyId: string;
  userId: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber, userId } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { records, count, hasMore } = await ListService({
    searchParam,
    pageNumber,
    companyId,
    userId
  });

  return res.json({ records, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body as StoreData;

  const schema = Yup.object().shape({
    shortcode: Yup.string().required(),
    // Pode ficar vazio quando a resposta é só um anexo (o painel confere).
    message: Yup.string()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  // Só o texto: o anexo entra pela rota media-upload.
  const record = await CreateService({
    shortcode: data.shortcode,
    message: data.message || "",
    companyId,
    userId: req.user.id
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-quickmessage`, {
    action: "create",
    record
  });

  return res.status(200).json(record);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const record = await findCompanyQuickMessage(id, req.user.companyId);

  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const data = req.body as StoreData;
  const { companyId } = req.user;

  const schema = Yup.object().shape({
    shortcode: Yup.string().required(),
    // Pode ficar vazio quando a resposta é só um anexo (o painel confere).
    message: Yup.string()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { id } = req.params;

  await findCompanyQuickMessage(id, companyId);
  const record = await UpdateService({
    shortcode: data.shortcode,
    message: data.message || "",
    userId: req.user.id,
    id,
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-quickmessage`, {
    action: "update",
    record
  });

  return res.status(200).json(record);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const record = await findCompanyQuickMessage(id, companyId);
  await removeQuickMessageMedia(record);
  await DeleteService(id);

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-quickmessage`, {
    action: "delete",
    id
  });

  return res.status(200).json({ message: "Contact deleted" });
};

export const findList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const params = req.query as FindParams;
  const records: QuickMessage[] = await FindService({ userId: params.userId, companyId: String(req.user.companyId) });

  return res.status(200).json(records);
};

const emitUpdate = (companyId: number, record: QuickMessage) =>
  getIO().to(companyRoom(companyId)).emit(`company-${companyId}-quickmessage`, { action: "update", record });

export const mediaUpload = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const record = await findCompanyQuickMessage(req.params.id, companyId);
  const file = head(req.files as Express.Multer.File[]);
  await saveQuickMessageMedia(record, file);
  emitUpdate(companyId, record);
  return res.json(record);
};

export const deleteMedia = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const record = await findCompanyQuickMessage(req.params.id, companyId);
  await removeQuickMessageMedia(record);
  emitUpdate(companyId, record);
  return res.json(record);
};
