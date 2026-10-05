jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import FollowUpRule from "../../../models/FollowUpRule";
// eslint-disable-next-line import/first
import { pickRule, ResolveFollowUpRule } from "../resolveRule";

const r = (id: number, whatsappId: number | null, queueId: number | null, steps = [{ order: 1 }]) =>
  ({ id, whatsappId, queueId, steps }) as any;

describe("pickRule", () => {
  const all = [r(1, null, null), r(2, 7, null), r(3, null, 3), r(4, 7, 3)];
  it("prefers connection + queue, then queue, then connection, then the general rule", () => {
    expect(pickRule(all, { whatsappId: 7, queueId: 3 })?.id).toBe(4);
    expect(pickRule(all.filter(x => x.id !== 4), { whatsappId: 7, queueId: 3 })?.id).toBe(3);
    expect(pickRule([r(1, null, null), r(2, 7, null)], { whatsappId: 7, queueId: 3 })?.id).toBe(2);
    expect(pickRule([r(1, null, null)], { whatsappId: 7, queueId: 3 })?.id).toBe(1);
  });
  it("ignores rules for another connection or queue", () => {
    expect(pickRule([r(5, 8, null), r(6, null, 9)], { whatsappId: 7, queueId: 3 })).toBeNull();
  });
  it("works for a ticket without queue", () => {
    expect(pickRule(all, { whatsappId: 7, queueId: null })?.id).toBe(2);
  });
  it("breaks ties by the oldest rule", () => {
    expect(pickRule([r(9, null, 3), r(8, null, 3)], { whatsappId: 7, queueId: 3 })?.id).toBe(8);
  });
});

describe("ResolveFollowUpRule", () => {
  it("looks only at this company's active no_reply rules and skips rules without steps", async () => {
    (FollowUpRule.findAll as jest.Mock).mockResolvedValue([r(4, 7, 3, []), r(1, null, null)]);
    const rule = await ResolveFollowUpRule({ companyId: 2, whatsappId: 7, queueId: 3 });
    expect(rule?.id).toBe(1);
    const where = (FollowUpRule.findAll as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: 2, active: true, trigger: "no_reply" });
  });
});
