const emit = jest.fn();
const to = jest.fn(() => ({ emit }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to }) }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: {} }));
jest.mock("../resolveRule", () => ({ ResolveFollowUpRule: jest.fn(), STEPS_INCLUDE: {}, STEPS_ORDER: [] }));
jest.mock("../businessHours", () => ({
  getSchedulesForTicket: jest.fn(async () => []),
  nextBusinessSlot: jest.fn((d: Date) => d)
}));

// eslint-disable-next-line import/first
import FollowUpEnrollment from "../../../models/FollowUpEnrollment";
// eslint-disable-next-line import/first
import { ResolveFollowUpRule } from "../resolveRule";
// eslint-disable-next-line import/first
import { nextBusinessSlot } from "../businessHours";
// eslint-disable-next-line import/first
import { startOrRestart, markReplied, cancelForTicket, activeForTicket } from "../EnrollmentService";
// eslint-disable-next-line import/first
import { followUpOnAgentMessage, followUpOnTicketChanged } from "../hooks";

const NOW = new Date(2026, 9, 5, 10, 0);
const ticket = (over: any = {}) => ({
  id: 50, companyId: 4, contactId: 9, whatsappId: 7, queueId: 3, status: "open", isGroup: false,
  flowId: null, typebotStatus: false, ...over
});
const rule = { id: 1, name: "Orçamento", respectBusinessHours: true, steps: [{ order: 1, delayMinutes: 120 }, { order: 2, delayMinutes: 60 }] };
const enrollment = (over: any = {}) => ({ id: 77, ticketId: 50, companyId: 4, ruleId: 1, currentStep: 2, status: "active", update: jest.fn(), ...over });

beforeAll(() => { jest.useFakeTimers("modern" as any); jest.setSystemTime(NOW); });
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  jest.clearAllMocks();
  (ResolveFollowUpRule as jest.Mock).mockResolvedValue(rule);
  (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(null);
  (FollowUpEnrollment.create as jest.Mock).mockImplementation(async (d: any) => ({ id: 77, ...d }));
});

describe("startOrRestart", () => {
  it("enrolls the ticket on step 1, delay counted from now and fitted to business hours", async () => {
    await startOrRestart(ticket());
    expect(FollowUpEnrollment.create).toHaveBeenCalledWith({
      companyId: 4, ruleId: 1, ticketId: 50, contactId: 9, currentStep: 1, attempts: 0,
      status: "active", nextRunAt: new Date(2026, 9, 5, 12, 0)
    });
    expect(nextBusinessSlot).toHaveBeenCalled();
    expect(emit).toHaveBeenCalled();
  });
  it("restarts an active enrollment from step 1", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await startOrRestart(ticket());
    expect(active.update).toHaveBeenCalledWith({ ruleId: 1, currentStep: 1, attempts: 0, nextRunAt: new Date(2026, 9, 5, 12, 0) });
    expect(FollowUpEnrollment.create).not.toHaveBeenCalled();
  });
  it("skips groups, closed tickets and tickets inside a flow or typebot", async () => {
    for (const t of [ticket({ isGroup: true }), ticket({ status: "closed" }), ticket({ flowId: 3 }), ticket({ typebotStatus: true })]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await startOrRestart(t)).toBeNull();
    }
    expect(ResolveFollowUpRule).not.toHaveBeenCalled();
  });
  it("stops the active enrollment when no rule applies anymore", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    (ResolveFollowUpRule as jest.Mock).mockResolvedValue(null);
    expect(await startOrRestart(ticket())).toBeNull();
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "no_rule" });
  });
  it("ignores business hours when the rule says so", async () => {
    (ResolveFollowUpRule as jest.Mock).mockResolvedValue({ ...rule, respectBusinessHours: false });
    await startOrRestart(ticket());
    expect(nextBusinessSlot).not.toHaveBeenCalled();
  });
});

describe("markReplied / cancelForTicket", () => {
  it("marks the active enrollment as replied", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await markReplied({ id: 50, companyId: 4 });
    expect(FollowUpEnrollment.findOne).toHaveBeenCalledWith({ where: { ticketId: 50, companyId: 4, status: "active" } });
    expect(active.update).toHaveBeenCalledWith({ status: "replied", stopReason: null });
  });
  it("cancels with a reason, scoped by company", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await cancelForTicket(50, 4, "manual");
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "manual" });
  });
  it("does nothing without an active enrollment", async () => {
    await expect(markReplied({ id: 50, companyId: 4 })).resolves.toBeUndefined();
  });
});

describe("activeForTicket", () => {
  it("returns step, total and next send", async () => {
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(
      enrollment({ nextRunAt: NOW, rule: { name: "Orçamento", steps: rule.steps } })
    );
    expect(await activeForTicket(50, 4)).toEqual({
      id: 77, ruleId: 1, ruleName: "Orçamento", currentStep: 2, totalSteps: 2, nextRunAt: NOW
    });
  });
});

describe("hooks", () => {
  it("never throw", async () => {
    (ResolveFollowUpRule as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(followUpOnAgentMessage(ticket() as any)).resolves.toBeUndefined();
  });
  it("cancel on close or queue change, without enrolling again", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await followUpOnTicketChanged(ticket() as any, { closed: false, queueChanged: true });
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "queue_changed" });
    expect(ResolveFollowUpRule).not.toHaveBeenCalled();
  });
});
