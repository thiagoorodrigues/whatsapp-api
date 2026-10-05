import * as Sentry from "@sentry/node";
import { Op } from "sequelize";
import { addMinutes } from "date-fns";
import sequelize from "../../database";
import FollowUpEnrollment from "../../models/FollowUpEnrollment";
import FollowUpRule from "../../models/FollowUpRule";
import Message from "../../models/Message";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { buildStepMessage } from "./buildStepMessage";
import { emitFollowUp, scheduleFor, stopEnrollment } from "./EnrollmentService";
import { STEPS_INCLUDE, STEPS_ORDER } from "./resolveRule";

export const BATCH = 50;
export const CLAIM_MINUTES = 5;
export const RETRY_MINUTES = 15;
export const MAX_ATTEMPTS = 3;

const lastMessageIsOurs = async (ticketId: number): Promise<boolean> => {
  const last = await Message.findOne({
    where: { ticketId, isPrivate: { [Op.not]: true } },
    order: [["createdAt", "DESC"]],
    attributes: ["fromMe"]
  });
  return !!last?.fromMe;
};

type Claim = { id: number; currentStep: number; claimedAt: Date };

/**
 * Writes only if nobody touched the row since our claim: a customer reply,
 * a cancel or a restart by the attendant change status/currentStep/nextRunAt
 * and must win over this run's stale view.
 */
const updateIfClaimed = async (claim: Claim, values: Record<string, unknown>): Promise<boolean> => {
  const [affected] = await FollowUpEnrollment.update(values, {
    where: { id: claim.id, status: "active", currentStep: claim.currentStep, nextRunAt: claim.claimedAt }
  });
  return affected > 0;
};

const retryLater = async (
  enrollment: FollowUpEnrollment,
  claim: Claim,
  rule: FollowUpRule,
  ticket: Ticket,
  now: Date,
  reason: string
): Promise<void> => {
  const attempts = enrollment.attempts + 1;
  const values =
    attempts >= MAX_ATTEMPTS
      ? { status: "failed", stopReason: reason, attempts }
      : { attempts, nextRunAt: await scheduleFor(rule, ticket, addMinutes(now, RETRY_MINUTES)) };
  if (await updateIfClaimed(claim, values)) await emitFollowUp(enrollment.companyId, enrollment.ticketId);
};

const stillClaimed = async (claim: Claim): Promise<boolean> => {
  const fresh = await FollowUpEnrollment.findByPk(claim.id, { attributes: ["id", "status", "currentStep", "nextRunAt"] });
  return (
    !!fresh &&
    fresh.status === "active" &&
    fresh.currentStep === claim.currentStep &&
    new Date(fresh.nextRunAt).getTime() === claim.claimedAt.getTime()
  );
};

const runFinalActions = async (rule: FollowUpRule, ticket: Ticket): Promise<void> => {
  const { tagId, closeTicket } = rule.finalActions || {};
  if (tagId) {
    const tag = await Tag.findOne({ where: { id: tagId, companyId: ticket.companyId } });
    if (tag) await TicketTag.findOrCreate({ where: { ticketId: ticket.id, tagId: tag.id } } as any);
  }
  if (closeTicket) {
    await UpdateTicketService({ ticketData: { status: "closed" }, ticketId: ticket.id, companyId: ticket.companyId });
  }
};

export const runEnrollment = async (id: number, now: Date): Promise<void> => {
  const enrollment = await FollowUpEnrollment.findByPk(id);
  if (!enrollment || enrollment.status !== "active") return;

  // The batch claim can expire while a long batch sends serially; claim this
  // row again so a parallel run that took it meanwhile does not send it twice.
  const claim: Claim = { id: enrollment.id, currentStep: enrollment.currentStep, claimedAt: addMinutes(new Date(), CLAIM_MINUTES) };
  const [claimed] = await FollowUpEnrollment.update(
    { nextRunAt: claim.claimedAt },
    { where: { id: enrollment.id, status: "active", currentStep: enrollment.currentStep, nextRunAt: enrollment.nextRunAt } }
  );
  if (claimed === 0) return;

  // Closed by rating or auto-close, or the customer wrote meanwhile.
  const ticket = await Ticket.findByPk(enrollment.ticketId, { include: ["contact"] });
  if (!ticket || !["open", "pending"].includes(ticket.status) || !(await lastMessageIsOurs(ticket.id))) {
    await stopEnrollment(enrollment, "cancelled", "stale");
    return;
  }

  const rule = await FollowUpRule.findByPk(enrollment.ruleId, { include: [STEPS_INCLUDE], order: STEPS_ORDER });
  if (!rule || !rule.active) {
    await stopEnrollment(enrollment, "cancelled", "rule_inactive");
    return;
  }
  const step = rule.steps[enrollment.currentStep - 1];
  if (!step) {
    await stopEnrollment(enrollment, "completed", "rule_changed");
    return;
  }

  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId, { attributes: ["id", "status"] });
  if (whatsapp?.status !== "CONNECTED") {
    await retryLater(enrollment, claim, rule, ticket, now, "whatsapp_disconnected");
    return;
  }

  try {
    const content = await buildStepMessage(step, ticket, rule);
    // The AI step can take a while: the customer may have replied or the
    // attendant restarted/cancelled meanwhile.
    if (!(await stillClaimed(claim))) return;
    await SendTicketMessageService(ticket, content, { followUpEnrollmentId: enrollment.id });
  } catch (err) {
    logger.warn(`Follow-up ${enrollment.id} could not send step ${enrollment.currentStep}: ${err}`);
    await retryLater(enrollment, claim, rule, ticket, now, "send_error");
    return;
  }

  const next = rule.steps[enrollment.currentStep];
  if (next) {
    const advanced = await updateIfClaimed(claim, {
      currentStep: enrollment.currentStep + 1,
      attempts: 0,
      lastSentAt: now,
      nextRunAt: await scheduleFor(rule, ticket, addMinutes(now, next.delayMinutes))
    });
    if (advanced) await emitFollowUp(enrollment.companyId, enrollment.ticketId);
    return;
  }
  const completed = await updateIfClaimed(claim, { status: "completed", stopReason: null, lastSentAt: now });
  if (!completed) return;
  await emitFollowUp(enrollment.companyId, enrollment.ticketId);
  await runFinalActions(rule, ticket);
};

/**
 * Sends the due steps. Rows are claimed (nextRunAt pushed ahead) inside a
 * SKIP LOCKED transaction, so a parallel run never sends the same step.
 * If the process dies after the claim the row is due again in 5 minutes. A send
 * that throws after delivery (e.g. timeout) is retried and may reach the
 * customer twice: accepted.
 */
export const processDueFollowUps = async (now: Date = new Date()): Promise<number> => {
  const due = await sequelize.transaction(async transaction => {
    const rows = await FollowUpEnrollment.findAll({
      where: { status: "active", nextRunAt: { [Op.lte]: now } },
      order: [["nextRunAt", "ASC"]],
      attributes: ["id"],
      limit: BATCH,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction
    });
    if (rows.length) {
      await FollowUpEnrollment.update(
        { nextRunAt: addMinutes(now, CLAIM_MINUTES) },
        { where: { id: rows.map(r => r.id) }, transaction }
      );
    }
    return rows;
  });

  for (const row of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await runEnrollment(row.id, new Date());
    } catch (err) {
      Sentry.captureException(err);
      logger.error(`Follow-up ${row.id} failed: ${err}`);
    }
  }
  return due.length;
};
