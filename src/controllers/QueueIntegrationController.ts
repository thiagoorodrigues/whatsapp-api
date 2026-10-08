import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import CreateQueueIntegrationService from "../services/QueueIntegrationServices/CreateQueueIntegrationService";
import DeleteQueueIntegrationService from "../services/QueueIntegrationServices/DeleteQueueIntegrationService";
import ListQueueIntegrationService from "../services/QueueIntegrationServices/ListQueueIntegrationService";
import ShowQueueIntegrationService from "../services/QueueIntegrationServices/ShowQueueIntegrationService";
import UpdateQueueIntegrationService from "../services/QueueIntegrationServices/UpdateQueueIntegrationService";
import { companyRoom } from "../libs/socketRooms";
import { publicIntegration, webhookOptionsFrom } from "../services/QueueIntegrationServices/webhook";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { queueIntegrations, count, hasMore } = await ListQueueIntegrationService({
    searchParam,
    pageNumber,
    companyId
  });

  return res.status(200).json({
    queueIntegrations: await Promise.all(queueIntegrations.map(publicIntegration)),
    count,
    hasMore
  });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { type, name, projectName, jsonContent, language, urlN8N,
    typebotExpires,
    typebotKeywordFinish,
    typebotSlug,
    typebotUnknownMessage,
    typebotKeywordRestart,
    typebotRestartMessage,
    typebotDelayMessage } = req.body;
  const { companyId } = req.user;
  const queueIntegration = await CreateQueueIntegrationService({
    type, name, projectName, jsonContent, language, urlN8N, companyId,
    typebotExpires,
    typebotKeywordFinish,
    typebotSlug,
    typebotUnknownMessage,
    typebotKeywordRestart,
    typebotRestartMessage,
    typebotDelayMessage,
    webhookOptions: webhookOptionsFrom(req.body)
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-queueIntegration`, {
    action: "create",
    queueIntegration: await publicIntegration(queueIntegration)
  });

  return res.status(200).json(await publicIntegration(queueIntegration));
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { integrationId } = req.params;
  const { companyId } = req.user;

  const queueIntegration = await ShowQueueIntegrationService(integrationId, companyId);

  return res.status(200).json(await publicIntegration(queueIntegration));
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { integrationId } = req.params;
  const { webhookToken, ...integrationData } = req.body;
  const { companyId } = req.user;

  const queueIntegration = await UpdateQueueIntegrationService({
    integrationData,
    integrationId,
    companyId,
    webhookOptions: webhookOptionsFrom(req.body)
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-queueIntegration`, {
    action: "update",
    queueIntegration: await publicIntegration(queueIntegration)
  });

  return res.status(201).json(await publicIntegration(queueIntegration));
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { integrationId } = req.params;
  const { companyId } = req.user;

  await DeleteQueueIntegrationService(integrationId, companyId);

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-queueIntegration`, {
    action: "delete",
    integrationId: +integrationId
  });

  return res.status(200).send();
};