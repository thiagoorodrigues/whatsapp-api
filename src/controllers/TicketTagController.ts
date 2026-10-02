import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import MoveKanbanTicketService from "../services/TagServices/MoveKanbanTicketService";
import AddTicketTagService from "../services/TagServices/AddTicketTagService";
import RemoveKanbanTicketTagsService from "../services/TagServices/RemoveKanbanTicketTagsService";

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId, tagId } = req.params;
  const { companyId } = req.user;

  const ticketTag = await AddTicketTagService({ ticketId, tagId, companyId });

  return res.status(201).json(ticketTag);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  await RemoveKanbanTicketTagsService({ ticketId, companyId });

  return res.status(200).json({ message: "Ticket tags removed successfully." });
};

export const moveKanban = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { tagId = null } = req.body;
  const { companyId } = req.user;

  await MoveKanbanTicketService({ ticketId, tagId, companyId });

  getIO().emit(`company-${companyId}-ticketTags`, { action: "update", ticketId: +ticketId });

  return res.status(200).json({ ticketId: +ticketId, tagId });
};
