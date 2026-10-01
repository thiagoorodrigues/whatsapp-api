import Contact from "../../models/Contact";
import Deal from "../../models/Deal";
import DealEvent from "../../models/DealEvent";
import { logger } from "../../utils/logger";
import { findOpenDeal, lockContactFunnel } from "./contactLock";
import { emitDeal, loadCard, topPosition } from "./DealService";
import { ActiveRule, activeRules } from "./ruleCache";

export interface RuleTicket {
  id: number;
  companyId: number;
  contactId: number;
  whatsappId: number | null;
  queueId: number | null;
  userId: number | null;
  isGroup: boolean;
}

// An empty field on the rule means "any".
export const matchesRule = (rule: ActiveRule, t: { whatsappId: number | null; queueId: number | null }): boolean =>
  (rule.whatsappId === null || rule.whatsappId === t.whatsappId) &&
  (rule.queueId === null || rule.queueId === t.queueId);

export const queueEntered = (oldQueueId: number | null | undefined, newQueueId: number | null | undefined): boolean =>
  !!newQueueId && newQueueId !== oldQueueId;

// Creates the deal unless the contact already has an open one in the funnel.
const createFromRule = async (ticket: RuleTicket, rule: ActiveRule): Promise<number | null> =>
  Deal.sequelize!.transaction(async transaction => {
    const { companyId, contactId } = ticket;
    await lockContactFunnel(companyId, contactId, rule.funnelId, transaction);
    if (await findOpenDeal(companyId, rule.funnelId, contactId, transaction)) return null;
    const contact = await Contact.findOne({ where: { id: contactId, companyId }, attributes: ["id", "name", "number"], transaction });
    if (!contact) return null;
    const deal = await Deal.create(
      {
        companyId,
        funnelId: rule.funnelId,
        stageId: rule.stageId,
        contactId,
        userId: ticket.userId ?? null,
        title: contact.name || contact.number,
        value: 0,
        source: null,
        notes: null,
        status: "open",
        position: await topPosition(companyId, rule.stageId, transaction),
        stageEnteredAt: new Date()
      } as any,
      { transaction }
    );
    await DealEvent.create(
      { companyId, dealId: deal.id, userId: null, type: "created", toValue: String(rule.stageId) } as any,
      { transaction }
    );
    return deal.id;
  });

// Runs the company's automatic rules for a ticket. Never throws: a broken
// rule must not stop the message that triggered it.
const ApplyFunnelRulesService = async (ticket: RuleTicket): Promise<number[]> => {
  if (!ticket || ticket.isGroup) return [];
  const created: number[] = [];
  try {
    const rules = (await activeRules(ticket.companyId)).filter(r => matchesRule(r, ticket));
    // Rules come ordered by id; the first one wins for its funnel.
    const funnels = new Set<number>();
    for (const rule of rules) {
      if (funnels.has(rule.funnelId)) continue;
      funnels.add(rule.funnelId);
      try {
        // Most messages come from contacts that already have a deal: check
        // without a transaction first so they do not hold a pool connection.
        if (await findOpenDeal(ticket.companyId, rule.funnelId, ticket.contactId)) continue;
        const dealId = await createFromRule(ticket, rule);
        if (dealId) created.push(dealId);
      } catch (err) {
        logger.error(`CRM rule ${rule.id}: could not create deal for ticket ${ticket.id}: ${err}`);
      }
    }
  } catch (err) {
    logger.error(`CRM rules: could not apply to ticket ${ticket.id}: ${err}`);
  }
  for (const dealId of created) {
    try {
      emitDeal(ticket.companyId, "create", await loadCard(ticket.companyId, dealId));
    } catch (err) {
      logger.warn(`CRM rules: deal ${dealId} saved but not broadcast: ${err}`);
    }
  }
  return created;
};

export default ApplyFunnelRulesService;
