import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import CheckSettingsHelper from "../helpers/CheckSettings";
import AppError from "../errors/AppError";

import CreateUserService from "../services/UserServices/CreateUserService";
import ListUsersService from "../services/UserServices/ListUsersService";
import UpdateUserService from "../services/UserServices/UpdateUserService";
import ShowUserService from "../services/UserServices/ShowUserService";
import DeleteUserService from "../services/UserServices/DeleteUserService";
import UpdateUserPreferencesService from "../services/UserServices/UpdateUserPreferencesService";
import SimpleListService, { ListServiceRelatorio } from "../services/UserServices/SimpleListService";
import { logger } from "../utils/logger";
import { companyRoom } from "../libs/socketRooms";
import { userIsSuper } from "../middleware/isSuper";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  limit?: string;
};

type ListQueryParams = {
  companyId: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber, limit } = req.query as IndexQuery;
  const { companyId, profile } = req.user;

  const { users, count, hasMore } = await ListUsersService({
    searchParam,
    pageNumber,
    companyId,
    profile,
    useLimit : limit
  });

  return res.json({ users, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const {
    email,
    password,
    name,
    profile,
    companyId: bodyCompanyId,
    queueIds,
    whatsappId,
    status = true
  } = req.body;
  let userCompanyId: number | null = null;

  if (req.user !== undefined) {
    const { companyId: cId } = req.user;
    userCompanyId = cId;
  }

  if (
    req.url === "/signup" &&
    (await CheckSettingsHelper("userCreation")) === "disabled"
  ) {
    throw new AppError("ERR_USER_CREATION_DISABLED", 403);
  } else if (req.url !== "/signup" && req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  // The company comes from the token. Only /signup (ENV_TOKEN integration)
  // and super users may pick another one.
  const mayPickCompany =
    req.url === "/signup" || (req.user && (await userIsSuper(req.user.id)));
  const targetCompanyId = mayPickCompany ? bodyCompanyId || userCompanyId : userCompanyId;
  if (!targetCompanyId) {
    throw new AppError("ERR_NO_COMPANY_FOUND", 400);
  }

  const user = await CreateUserService({
    email,
    password,
    name,
    profile,
    companyId: targetCompanyId,
    queueIds,
    whatsappId,
    status
  });

  const io = getIO();
  io.to(companyRoom(targetCompanyId)).emit(`company-${targetCompanyId}-user`, {
    action: "create",
    user
  });

  return res.status(200).json(user);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;

  const user = await ShowUserService(userId);
  if (user.companyId !== req.user.companyId && !(await userIsSuper(req.user.id))) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  return res.status(200).json(user);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { id: requestUserId, companyId } = req.user;
  const { userId } = req.params;
  const userData = req.body;

  const user = await UpdateUserService({
    userData,
    userId,
    companyId,
    requestUserId: +requestUserId
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-user`, {
    action: "update",
    user
  });

  return res.status(200).json(user);
};

export const updatePreferences = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id, companyId } = req.user;

  const user = await UpdateUserPreferencesService({
    userId: id,
    signMessage: req.body.signMessage
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-user`, {
    action: "update",
    user
  });

  return res.status(200).json(user);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { userId } = req.params;
  const { companyId } = req.user;

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  await DeleteUserService(userId, companyId, await userIsSuper(req.user.id));

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-user`, {
    action: "delete",
    userId
  });

  return res.status(200).json({ message: "User deleted" });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.query;
  const { companyId: userCompanyId } = req.user;

  const pickCompany = companyId && (await userIsSuper(req.user.id));
  const users = await SimpleListService({
    companyId: pickCompany ? +companyId : userCompanyId
  });

  return res.status(200).json(users);
};

export const listRelatorio = async (req: Request, res: Response): Promise<Response> => {
  const asked = req.query.companyId as string;
  const companyId: string =
    asked && (await userIsSuper(req.user.id)) ? asked : String(req.user.companyId);
  const dataInicial: string = req.query.dataInicial as string;
  const DataFinal: string = req.query.DataFinal as string;
  const User: string = req.query.nome as string;

  const users = await ListServiceRelatorio({
    companyId: companyId,
    DataInicial: dataInicial,
    DataFinal: DataFinal,
    User: User,
  });
  
  return res.status(200).json(users);
};
