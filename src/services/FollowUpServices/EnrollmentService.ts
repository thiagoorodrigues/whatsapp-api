import { UniqueConstraintError } from "sequelize";
import { addMinutes } from "date-fns";
import { getIO } from "../../libs/socket";
import { companyRoom } from "../../libs/socketRooms";
import FollowUpEnrollment, { EnrollmentStatus } from "../../models/FollowUpEnrollment";
import FollowUpRule from "../../models/FollowUpRule";
import { ResolveFollowUpRule, STEPS_INCLUDE } from "./resolveRule";
import { getSchedulesForTicket, nextBusinessSlot } from "./businessHours";

export type FollowUpTicket = {
  id: number;
  companyId: number;
  contactId: number | null;
  whatsappId: number | null;
  queueId: number | null;
  status: string;
  isGroup: boolean;
  flowId?: number | null;
  typebotStatus?: boolean;
};

export interface TicketFollowUp {
  id: number;
  ruleId: number;
  ruleName: string;
  currentStep: number;
  totalSteps: number;
  nextRunAt: Date;
}

const eligible = (t: FollowUpTicket): boolean =>
  ["open", "pending"].includes(t.status) && !t.isGroup && !t.flowId && !t.typebotStatus;

const findActive = (ticketId: number, companyId: number) =>
  FollowUpEnrollment.findOne({ where: { ticketId, companyId, status: "active" } });

export const scheduleFor = async (
  rule: { respectBusinessHours: boolean },
  ticket: { companyId: number; queueId: number | null },
  date: Date
): Promise<Date> => (rule.respectBusinessHours ? nextBusinessSlot(date, await getSchedulesForTicket(ticket)) : date);

export const activeForTicket = async (ticketId: number, companyId: number): Promise<TicketFollowUp | null> => {
  const e = await FollowUpEnrollment.findOne({
    where: { ticketId, companyId, status: "active" },
    include: [{ model: FollowUpRule, as: "rule", attributes: ["id", "name"], include: [{ ...STEPS_INCLUDE, attributes: ["id"] }] }]
  });
  if (!e) return null;
  return {
    id: e.id,
    ruleId: e.ruleId,
    ruleName: e.rule?.name || "",
    currentStep: e.currentStep,
    totalSteps: e.rule?.steps?.length || 0,
    nextRunAt: e.nextRunAt
  };
};

export const emitFollowUp = async (companyId: number, ticketId: number): Promise<void> => {
  const followUp = await activeForTicket(ticketId, companyId);
  getIO().to(companyRoom(companyId)).emit(`company-${companyId}-followup`, { ticketId, followUp });
};

export const stopEnrollment = async (
  enrollment: FollowUpEnrollment,
  status: EnrollmentStatus,
  reason: string | null,
  extra: Partial<FollowUpEnrollment> = {}
): Promise<void> => {
  await enrollment.update({ ...extra, status, stopReason: reason } as any);
  await emitFollowUp(enrollment.companyId, enrollment.ticketId);
};

export const startOrRestart = async (ticket: FollowUpTicket): Promise<FollowUpEnrollment | null> => {
  if (!eligible(ticket)) return null;
  const rule = await ResolveFollowUpRule(ticket);
  const active = await findActive(ticket.id, ticket.companyId);
  if (!rule) {
    if (active) await stopEnrollment(active, "cancelled", "no_rule");
    return null;
  }
  const nextRunAt = await scheduleFor(rule, ticket, addMinutes(new Date(), rule.steps[0].delayMinutes));
  const restart = { ruleId: rule.id, currentStep: 1, attempts: 0, nextRunAt };
  let enrollment = active;
  if (enrollment) {
    await enrollment.update(restart);
  } else {
    try {
      enrollment = await FollowUpEnrollment.create({
        companyId: ticket.companyId, ticketId: ticket.id, contactId: ticket.contactId, status: "active", ...restart
      } as any);
    } catch (err) {
      // Another message of the same ticket enrolled it a moment ago.
      if (!(err instanceof UniqueConstraintError)) throw err;
      enrollment = await findActive(ticket.id, ticket.companyId);
      if (enrollment) await enrollment.update(restart);
    }
  }
  await emitFollowUp(ticket.companyId, ticket.id);
  return enrollment;
};

export const markReplied = async (ticket: { id: number; companyId: number }): Promise<void> => {
  const active = await findActive(ticket.id, ticket.companyId);
  if (active) await stopEnrollment(active, "replied", null);
};

export const cancelForTicket = async (ticketId: number, companyId: number, reason: string): Promise<void> => {
  const active = await findActive(ticketId, companyId);
  if (active) await stopEnrollment(active, "cancelled", reason);
};
