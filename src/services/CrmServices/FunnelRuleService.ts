import AppError from "../../errors/AppError";
import Funnel from "../../models/Funnel";
import FunnelRule from "../../models/FunnelRule";
import FunnelStage from "../../models/FunnelStage";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import { emitFunnel } from "./FunnelService";

export interface RuleInput {
  funnelId?: number;
  stageId?: number;
  whatsappId?: number | null;
  queueId?: number | null;
  active?: boolean;
}

interface RuleTargets {
  funnelId: number;
  stageId: number;
  whatsappId: number | null;
  queueId: number | null;
}

const invalid = () => new AppError("ERR_CRM_RULE_INVALID", 400);

const requiredId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalid();
  return n;
};

// Empty select values arrive as "" or null and mean "any".
const optionalId = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : requiredId(value);

// Ids must belong to this company. A rule that will fire also needs an
// active funnel and an open stage; one being turned off does not.
const assertTargets = async (companyId: number, r: RuleTargets, usable: boolean): Promise<void> => {
  if (r.whatsappId === null && r.queueId === null) throw new AppError("ERR_CRM_RULE_EMPTY", 400);
  const [funnel, stage, whatsapp, queue] = await Promise.all([
    Funnel.findOne({ where: { id: r.funnelId, companyId, ...(usable ? { archived: false } : {}) } }),
    FunnelStage.findOne({
      where: { id: r.stageId, funnelId: r.funnelId, companyId, ...(usable ? { kind: "open", archived: false } : {}) }
    }),
    r.whatsappId ? Whatsapp.findOne({ where: { id: r.whatsappId, companyId } }) : true,
    r.queueId ? Queue.findOne({ where: { id: r.queueId, companyId } }) : true
  ]);
  if (!funnel || !stage || !whatsapp || !queue) throw invalid();
};

export const listRules = async (companyId: number): Promise<FunnelRule[]> =>
  FunnelRule.findAll({ where: { companyId }, order: [["id", "ASC"]] });

export const createRule = async (companyId: number, data: RuleInput): Promise<FunnelRule> => {
  const targets: RuleTargets = {
    funnelId: requiredId(data.funnelId),
    stageId: requiredId(data.stageId),
    whatsappId: optionalId(data.whatsappId),
    queueId: optionalId(data.queueId)
  };
  await assertTargets(companyId, targets, true);
  const rule = await FunnelRule.create({ companyId, ...targets, active: data.active !== false } as any);
  emitFunnel(companyId, rule.funnelId);
  return rule;
};

const findRule = async (companyId: number, id: number): Promise<FunnelRule> => {
  const rule = await FunnelRule.findOne({ where: { id, companyId } });
  if (!rule) throw new AppError("ERR_CRM_NOT_FOUND", 404);
  return rule;
};

export const updateRule = async (companyId: number, id: number, data: RuleInput): Promise<FunnelRule> => {
  const rule = await findRule(companyId, id);
  const patch: Partial<RuleTargets> & { active?: boolean } = {};
  if (data.funnelId !== undefined) patch.funnelId = requiredId(data.funnelId);
  if (data.stageId !== undefined) patch.stageId = requiredId(data.stageId);
  if (data.whatsappId !== undefined) patch.whatsappId = optionalId(data.whatsappId);
  if (data.queueId !== undefined) patch.queueId = optionalId(data.queueId);
  if (data.active !== undefined) patch.active = !!data.active;
  const next = {
    funnelId: patch.funnelId ?? rule.funnelId,
    stageId: patch.stageId ?? rule.stageId,
    whatsappId: patch.whatsappId !== undefined ? patch.whatsappId : rule.whatsappId,
    queueId: patch.queueId !== undefined ? patch.queueId : rule.queueId
  };
  // Turning a rule off must work even after its funnel was archived.
  await assertTargets(companyId, next, patch.active ?? rule.active);
  const saved = await rule.update(patch);
  emitFunnel(companyId, next.funnelId);
  return saved;
};

export const deleteRule = async (companyId: number, id: number): Promise<void> => {
  const rule = await findRule(companyId, id);
  await rule.destroy();
  emitFunnel(companyId, rule.funnelId);
};
