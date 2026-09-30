import { canSeeFunnel, ownerScope, canSeeDeal, Viewer } from "../visibility";

const admin: Viewer = { id: 1, profile: "admin", companyId: 1, queueIds: [] };
const seller: Viewer = { id: 2, profile: "user", companyId: 1, queueIds: [10] };
const noQueue: Viewer = { id: 3, profile: "user", companyId: 1, queueIds: [] };

describe("canSeeFunnel", () => {
  it("lets admin see every non-archived funnel, even without queues", () => {
    expect(canSeeFunnel(admin, { archived: false, queueIds: [] })).toBe(true);
    expect(canSeeFunnel(admin, { archived: false, queueIds: [99] })).toBe(true);
  });
  it("hides archived funnels from everyone", () => {
    expect(canSeeFunnel(admin, { archived: true, queueIds: [] })).toBe(false);
    expect(canSeeFunnel(seller, { archived: true, queueIds: [10] })).toBe(false);
  });
  it("shows a funnel to a user only when they share a queue", () => {
    expect(canSeeFunnel(seller, { archived: false, queueIds: [10, 11] })).toBe(true);
    expect(canSeeFunnel(seller, { archived: false, queueIds: [11] })).toBe(false);
  });
  it("hides funnels without queues from non-admins", () => {
    expect(canSeeFunnel(seller, { archived: false, queueIds: [] })).toBe(false);
  });
  it("gives users without queues no funnel at all", () => {
    expect(canSeeFunnel(noQueue, { archived: false, queueIds: [10] })).toBe(false);
  });
});

describe("ownerScope / canSeeDeal", () => {
  it("does not filter for admin or when the funnel shares deals", () => {
    expect(ownerScope(admin, { ownDealsOnly: true })).toBeNull();
    expect(ownerScope(seller, { ownDealsOnly: false })).toBeNull();
  });
  it("limits sellers to their own and unassigned deals", () => {
    expect(ownerScope(seller, { ownDealsOnly: true })).toEqual([2, 0]);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: 2 })).toBe(true);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: null })).toBe(true);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: 5 })).toBe(false);
    expect(canSeeDeal(seller, { ownDealsOnly: false }, { userId: 5 })).toBe(true);
  });
});
