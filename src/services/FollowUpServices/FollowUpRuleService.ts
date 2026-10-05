import { QueryTypes } from "sequelize";
import AppError from "../../errors/AppError";
import sequelize from "../../database";
import FollowUpRule, { FollowUpFinalActions } from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";
import Whatsapp from "../../models/Whatsapp";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import AiAgent from "../../models/AiAgent";
import { saveCompanyMedia } from "../../helpers/mediaStorage";
import { STEPS_INCLUDE, STEPS_ORDER } from "./resolveRule";

export interface StepInput {
  delayMinutes: number;
  mode: string;
  body: string;
  mediaPath?: string | null;
  mediaName?: string | null;
  aiInstruction?: string | null;
}

export interface RuleInput {
  name?: string;
  active?: boolean;
  whatsappId?: number | null;
  queueId?: number | null;
  respectBusinessHours?: boolean;
  finalActions?: FollowUpFinalActions;
  aiAgentId?: number | null;
  steps?: StepInput[];
}

const MAX_STEPS = 10;
const MAX_DELAY_MINUTES = 60 * 24 * 90;

const invalid = () => new AppError("ERR_FOLLOWUP_INVALID", 400);
const notFound = () => new AppError("ERR_FOLLOWUP_NOT_FOUND", 404);

// Empty select values arrive as "" or null and mean "any".
const optionalId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalid();
  return n;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const cleanSteps = (companyId: number, steps: StepInput[] | undefined, hasAgent: boolean) => {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) throw invalid();
  return steps.map((s, index) => {
    const delayMinutes = Number(s.delayMinutes);
    if (!Number.isInteger(delayMinutes) || delayMinutes <= 0 || delayMinutes > MAX_DELAY_MINUTES) throw invalid();
    if (s.mode !== "text" && s.mode !== "ai") throw invalid();
    const body = text(s.body);
    if (!body) throw invalid();
    const aiInstruction = text(s.aiInstruction) || null;
    if (s.mode === "ai" && (!aiInstruction || !hasAgent)) throw invalid();
    const mediaPath = text(s.mediaPath) || null;
    // Files under /public are served by URL: only this company's folder.
    if (mediaPath && (!mediaPath.startsWith(`company${companyId}/`) || mediaPath.includes(".."))) throw invalid();
    return {
      order: index + 1,
      delayMinutes,
      mode: s.mode,
      body,
      mediaPath,
      mediaName: mediaPath ? text(s.mediaName) || null : null,
      aiInstruction: s.mode === "ai" ? aiInstruction : null
    };
  });
};

const assertOwned = async (companyId: number, ids: { whatsappId: number | null; queueId: number | null; tagId: number | null; aiAgentId: number | null }) => {
  const [whatsapp, queue, tag, agent] = await Promise.all([
    ids.whatsappId ? Whatsapp.findOne({ where: { id: ids.whatsappId, companyId } }) : true,
    ids.queueId ? Queue.findOne({ where: { id: ids.queueId, companyId } }) : true,
    ids.tagId ? Tag.findOne({ where: { id: ids.tagId, companyId } }) : true,
    ids.aiAgentId ? AiAgent.findOne({ where: { id: ids.aiAgentId, companyId } }) : true
  ]);
  if (!whatsapp || !queue || !tag || !agent) throw invalid();
};

const findOwned = async (companyId: number, id: number) => {
  const rule = await FollowUpRule.findOne({ where: { id, companyId }, include: [STEPS_INCLUDE], order: STEPS_ORDER });
  if (!rule) throw notFound();
  return rule;
};

const ruleFields = (input: RuleInput, current?: FollowUpRule) => {
  const name = input.name !== undefined ? text(input.name) : current?.name;
  if (!name) throw invalid();
  const finalActions = input.finalActions !== undefined ? input.finalActions || {} : current?.finalActions || {};
  return {
    name: name.slice(0, 120),
    active: input.active !== undefined ? input.active !== false : current?.active ?? true,
    whatsappId: input.whatsappId !== undefined ? optionalId(input.whatsappId) : current?.whatsappId ?? null,
    queueId: input.queueId !== undefined ? optionalId(input.queueId) : current?.queueId ?? null,
    respectBusinessHours:
      input.respectBusinessHours !== undefined ? input.respectBusinessHours !== false : current?.respectBusinessHours ?? true,
    aiAgentId: input.aiAgentId !== undefined ? optionalId(input.aiAgentId) : current?.aiAgentId ?? null,
    finalActions: { closeTicket: !!finalActions.closeTicket, tagId: optionalId(finalActions.tagId) }
  };
};

export const listRules = async (companyId: number) => {
  const rules = await FollowUpRule.findAll({ where: { companyId }, include: [STEPS_INCLUDE], order: [["id", "ASC"], ...STEPS_ORDER] });
  const counts: { ruleId: number; enrolled: string; replied: string }[] = await sequelize.query(
    `SELECT "ruleId", count(*) enrolled, count(*) FILTER (WHERE status = 'replied') replied
       FROM "FollowUpEnrollments" WHERE "companyId" = :companyId GROUP BY "ruleId"`,
    { replacements: { companyId }, type: QueryTypes.SELECT }
  );
  return rules.map(rule => {
    const c = counts.find(x => x.ruleId === rule.id);
    return { ...rule.toJSON(), stepCount: rule.steps?.length || 0, enrolled: Number(c?.enrolled || 0), replied: Number(c?.replied || 0) };
  });
};

export const showRule = findOwned;

export const createRule = async (companyId: number, input: RuleInput): Promise<FollowUpRule> => {
  const fields = ruleFields(input);
  const steps = cleanSteps(companyId, input.steps, !!fields.aiAgentId);
  await assertOwned(companyId, { ...fields, tagId: fields.finalActions.tagId });
  const id = await sequelize.transaction(async transaction => {
    const rule = await FollowUpRule.create({ companyId, trigger: "no_reply", ...fields } as any, { transaction });
    await FollowUpStep.bulkCreate(steps.map(s => ({ ...s, ruleId: rule.id })) as any, { transaction });
    return rule.id;
  });
  return findOwned(companyId, id);
};

export const updateRule = async (companyId: number, id: number, input: RuleInput): Promise<FollowUpRule> => {
  const rule = await findOwned(companyId, id);
  const onlyActive = Object.keys(input).length === 1 && input.active !== undefined;
  if (onlyActive) {
    await sequelize.transaction(transaction => rule.update({ active: input.active !== false }, { transaction }));
    return findOwned(companyId, id);
  }
  const fields = ruleFields(input, rule);
  const steps = input.steps !== undefined ? cleanSteps(companyId, input.steps, !!fields.aiAgentId) : null;
  if (!steps && !fields.aiAgentId && (rule.steps || []).some(s => s.mode === "ai")) throw invalid();
  await assertOwned(companyId, { ...fields, tagId: fields.finalActions.tagId });
  await sequelize.transaction(async transaction => {
    await rule.update(fields as any, { transaction });
    if (steps) {
      await FollowUpStep.destroy({ where: { ruleId: rule.id }, transaction });
      await FollowUpStep.bulkCreate(steps.map(s => ({ ...s, ruleId: rule.id })) as any, { transaction });
    }
  });
  return findOwned(companyId, id);
};

export const deleteRule = async (companyId: number, id: number): Promise<void> => {
  const rule = await findOwned(companyId, id);
  await rule.destroy();
};

export const ruleStats = async (companyId: number, id: number) => {
  await findOwned(companyId, id);
  const byStatusRows: { status: string; total: string }[] = await sequelize.query(
    `SELECT status, count(*) total FROM "FollowUpEnrollments" WHERE "ruleId" = :id AND "companyId" = :companyId GROUP BY status`,
    { replacements: { id, companyId }, type: QueryTypes.SELECT }
  );
  // A step "got a reply" when the enrollment stopped as replied right after it.
  const bySteps: { order: string; sent: string; replied: string }[] = await sequelize.query(
    `SELECT m.step "order", count(*) sent,
            count(*) FILTER (WHERE e.status = 'replied' AND e."currentStep" = m.step + 1) replied
       FROM (SELECT "followUpEnrollmentId",
                    row_number() OVER (PARTITION BY "followUpEnrollmentId" ORDER BY "createdAt") step
               FROM "Messages" WHERE "companyId" = :companyId AND "followUpEnrollmentId" IS NOT NULL) m
       JOIN "FollowUpEnrollments" e ON e.id = m."followUpEnrollmentId" AND e."ruleId" = :id
      GROUP BY m.step ORDER BY m.step`,
    { replacements: { id, companyId }, type: QueryTypes.SELECT }
  );
  return {
    byStatus: Object.fromEntries(byStatusRows.map(r => [r.status, Number(r.total)])),
    bySteps: bySteps.map(r => ({ order: Number(r.order), sent: Number(r.sent), replied: Number(r.replied) }))
  };
};

export const saveStepMedia = async (companyId: number, file: Express.Multer.File) => {
  if (!file?.buffer) throw invalid();
  const mediaPath = await saveCompanyMedia(companyId, file.buffer, file.originalname, file.mimetype);
  return { mediaPath, mediaName: file.originalname };
};
