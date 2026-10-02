import Deal from "../../../models/Deal";
import { findVisibleFunnel } from "../FunnelService";
import { deleteDeal } from "../DealService";

const emit = jest.fn();
jest.mock("../../../libs/socket", () => ({ getIO: () => { const io: any = { emit }; io.to = () => io; return io; } }));
jest.mock("../FunnelService", () => ({ findVisibleFunnel: jest.fn(), findVisibleStage: jest.fn() }));
jest.mock("../../../models/Deal", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

const admin = { id: 1, profile: "admin", companyId: 4, queueIds: [] };
const seller = { id: 2, profile: "user", companyId: 4, queueIds: [10] };
const row = (data: any = {}) => ({ id: 30, companyId: 4, funnelId: 5, stageId: 25, userId: 2, destroy: jest.fn(), ...data });

beforeEach(() => {
  jest.clearAllMocks();
  (findVisibleFunnel as jest.Mock).mockResolvedValue({ id: 5, ownDealsOnly: false, archived: false, stages: [] });
});

describe("deleteDeal", () => {
  it("removes the seller's own deal and tells the board by id", async () => {
    const deal = row();
    (Deal.findOne as jest.Mock).mockResolvedValue(deal);
    await deleteDeal(seller, 30);
    expect(Deal.findOne).toHaveBeenCalledWith({ where: { id: 30, companyId: 4 } });
    expect(deal.destroy).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("company-4-deal", { action: "delete", dealId: 30, funnelId: 5, stageId: 25 });
  });
  it("refuses a seller deleting someone else's deal", async () => {
    const deal = row({ userId: 9 });
    (Deal.findOne as jest.Mock).mockResolvedValue(deal);
    await expect(deleteDeal(seller, 30)).rejects.toMatchObject({ message: "ERR_NO_PERMISSION", statusCode: 403 });
    expect(deal.destroy).not.toHaveBeenCalled();
  });
  it("lets an admin delete any deal", async () => {
    const deal = row({ userId: null });
    (Deal.findOne as jest.Mock).mockResolvedValue(deal);
    await deleteDeal(admin, 30);
    expect(deal.destroy).toHaveBeenCalled();
  });
  it("answers 404 for deals of another company or out of view", async () => {
    (Deal.findOne as jest.Mock).mockResolvedValue(null);
    await expect(deleteDeal(admin, 30)).rejects.toMatchObject({ statusCode: 404 });
  });
});
