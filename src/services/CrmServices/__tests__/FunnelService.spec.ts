import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Deal from "../../../models/Deal";
import Company from "../../../models/Company";
import { createFunnel, deleteStage, updateStage } from "../FunnelService";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { count: jest.fn(), findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: (fn: any) => fn({}) } } }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: { findOne: jest.fn(), bulkCreate: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../models/FunnelQueue", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), destroy: jest.fn() } }));
jest.mock("../../../models/Deal", () => ({ __esModule: true, default: { count: jest.fn(), update: jest.fn() } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));

const admin = { id: 1, profile: "admin", companyId: 4, queueIds: [] };
const seller = { id: 2, profile: "user", companyId: 4, queueIds: [10] };

describe("createFunnel", () => {
  it("refuses non-admins", async () => {
    await expect(createFunnel(seller, { name: "X" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("blocks at the plan limit", async () => {
    (Company.findByPk as jest.Mock).mockResolvedValue({ plan: { crmFunnels: 1 } });
    (Funnel.count as jest.Mock).mockResolvedValue(1);
    await expect(createFunnel(admin, { name: "Vendas" })).rejects.toMatchObject({
      message: "ERR_CRM_FUNNEL_LIMIT",
      statusCode: 403
    });
    expect(Funnel.count).toHaveBeenCalledWith({ where: { companyId: 4, archived: false } });
  });
});

describe("stage locks", () => {
  const funnelRow = { id: 3, companyId: 4, archived: false, ownDealsOnly: false, queues: [], stages: [] };
  beforeEach(() => {
    (Funnel.findOne as jest.Mock).mockResolvedValue({ ...funnelRow, get: () => funnelRow });
  });
  it("does not delete or archive won/lost stages", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 8, funnelId: 3, kind: "won" });
    await expect(deleteStage(admin, 3, 8)).rejects.toMatchObject({ message: "ERR_CRM_STAGE_LOCKED" });
    await expect(updateStage(admin, 3, 8, { archived: true })).rejects.toMatchObject({ message: "ERR_CRM_STAGE_LOCKED" });
  });
  it("does not delete an open stage with deals unless told where to move them", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 7, funnelId: 3, kind: "open", destroy: jest.fn() });
    (Deal.count as jest.Mock).mockResolvedValue(2);
    await expect(deleteStage(admin, 3, 7)).rejects.toMatchObject({ message: "ERR_CRM_STAGE_NOT_EMPTY" });
  });
});
