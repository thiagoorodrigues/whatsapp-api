import Deal from "../../../models/Deal";
import { lockContactFunnel, findOpenDeal, hasDealInFunnel } from "../contactLock";

jest.mock("../../../models/Deal", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), count: jest.fn(), sequelize: { query: jest.fn() } }
}));

describe("lockContactFunnel", () => {
  it("takes a transaction lock keyed by company and contact+funnel", async () => {
    const transaction = { id: "t" };
    await lockContactFunnel(4, 77, 5, transaction);
    expect(Deal.sequelize!.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(:a, :b)", {
      replacements: { a: 4, b: (77 * 1000003 + 5) % 2147483647 },
      transaction
    });
  });
});

describe("findOpenDeal", () => {
  it("locks the row when inside a transaction", async () => {
    const transaction = { id: "t" };
    await findOpenDeal(4, 5, 77, transaction);
    expect(Deal.findOne).toHaveBeenLastCalledWith({
      where: { companyId: 4, funnelId: 5, contactId: 77, status: "open" },
      order: [["updatedAt", "DESC"]],
      transaction,
      lock: true
    });
  });
  it("reads without a lock outside a transaction", async () => {
    await findOpenDeal(4, 5, 77);
    expect(Deal.findOne).toHaveBeenLastCalledWith({
      where: { companyId: 4, funnelId: 5, contactId: 77, status: "open" },
      order: [["updatedAt", "DESC"]]
    });
  });
});

describe("hasDealInFunnel", () => {
  it("counts deals of any status, won and lost included", async () => {
    (Deal.count as jest.Mock).mockResolvedValue(1);
    const transaction = { id: "t" };
    expect(await hasDealInFunnel(4, 5, 77, transaction)).toBe(true);
    expect(Deal.count).toHaveBeenLastCalledWith({ where: { companyId: 4, funnelId: 5, contactId: 77 }, transaction });
    (Deal.count as jest.Mock).mockResolvedValue(0);
    expect(await hasDealInFunnel(4, 5, 77)).toBe(false);
    expect(Deal.count).toHaveBeenLastCalledWith({ where: { companyId: 4, funnelId: 5, contactId: 77 } });
  });
});
