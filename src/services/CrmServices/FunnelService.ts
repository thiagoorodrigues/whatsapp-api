import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import Funnel from "../../models/Funnel";
import FunnelStage from "../../models/FunnelStage";
import FunnelQueue from "../../models/FunnelQueue";
import Queue from "../../models/Queue";
import Deal from "../../models/Deal";
import { DEFAULT_STAGES } from "./defaults";
import { POSITION_STEP } from "./position";
import { canCreateFunnel, reorderOpen, sortStages } from "./stages";
import { canSeeFunnel, isAdmin, Viewer } from "./visibility";
import { invalidateRules } from "./ruleCache";
import { companyRoom } from "../../libs/socketRooms";

export interface FunnelView {
  id: number;
  name: string;
  color: string;
  position: number;
  ownDealsOnly: boolean;
  archived: boolean;
  queueIds: number[];
  stages: FunnelStage[];
}

const assertAdmin = (v: Viewer) => {
  if (!isAdmin(v)) throw new AppError("ERR_NO_PERMISSION", 403);
};

const notFound = () => new AppError("ERR_CRM_NOT_FOUND", 404);

// Archived stages stay off the board; the admin settings ask for them.
const includeWith = (archivedStages: boolean) => [
  { model: FunnelStage, as: "stages", ...(archivedStages ? {} : { where: { archived: false } }), required: false },
  { model: Queue, as: "queues", attributes: ["id"], through: { attributes: [] } }
];

const include = includeWith(false);

const toView = (f: Funnel): FunnelView => ({
  id: f.id,
  name: f.name,
  color: f.color,
  position: f.position,
  ownDealsOnly: f.ownDealsOnly,
  archived: f.archived,
  queueIds: (f.queues || []).map(q => q.id),
  stages: sortStages(f.stages || [])
});

export const emitFunnel = (companyId: number, funnelId: number): void => {
  // Archiving a funnel or a stage changes which rules can still fire.
  invalidateRules(companyId);
  getIO().to(companyRoom(companyId)).emit(`company-${companyId}-funnel`, { action: "update", funnelId });
};

export const listFunnels = async (v: Viewer, opts: { includeArchived?: boolean } = {}): Promise<FunnelView[]> => {
  const withArchived = !!opts.includeArchived && isAdmin(v);
  const rows = await Funnel.findAll({
    where: { companyId: v.companyId, ...(withArchived ? {} : { archived: false }) },
    include: includeWith(withArchived),
    order: [["position", "ASC"], ["id", "ASC"]]
  });
  return rows.map(toView).filter(f => (withArchived && f.archived) || canSeeFunnel(v, f));
};

export const findVisibleFunnel = async (v: Viewer, funnelId: number): Promise<FunnelView> => {
  const row = await Funnel.findOne({ where: { id: funnelId, companyId: v.companyId }, include });
  if (!row) throw notFound();
  const view = toView(row);
  // Admins may still edit archived funnels (e.g. to unarchive them).
  if (!(isAdmin(v) || canSeeFunnel(v, view))) throw notFound();
  return view;
};

const assertQueues = async (companyId: number, queueIds: number[]) => {
  if (!queueIds.length) return;
  const count = await Queue.count({ where: { id: { [Op.in]: queueIds }, companyId } });
  if (count !== new Set(queueIds).size) throw notFound();
};

const setQueues = async (funnelId: number, queueIds: number[], transaction?: any) => {
  await FunnelQueue.destroy({ where: { funnelId }, transaction });
  if (queueIds.length) {
    await FunnelQueue.bulkCreate([...new Set(queueIds)].map(queueId => ({ funnelId, queueId })) as any, { transaction });
  }
};

export const createFunnel = async (
  v: Viewer,
  data: { name: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }
): Promise<FunnelView> => {
  assertAdmin(v);
  if (!data.name || !data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  const company = await Company.findByPk(v.companyId, { include: [{ model: Plan, as: "plan" }] });
  const limit = Number((company as any)?.plan?.crmFunnels ?? 0);
  const active = await Funnel.count({ where: { companyId: v.companyId, archived: false } });
  if (!canCreateFunnel(limit, active)) throw new AppError("ERR_CRM_FUNNEL_LIMIT", 403);
  const queueIds = data.queueIds || [];
  await assertQueues(v.companyId, queueIds);

  const funnelId = await Funnel.sequelize!.transaction(async transaction => {
    const funnel = await Funnel.create(
      {
        companyId: v.companyId,
        name: data.name.trim(),
        color: data.color || "#2070F8",
        ownDealsOnly: !!data.ownDealsOnly,
        position: active
      } as any,
      { transaction }
    );
    await FunnelStage.bulkCreate(
      DEFAULT_STAGES.map((s, i) => ({
        companyId: v.companyId,
        funnelId: funnel.id,
        name: s.name,
        color: s.color,
        kind: s.kind,
        position: s.kind === "open" ? (i + 1) * POSITION_STEP : 0
      })) as any,
      { transaction }
    );
    await setQueues(funnel.id, queueIds, transaction);
    return funnel.id;
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const updateFunnel = async (
  v: Viewer,
  funnelId: number,
  data: { name?: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }
): Promise<FunnelView> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.color !== undefined) patch.color = data.color;
  if (data.ownDealsOnly !== undefined) patch.ownDealsOnly = !!data.ownDealsOnly;
  if (data.queueIds !== undefined) await assertQueues(v.companyId, data.queueIds);
  await Funnel.sequelize!.transaction(async transaction => {
    if (Object.keys(patch).length) {
      await Funnel.update(patch, { where: { id: funnelId, companyId: v.companyId }, transaction });
    }
    if (data.queueIds !== undefined) await setQueues(funnelId, data.queueIds, transaction);
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const setFunnelArchived = async (v: Viewer, funnelId: number, archived: boolean): Promise<FunnelView> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  if (!archived && funnel.archived) {
    const company = await Company.findByPk(v.companyId, { include: [{ model: Plan, as: "plan" }] });
    const limit = Number((company as any)?.plan?.crmFunnels ?? 0);
    const active = await Funnel.count({ where: { companyId: v.companyId, archived: false } });
    if (!canCreateFunnel(limit, active)) throw new AppError("ERR_CRM_FUNNEL_LIMIT", 403);
  }
  await Funnel.update({ archived }, { where: { id: funnelId, companyId: v.companyId } });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

const findStageInFunnel = async (v: Viewer, funnelId: number, stageId: number): Promise<FunnelStage> => {
  const stage = await FunnelStage.findOne({ where: { id: stageId, funnelId, companyId: v.companyId } });
  if (!stage) throw notFound();
  return stage;
};

export const createStage = async (
  v: Viewer,
  funnelId: number,
  data: { name: string; color?: string }
): Promise<FunnelStage> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  if (!data.name || !data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  const lastOpen = funnel.stages.filter(s => s.kind === "open").pop();
  const stage = await FunnelStage.create({
    companyId: v.companyId,
    funnelId,
    name: data.name.trim(),
    color: data.color || "#64748B",
    kind: "open",
    position: (lastOpen ? lastOpen.position : 0) + POSITION_STEP
  } as any);
  emitFunnel(v.companyId, funnelId);
  return stage;
};

export const updateStage = async (
  v: Viewer,
  funnelId: number,
  stageId: number,
  data: { name?: string; color?: string; archived?: boolean }
): Promise<FunnelStage> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  const stage = await findStageInFunnel(v, funnelId, stageId);
  if (data.archived !== undefined && stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  // An archived stage leaves the board, so its deals would become unreachable.
  if (data.archived && (await Deal.count({ where: { stageId, companyId: v.companyId } })) > 0) {
    throw new AppError("ERR_CRM_STAGE_NOT_EMPTY", 400);
  }
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.color !== undefined) patch.color = data.color;
  if (data.archived !== undefined) patch.archived = !!data.archived;
  await stage.update(patch);
  emitFunnel(v.companyId, funnelId);
  return stage;
};

export const deleteStage = async (
  v: Viewer,
  funnelId: number,
  stageId: number,
  moveToStageId?: number
): Promise<void> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  // Locking the stage row makes concurrent moves into it wait, so no deal can
  // arrive between the count and the delete.
  await Funnel.sequelize!.transaction(async transaction => {
    const stage = await FunnelStage.findOne({
      where: { id: stageId, funnelId, companyId: v.companyId },
      transaction,
      lock: true
    });
    if (!stage) throw notFound();
    if (stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
    const deals = await Deal.count({ where: { stageId, companyId: v.companyId }, transaction });
    if (deals > 0) {
      if (!moveToStageId || moveToStageId === stageId) throw new AppError("ERR_CRM_STAGE_NOT_EMPTY", 400);
      const target = await FunnelStage.findOne({
        where: { id: moveToStageId, funnelId, companyId: v.companyId },
        transaction
      });
      if (!target) throw notFound();
      if (target.kind !== "open" || target.archived) throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
      await Deal.update(
        { stageId: target.id, stageEnteredAt: new Date() },
        { where: { stageId, companyId: v.companyId }, transaction }
      );
    }
    await stage.destroy({ transaction });
  });
  emitFunnel(v.companyId, funnelId);
};

export const reorderStages = async (v: Viewer, funnelId: number, openIds: number[]): Promise<FunnelView> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  const positions = reorderOpen(funnel.stages, openIds);
  await Funnel.sequelize!.transaction(async transaction => {
    for (const p of positions) {
      await FunnelStage.update(
        { position: p.position },
        { where: { id: p.id, funnelId, companyId: v.companyId }, transaction }
      );
    }
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const findVisibleStage = async (
  v: Viewer,
  stageId: number
): Promise<{ stage: FunnelStage; funnel: FunnelView }> => {
  const stage = await FunnelStage.findOne({ where: { id: stageId, companyId: v.companyId, archived: false } });
  if (!stage) throw notFound();
  const funnel = await findVisibleFunnel(v, stage.funnelId);
  if (funnel.archived) throw notFound();
  return { stage, funnel };
};
