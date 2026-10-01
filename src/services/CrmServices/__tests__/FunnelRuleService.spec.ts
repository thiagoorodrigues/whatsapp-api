import FunnelRule from "../../../models/FunnelRule";
import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Whatsapp from "../../../models/Whatsapp";
import Queue from "../../../models/Queue";
import { emitFunnel } from "../FunnelService";
import { createRule, updateRule, deleteRule } from "../FunnelRuleService";

jest.mock("../FunnelService", () => ({ emitFunnel: jest.fn() }));
jest.mock("../../../models/FunnelRule", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

const targetsOk = () => {
  (Funnel.findOne as jest.Mock).mockResolvedValue({ id: 5 });
  (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 25 });
  (Whatsapp.findOne as jest.Mock).mockResolvedValue({ id: 2 });
  (Queue.findOne as jest.Mock).mockResolvedValue({ id: 3 });
};

beforeEach(() => {
  jest.clearAllMocks();
  targetsOk();
  (FunnelRule.create as jest.Mock).mockImplementation(async (data: any) => ({ id: 1, ...data }));
});

describe("createRule", () => {
  it("saves a rule for this company's open stage and announces it", async () => {
    const rule = await createRule(4, { funnelId: 5, stageId: 25, whatsappId: 2, queueId: "" as any });
    expect(FunnelRule.create).toHaveBeenCalledWith({
      companyId: 4, funnelId: 5, stageId: 25, whatsappId: 2, queueId: null, active: true
    });
    expect(FunnelStage.findOne).toHaveBeenCalledWith({
      where: { id: 25, funnelId: 5, companyId: 4, kind: "open", archived: false }
    });
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
    expect(rule.id).toBe(1);
  });
  it("refuses a connection from another company", async () => {
    (Whatsapp.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { funnelId: 5, stageId: 25, whatsappId: 99 })).rejects.toMatchObject({
      message: "ERR_CRM_RULE_INVALID", statusCode: 400
    });
    expect(Whatsapp.findOne).toHaveBeenCalledWith({ where: { id: 99, companyId: 4 } });
    expect(FunnelRule.create).not.toHaveBeenCalled();
  });
  it("refuses an archived funnel, a won/lost stage or a missing stage", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { funnelId: 5, stageId: 26 })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
    await expect(createRule(4, { funnelId: 5 } as any)).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
    await expect(createRule(4, { funnelId: 5, stageId: -1 })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
  });
});

describe("updateRule", () => {
  const saved = (data: any) => ({ id: 1, companyId: 4, funnelId: 5, stageId: 25, whatsappId: null, queueId: null, active: true, ...data, update: jest.fn(async function (this: any, patch: any) { return { ...this, ...patch }; }) });

  it("lets the admin turn off a rule whose funnel was archived", async () => {
    const rule = saved({});
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(rule);
    (Funnel.findOne as jest.Mock).mockResolvedValue(null);
    await updateRule(4, 1, { active: false });
    expect(rule.update).toHaveBeenCalledWith({ active: false });
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
  });
  it("validates the targets when the rule stays or turns active", async () => {
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(saved({ active: false }));
    (Funnel.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 1, { active: true })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
  });
  it("only finds this company's rules", async () => {
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 1, { active: false })).rejects.toMatchObject({ statusCode: 404 });
    expect(FunnelRule.findOne).toHaveBeenCalledWith({ where: { id: 1, companyId: 4 } });
  });
});

describe("deleteRule", () => {
  it("removes the rule and announces it", async () => {
    const destroy = jest.fn();
    (FunnelRule.findOne as jest.Mock).mockResolvedValue({ id: 1, funnelId: 5, destroy });
    await deleteRule(4, 1);
    expect(destroy).toHaveBeenCalled();
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
  });
});
