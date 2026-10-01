import Deal from "../../../models/Deal";
import DealEvent from "../../../models/DealEvent";
import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Contact from "../../../models/Contact";
import { hasPlanFeature } from "../../../helpers/planFeature";
import {
  appendSummary,
  crmToolConfig,
  assertCrmToolConfig,
  registerContactDeal,
  qualifyContactDeal
} from "../AgentDealService";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock("../../../helpers/planFeature", () => ({ hasPlanFeature: jest.fn() }));
jest.mock("../DealService", () => ({
  sanitizeDealInput: jest.requireActual("../DealService").sanitizeDealInput,
  topPosition: jest.fn().mockResolvedValue(-1024),
  loadCard: jest.fn().mockResolvedValue({ id: 1, funnelId: 5, stageId: 25 }),
  emitDeal: jest.fn()
}));
jest.mock("../../../models/Deal", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: (fn: any) => fn({}) } }
}));
jest.mock("../../../models/DealEvent", () => ({ __esModule: true, default: { create: jest.fn(), bulkCreate: jest.fn() } }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

const at = new Date("2026-10-01T17:32:00Z");

describe("appendSummary", () => {
  it("starts the notes with a dated summary in São Paulo time", () => {
    expect(appendSummary(null, "Quer plano anual", at)).toBe("Resumo da IA (01/10/2026 14:32): Quer plano anual");
  });
  it("keeps what is already written", () => {
    expect(appendSummary("ligar depois", "Orçamento 3 mil", at)).toBe(
      "ligar depois\n\nResumo da IA (01/10/2026 14:32): Orçamento 3 mil"
    );
  });
});

describe("crmToolConfig", () => {
  it("normalises the saved config", () => {
    expect(crmToolConfig({ enabled: 1, funnelId: "5", stageId: 25, qualifiedStageId: "" })).toEqual({
      enabled: true,
      funnelId: 5,
      stageId: 25,
      qualifiedStageId: null
    });
    expect(crmToolConfig(undefined)).toEqual({ enabled: false, funnelId: null, stageId: null, qualifiedStageId: null });
  });
});

describe("assertCrmToolConfig", () => {
  it("accepts a disabled config without lookups", async () => {
    await assertCrmToolConfig(1, { enabled: false, funnelId: null, stageId: null, qualifiedStageId: null });
    expect(Funnel.findOne).not.toHaveBeenCalled();
  });
  it("refuses a funnel or stage outside the company", async () => {
    (Funnel.findOne as jest.Mock).mockResolvedValue(null);
    await expect(
      assertCrmToolConfig(1, { enabled: true, funnelId: 9, stageId: 90, qualifiedStageId: null })
    ).rejects.toMatchObject({ message: "ERR_AI_CRM_CONFIG", statusCode: 400 });
    expect(Funnel.findOne).toHaveBeenCalledWith({ where: { id: 9, companyId: 1, archived: false } });
  });
  it("refuses a stage that is not an open one of that funnel", async () => {
    (Funnel.findOne as jest.Mock).mockResolvedValue({ id: 5 });
    (FunnelStage.findOne as jest.Mock).mockResolvedValue(null);
    await expect(
      assertCrmToolConfig(1, { enabled: true, funnelId: 5, stageId: 30, qualifiedStageId: null })
    ).rejects.toMatchObject({ message: "ERR_AI_CRM_CONFIG" });
    expect(FunnelStage.findOne).toHaveBeenCalledWith({
      where: { id: 30, funnelId: 5, companyId: 1, kind: "open", archived: false }
    });
  });
});

describe("registerContactDeal", () => {
  const base = { companyId: 1, contactId: 11, funnelId: 5, stageId: 25, summary: "Quer plano anual", now: at };
  beforeEach(() => {
    (hasPlanFeature as jest.Mock).mockResolvedValue(true);
    (Funnel.findOne as jest.Mock).mockResolvedValue({ id: 5 });
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 25, kind: "open" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 11, name: "Maria" });
  });

  it("answers that the CRM is off when the plan lacks it", async () => {
    (hasPlanFeature as jest.Mock).mockResolvedValue(false);
    const r = await registerContactDeal(base);
    expect(r.ok).toBe(false);
    expect(Deal.create).not.toHaveBeenCalled();
  });

  it("creates the deal at the top of the configured stage, without owner", async () => {
    (Deal.findOne as jest.Mock).mockResolvedValue(null);
    (Deal.create as jest.Mock).mockResolvedValue({ id: 1 });
    const r = await registerContactDeal({ ...base, value: "1.500,00", source: "instagram" });
    expect(r).toMatchObject({ ok: true, created: true });
    const row = (Deal.create as jest.Mock).mock.calls[0][0];
    expect(row).toMatchObject({
      companyId: 1, funnelId: 5, stageId: 25, contactId: 11, userId: null, title: "Maria",
      value: 1500, source: "instagram", status: "open", position: -1024,
      notes: "Resumo da IA (01/10/2026 14:32): Quer plano anual"
    });
    expect((DealEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({ type: "created", userId: null });
  });

  it("updates the open deal instead of creating another, appending the summary", async () => {
    const update = jest.fn();
    (Deal.findOne as jest.Mock).mockResolvedValue({ id: 7, notes: "ligar depois", value: "0", title: "Maria", update });
    const r = await registerContactDeal({ ...base, value: 3000, summary: "Orçamento 3 mil" });
    expect(r).toMatchObject({ ok: true, created: false, dealId: 7 });
    expect(Deal.create).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0]).toEqual({
      value: 3000,
      notes: "ligar depois\n\nResumo da IA (01/10/2026 14:32): Orçamento 3 mil"
    });
    expect(Deal.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 1, funnelId: 5, contactId: 11, status: "open" } })
    );
  });

  it("refuses an invalid value with a readable message and writes nothing", async () => {
    (Deal.findOne as jest.Mock).mockResolvedValue(null);
    const r = await registerContactDeal({ ...base, value: "muito" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/valor/i);
    expect(Deal.create).not.toHaveBeenCalled();
  });

  it("requires a summary", async () => {
    const r = await registerContactDeal({ ...base, summary: "  " });
    expect(r.ok).toBe(false);
  });

  it("reports a stage that is no longer available", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue(null);
    const r = await registerContactDeal(base);
    expect(r.ok).toBe(false);
    expect(Deal.create).not.toHaveBeenCalled();
  });
});

describe("qualifyContactDeal", () => {
  const base = { companyId: 1, contactId: 11, funnelId: 5, stageId: 26, now: at };
  beforeEach(() => {
    (hasPlanFeature as jest.Mock).mockResolvedValue(true);
    (Funnel.findOne as jest.Mock).mockResolvedValue({ id: 5 });
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 26, kind: "open" });
  });

  it("asks to register first when the contact has no open deal", async () => {
    (Deal.findOne as jest.Mock).mockResolvedValue(null);
    const r = await qualifyContactDeal(base);
    expect(r.ok).toBe(false);
  });

  it("moves the deal to the qualified stage with a system event", async () => {
    const update = jest.fn();
    (Deal.findOne as jest.Mock).mockResolvedValue({ id: 7, stageId: 25, update });
    const r = await qualifyContactDeal(base);
    expect(r.ok).toBe(true);
    expect(update.mock.calls[0][0]).toMatchObject({ stageId: 26, status: "open", stageEnteredAt: at, position: -1024 });
    expect((DealEvent.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: "stage_changed", fromValue: "25", toValue: "26", userId: null
    });
  });

  it("does nothing when the deal is already there", async () => {
    const update = jest.fn();
    (Deal.findOne as jest.Mock).mockResolvedValue({ id: 7, stageId: 26, update });
    const r = await qualifyContactDeal(base);
    expect(r.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
