import { Op } from "sequelize";
import FollowUpRule from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";

type Scoped = { id: number; whatsappId: number | null; queueId: number | null };
type Target = { whatsappId: number | null; queueId: number | null };

export const STEPS_INCLUDE = { model: FollowUpStep, as: "steps" };
export const STEPS_ORDER: any = [[{ model: FollowUpStep, as: "steps" }, "order", "ASC"]];

// 4: connection and queue, 3: queue, 2: connection, 1: any; 0: not this ticket.
const score = (rule: Scoped, t: Target): number => {
  if (rule.whatsappId !== null && rule.whatsappId !== t.whatsappId) return 0;
  if (rule.queueId !== null && rule.queueId !== t.queueId) return 0;
  return 1 + (rule.queueId !== null ? 2 : 0) + (rule.whatsappId !== null ? 1 : 0);
};

export const pickRule = <T extends Scoped>(rules: T[], target: Target): T | null => {
  let best: T | null = null;
  let bestScore = 0;
  rules.forEach(rule => {
    const s = score(rule, target);
    if (s > bestScore || (s === bestScore && s > 0 && best && rule.id < best.id)) {
      best = rule;
      bestScore = s;
    }
  });
  return best;
};

const anyOr = (id: number | null) => (id === null ? null : { [Op.or]: [null, id] });

export const ResolveFollowUpRule = async (ticket: {
  companyId: number;
  whatsappId: number | null;
  queueId: number | null;
}): Promise<FollowUpRule | null> => {
  const rules = await FollowUpRule.findAll({
    where: {
      companyId: ticket.companyId,
      active: true,
      trigger: "no_reply",
      whatsappId: anyOr(ticket.whatsappId),
      queueId: anyOr(ticket.queueId)
    } as any,
    include: [STEPS_INCLUDE],
    order: STEPS_ORDER
  });
  return pickRule(rules.filter(rule => rule.steps?.length), {
    whatsappId: ticket.whatsappId ?? null,
    queueId: ticket.queueId ?? null
  });
};
