import AppError from "../../errors/AppError";
import LossReason from "../../models/LossReason";
import { DEFAULT_LOSS_REASONS } from "./defaults";

export const seedLossReasons = async (companyId: number): Promise<void> => {
  await LossReason.bulkCreate(DEFAULT_LOSS_REASONS.map(name => ({ companyId, name, active: true })) as any);
};

export const listLossReasons = async (companyId: number): Promise<LossReason[]> =>
  LossReason.findAll({ where: { companyId }, order: [["name", "ASC"]] });

export const createLossReason = async (companyId: number, name: string): Promise<LossReason> => {
  if (!name || !name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  return LossReason.create({ companyId, name: name.trim(), active: true } as any);
};

export const updateLossReason = async (
  companyId: number,
  id: number,
  data: { name?: string; active?: boolean }
): Promise<LossReason> => {
  const reason = await LossReason.findOne({ where: { id, companyId } });
  if (!reason) throw new AppError("ERR_CRM_NOT_FOUND", 404);
  const patch: { name?: string; active?: boolean } = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.active !== undefined) patch.active = !!data.active;
  return reason.update(patch);
};

export const findActiveLossReason = async (companyId: number, id: number): Promise<LossReason | null> =>
  LossReason.findOne({ where: { id, companyId, active: true } });
