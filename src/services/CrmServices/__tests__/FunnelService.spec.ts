import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Deal from "../../../models/Deal";
import Company from "../../../models/Company";
import { createFunnel, deleteStage, updateStage, listFunnels, emitFunnel } from "../FunnelService";
import { invalidateRules } from "../ruleCache";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock("../ruleCache", () => ({ invalidateRules: jest.fn() }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { count: jest.fn(), findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), sequelize: { transaction: (fn: any) => fn({}) } } }));
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

  it("does not archive an open stage that still has deals", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 7, funnelId: 3, kind: "open", update: jest.fn() });
    (Deal.count as jest.Mock).mockResolvedValue(1);
    await expect(updateStage(admin, 3, 7, { archived: true })).rejects.toMatchObject({ message: "ERR_CRM_STAGE_NOT_EMPTY" });
  });
  it("moves the deals and deletes the stage in one transaction", async () => {
    const destroy = jest.fn();
    (FunnelStage.findOne as jest.Mock)
      .mockResolvedValueOnce({ id: 7, funnelId: 3, kind: "open", destroy })
      .mockResolvedValueOnce({ id: 9, funnelId: 3, kind: "open", archived: false });
    (Deal.count as jest.Mock).mockResolvedValue(2);
    await deleteStage(admin, 3, 7, 9);
    const tx = expect.objectContaining({ transaction: expect.anything() });
    expect(FunnelStage.findOne).toHaveBeenNthCalledWith(1, expect.objectContaining({ transaction: expect.anything(), lock: expect.anything() }));
    expect(Deal.count).toHaveBeenCalledWith(tx);
    expect(Deal.update).toHaveBeenCalledWith(expect.objectContaining({ stageId: 9 }), tx);
    expect(destroy).toHaveBeenCalledWith(tx);
  });
});

describe("listFunnels", () => {
  const stageWhere = () => (Funnel.findAll as jest.Mock).mock.calls[0][0].include[0].where;
  it("hides archived stages on the board", async () => {
    await listFunnels(admin);
    expect(stageWhere()).toEqual({ archived: false });
  });
  it("brings archived stages to the admin settings", async () => {
    await listFunnels(admin, { includeArchived: true });
    expect(stageWhere()).toBeUndefined();
  });
  it("keeps them hidden for non-admins even when asked", async () => {
    await listFunnels(seller, { includeArchived: true });
    expect(stageWhere()).toEqual({ archived: false });
  });
});

describe("emitFunnel", () => {
  it("drops the cached rules, since archiving changes which rules fire", () => {
    emitFunnel(4, 3);
    expect(invalidateRules).toHaveBeenCalledWith(4);
  });
});
