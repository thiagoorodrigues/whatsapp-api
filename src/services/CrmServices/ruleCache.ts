import { hasPlanFeature } from "../../helpers/planFeature";
import Funnel from "../../models/Funnel";
import FunnelRule from "../../models/FunnelRule";
import FunnelStage from "../../models/FunnelStage";

export interface ActiveRule {
  id: number;
  funnelId: number;
  stageId: number;
  whatsappId: number | null;
  queueId: number | null;
}

export const RULE_CACHE_MS = 60 * 1000;

// Every inbound message asks for the company's rules, so they live in memory.
const cache = new Map<number, { at: number; rules: ActiveRule[] }>();
// Bumped on invalidation so a load that started before it is not kept.
const versions = new Map<number, number>();

export const invalidateRules = (companyId: number): void => {
  cache.delete(companyId);
  versions.set(companyId, (versions.get(companyId) || 0) + 1);
};

const load = async (companyId: number): Promise<ActiveRule[]> => {
  if (!(await hasPlanFeature(companyId, "useCrm"))) return [];
  const rows = await FunnelRule.findAll({
    where: { companyId, active: true },
    attributes: ["id", "funnelId", "stageId", "whatsappId", "queueId"],
    include: [
      { model: Funnel, as: "funnel", where: { archived: false }, required: true, attributes: [] },
      { model: FunnelStage, as: "stage", where: { kind: "open", archived: false }, required: true, attributes: [] }
    ],
    order: [["id", "ASC"]]
  });
  return rows.map(r => ({
    id: r.id,
    funnelId: r.funnelId,
    stageId: r.stageId,
    whatsappId: r.whatsappId ?? null,
    queueId: r.queueId ?? null
  }));
};

// Active rules whose funnel and stage can still take deals.
export const activeRules = async (companyId: number, now: number = Date.now()): Promise<ActiveRule[]> => {
  const hit = cache.get(companyId);
  if (hit && now - hit.at < RULE_CACHE_MS) return hit.rules;
  const version = versions.get(companyId) || 0;
  const rules = await load(companyId);
  if ((versions.get(companyId) || 0) === version) cache.set(companyId, { at: now, rules });
  return rules;
};
