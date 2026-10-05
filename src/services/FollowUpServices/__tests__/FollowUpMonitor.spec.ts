const transaction = { LOCK: { UPDATE: "UPDATE" } };
jest.mock("../../../database", () => ({ __esModule: true, default: { transaction: (fn: any) => fn(transaction) } }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), update: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/TicketTag", () => ({ __esModule: true, default: { findOrCreate: jest.fn() } }));
jest.mock("../resolveRule", () => ({ STEPS_INCLUDE: {}, STEPS_ORDER: [] }));
jest.mock("../buildStepMessage", () => ({ buildStepMessage: jest.fn(async () => ({ type: "text", text: "Oi" })) }));
jest.mock("../EnrollmentService", () => ({
  stopEnrollment: jest.fn(),
  emitFollowUp: jest.fn(),
  scheduleFor: jest.fn(async (_r: any, _t: any, d: Date) => d)
}));
jest.mock("../../MessageServices/SendTicketMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

/* eslint-disable import/first */
import FollowUpEnrollment from "../../../models/FollowUpEnrollment";
import FollowUpRule from "../../../models/FollowUpRule";
import Ticket from "../../../models/Ticket";
import Message from "../../../models/Message";
import Whatsapp from "../../../models/Whatsapp";
import Tag from "../../../models/Tag";
import TicketTag from "../../../models/TicketTag";
import SendTicketMessageService from "../../MessageServices/SendTicketMessageService";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import { stopEnrollment } from "../EnrollmentService";
import { processDueFollowUps, runEnrollment } from "../FollowUpMonitor";
/* eslint-enable import/first */

const NOW = new Date(2026, 9, 5, 10, 0);
const steps = [{ id: 1, order: 1, delayMinutes: 60 }, { id: 2, order: 2, delayMinutes: 1440 }];
let enrollment: any;
const ticket = { id: 50, companyId: 4, whatsappId: 7, queueId: 3, status: "open", contact: { name: "Maria" } };

beforeEach(() => {
  jest.clearAllMocks();
  enrollment = { id: 77, companyId: 4, ticketId: 50, ruleId: 1, currentStep: 1, attempts: 0, status: "active", update: jest.fn() };
  (FollowUpEnrollment.findByPk as jest.Mock).mockResolvedValue(enrollment);
  (Ticket.findByPk as jest.Mock).mockResolvedValue(ticket);
  (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true });
  (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({ id: 1, active: true, respectBusinessHours: true, finalActions: {}, steps });
  (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ status: "CONNECTED" });
});

describe("processDueFollowUps", () => {
  it("claims due enrollments inside a locked transaction before sending", async () => {
    (FollowUpEnrollment.findAll as jest.Mock).mockResolvedValue([{ id: 77 }, { id: 78 }]);
    (FollowUpEnrollment.findByPk as jest.Mock).mockResolvedValue(null);
    expect(await processDueFollowUps(NOW)).toBe(2);
    const query = (FollowUpEnrollment.findAll as jest.Mock).mock.calls[0][0];
    expect(query).toMatchObject({ limit: 50, lock: "UPDATE", skipLocked: true, transaction });
    expect(FollowUpEnrollment.update).toHaveBeenCalledWith(
      { nextRunAt: new Date(2026, 9, 5, 10, 5) },
      { where: { id: [77, 78] }, transaction }
    );
  });
  it("keeps going when one enrollment fails", async () => {
    (FollowUpEnrollment.findAll as jest.Mock).mockResolvedValue([{ id: 77 }, { id: 78 }]);
    (FollowUpEnrollment.findByPk as jest.Mock).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(null);
    await expect(processDueFollowUps(NOW)).resolves.toBe(2);
    expect(FollowUpEnrollment.findByPk).toHaveBeenCalledTimes(2);
  });
});

describe("runEnrollment", () => {
  it("sends the current step marked with the enrollment and schedules the next one", async () => {
    await runEnrollment(77, NOW);
    expect(SendTicketMessageService).toHaveBeenCalledWith(ticket, { type: "text", text: "Oi" }, { followUpEnrollmentId: 77 });
    expect(enrollment.update).toHaveBeenCalledWith({
      currentStep: 2, attempts: 0, lastSentAt: NOW, nextRunAt: new Date(2026, 9, 6, 10, 0)
    });
  });
  it("completes after the last step and runs the final actions", async () => {
    enrollment.currentStep = 2;
    (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({
      id: 1, active: true, respectBusinessHours: true, finalActions: { closeTicket: true, tagId: 12 }, steps
    });
    (Tag.findOne as jest.Mock).mockResolvedValue({ id: 12 });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "completed", null, { lastSentAt: NOW });
    expect(Tag.findOne).toHaveBeenCalledWith({ where: { id: 12, companyId: 4 } });
    expect(TicketTag.findOrCreate).toHaveBeenCalledWith({ where: { ticketId: 50, tagId: 12 } });
    expect(UpdateTicketService).toHaveBeenCalledWith({ ticketData: { status: "closed" }, ticketId: 50, companyId: 4 });
  });
  it("cancels without sending when the ticket closed or the customer wrote last", async () => {
    (Ticket.findByPk as jest.Mock).mockResolvedValue({ ...ticket, status: "closed" });
    await runEnrollment(77, NOW);
    (Ticket.findByPk as jest.Mock).mockResolvedValue(ticket);
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: false });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenNthCalledWith(1, enrollment, "cancelled", "stale");
    expect(stopEnrollment).toHaveBeenNthCalledWith(2, enrollment, "cancelled", "stale");
    expect(SendTicketMessageService).not.toHaveBeenCalled();
  });
  it("completes without sending when the step was removed from the rule", async () => {
    enrollment.currentStep = 3;
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "completed", "rule_changed");
    expect(SendTicketMessageService).not.toHaveBeenCalled();
  });
  it("cancels when the rule was turned off", async () => {
    (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({ id: 1, active: false, steps });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "cancelled", "rule_inactive");
  });
  it("retries in 15 minutes while the connection is down, and fails on the third try", async () => {
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });
    await runEnrollment(77, NOW);
    expect(enrollment.update).toHaveBeenCalledWith({ attempts: 1, nextRunAt: new Date(2026, 9, 5, 10, 15) });
    enrollment.attempts = 2;
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "failed", "whatsapp_disconnected", { attempts: 3 });
  });
  it("retries when sending throws", async () => {
    (SendTicketMessageService as jest.Mock).mockRejectedValueOnce(new Error("socket closed"));
    await runEnrollment(77, NOW);
    expect(enrollment.update).toHaveBeenCalledWith({ attempts: 1, nextRunAt: new Date(2026, 9, 5, 10, 15) });
  });
  it("does nothing for an enrollment that is no longer active", async () => {
    enrollment.status = "replied";
    await runEnrollment(77, NOW);
    expect(Ticket.findByPk).not.toHaveBeenCalled();
  });
});
