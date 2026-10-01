import Deal from "../../../models/Deal";
import DealEvent from "../../../models/DealEvent";
import Contact from "../../../models/Contact";
import { activeRules } from "../ruleCache";
import { findOpenDeal, lockContactFunnel } from "../contactLock";
import { emitDeal } from "../DealService";
import ApplyFunnelRulesService, { matchesRule, queueEntered } from "../ApplyFunnelRulesService";

jest.mock("../ruleCache", () => ({ activeRules: jest.fn() }));
jest.mock("../contactLock", () => ({ findOpenDeal: jest.fn(), lockContactFunnel: jest.fn() }));
jest.mock("../DealService", () => ({
  topPosition: jest.fn().mockResolvedValue(-1024),
  loadCard: jest.fn(async (_c: number, id: number) => ({ id, funnelId: 5, stageId: 25 })),
  emitDeal: jest.fn()
}));
jest.mock("../../../models/Deal", () => ({
  __esModule: true,
  default: { create: jest.fn(), sequelize: { transaction: (fn: any) => fn({ id: "t" }) } }
}));
jest.mock("../../../models/DealEvent", () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../utils/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

const rule = (data: any = {}) => ({ id: 1, funnelId: 5, stageId: 25, whatsappId: null, queueId: null, ...data });
const ticket = { id: 9, companyId: 4, contactId: 77, whatsappId: 2, queueId: 3, userId: 12, isGroup: false };

beforeEach(() => {
  jest.clearAllMocks();
  (activeRules as jest.Mock).mockResolvedValue([rule()]);
  (findOpenDeal as jest.Mock).mockResolvedValue(null);
  (Contact.findOne as jest.Mock).mockResolvedValue({ id: 77, name: "Maria", number: "5511999990000" });
  let next = 100;
  (Deal.create as jest.Mock).mockImplementation(async () => ({ id: next++ }));
});

describe("matchesRule", () => {
  it("treats empty rule fields as 'any'", () => {
    expect(matchesRule(rule(), { whatsappId: 2, queueId: null })).toBe(true);
    expect(matchesRule(rule({ whatsappId: 2 }), { whatsappId: 2, queueId: null })).toBe(true);
    expect(matchesRule(rule({ whatsappId: 2 }), { whatsappId: 6, queueId: null })).toBe(false);
    expect(matchesRule(rule({ whatsappId: 2, queueId: 3 }), { whatsappId: 2, queueId: null })).toBe(false);
    expect(matchesRule(rule({ whatsappId: 2, queueId: 3 }), { whatsappId: 2, queueId: 3 })).toBe(true);
  });
});

describe("queueEntered", () => {
  it("is true only when the ticket lands on a new, non-empty queue", () => {
    expect(queueEntered(null, 3)).toBe(true);
    expect(queueEntered(2, 3)).toBe(true);
    expect(queueEntered(3, 3)).toBe(false);
    expect(queueEntered(3, null)).toBe(false);
    expect(queueEntered(undefined, undefined)).toBe(false);
  });
});

describe("ApplyFunnelRulesService", () => {
  it("creates the deal on the rule's stage, owned by the ticket's user", async () => {
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100]);
    expect(Deal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4, funnelId: 5, stageId: 25, contactId: 77, userId: 12,
        title: "Maria", value: 0, status: "open", position: -1024
      }),
      { transaction: { id: "t" } }
    );
    expect(DealEvent.create).toHaveBeenCalledWith(
      { companyId: 4, dealId: 100, userId: null, type: "created", toValue: "25" },
      { transaction: { id: "t" } }
    );
    expect(emitDeal).toHaveBeenCalledWith(4, "create", { id: 100, funnelId: 5, stageId: 25 });
  });
  it("skips the locked transaction when the contact already has an open deal", async () => {
    (findOpenDeal as jest.Mock).mockResolvedValue({ id: 50 });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([]);
    expect(findOpenDeal).toHaveBeenCalledWith(4, 5, 77);
    expect(lockContactFunnel).not.toHaveBeenCalled();
  });
  it("re-checks inside the lock when the quick check found nothing", async () => {
    (findOpenDeal as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 50 });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([]);
    expect(lockContactFunnel).toHaveBeenCalledWith(4, 77, 5, { id: "t" });
    expect(findOpenDeal).toHaveBeenLastCalledWith(4, 5, 77, { id: "t" });
    expect(Deal.create).not.toHaveBeenCalled();
  });
  it("creates one deal per funnel when two of its rules match", async () => {
    (activeRules as jest.Mock).mockResolvedValue([rule({ id: 1, whatsappId: 2 }), rule({ id: 2, stageId: 26, queueId: 3 }), rule({ id: 3, funnelId: 6, stageId: 30 })]);
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100, 101]);
    expect((Deal.create as jest.Mock).mock.calls.map(c => [c[0].funnelId, c[0].stageId])).toEqual([[5, 25], [6, 30]]);
  });
  it("leaves the owner empty when nobody holds the ticket", async () => {
    await ApplyFunnelRulesService({ ...ticket, userId: null });
    expect((Deal.create as jest.Mock).mock.calls[0][0].userId).toBeNull();
  });
  it("ignores groups and rules that do not match", async () => {
    expect(await ApplyFunnelRulesService({ ...ticket, isGroup: true })).toEqual([]);
    (activeRules as jest.Mock).mockResolvedValue([rule({ queueId: 8 })]);
    expect(await ApplyFunnelRulesService(ticket)).toEqual([]);
    expect(Deal.create).not.toHaveBeenCalled();
  });
  it("keeps going after one rule fails and never throws", async () => {
    (activeRules as jest.Mock).mockResolvedValue([rule(), rule({ id: 2, funnelId: 6, stageId: 30 })]);
    (Deal.create as jest.Mock).mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ id: 101 });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([101]);
    (activeRules as jest.Mock).mockRejectedValue(new Error("cache down"));
    await expect(ApplyFunnelRulesService(ticket)).resolves.toEqual([]);
  });
  it("still reports the deal when the board broadcast fails", async () => {
    (emitDeal as jest.Mock).mockImplementationOnce(() => { throw new Error("socket"); });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100]);
  });
});
