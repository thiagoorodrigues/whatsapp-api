import { Op } from "sequelize";
import { sanitizeDealInput, dealEventPayload, cursorCondition } from "../DealService";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));

describe("sanitizeDealInput", () => {
  it("keeps only known fields and normalises them", () => {
    expect(
      sanitizeDealInput({
        title: "  Plano Pro ",
        value: "2400,50",
        source: "instagram",
        notes: " ligar depois ",
        expectedCloseDate: "2026-10-15",
        userId: 3,
        // @ts-expect-error unknown field is dropped
        status: "won"
      })
    ).toEqual({
      title: "Plano Pro",
      value: 2400.5,
      source: "instagram",
      notes: "ligar depois",
      expectedCloseDate: "2026-10-15",
      userId: 3
    });
  });
  it("reads Brazilian money with thousands separators", () => {
    expect(sanitizeDealInput({ value: "1.500,00" })).toEqual({ value: 1500 });
    expect(sanitizeDealInput({ value: "3.500" })).toEqual({ value: 3500 });
    expect(sanitizeDealInput({ value: "R$ 99,9" })).toEqual({ value: 99.9 });
    expect(sanitizeDealInput({ value: "1200.50" })).toEqual({ value: 1200.5 });
  });
  it("refuses negative or non-numeric values", () => {
    expect(() => sanitizeDealInput({ value: -1 })).toThrow("ERR_CRM_INVALID_VALUE");
    expect(() => sanitizeDealInput({ value: "abc" })).toThrow("ERR_CRM_INVALID_VALUE");
  });
  it("refuses values the database cannot store", () => {
    expect(() => sanitizeDealInput({ value: 1e12 })).toThrow("ERR_CRM_INVALID_VALUE");
    expect(sanitizeDealInput({ value: 9999999999.99 })).toEqual({ value: 9999999999.99 });
  });
  it("refuses unknown sources and bad dates", () => {
    expect(() => sanitizeDealInput({ source: "tiktok" })).toThrow("ERR_CRM_INVALID_SOURCE");
    expect(() => sanitizeDealInput({ expectedCloseDate: "15/10/2026" })).toThrow("ERR_CRM_INVALID_DATE");
  });
  it("clears optional fields with empty values", () => {
    expect(sanitizeDealInput({ source: "", notes: "", expectedCloseDate: "", userId: null })).toEqual({
      source: null,
      notes: null,
      expectedCloseDate: null,
      userId: null
    });
  });
  it("refuses an empty title", () => {
    expect(() => sanitizeDealInput({ title: "   " })).toThrow("ERR_CRM_NAME_REQUIRED");
  });
});

describe("dealEventPayload", () => {
  it("broadcasts only ids, never deal contents", () => {
    const card: any = { id: 5, funnelId: 2, stageId: 8, title: "Segredo", value: 999, contact: { name: "Maria", number: "5511" } };
    expect(dealEventPayload("update", card)).toEqual({ action: "update", dealId: 5, funnelId: 2, stageId: 8 });
  });
});

describe("cursorCondition", () => {
  it("continues after the last loaded card, breaking position ties by id", () => {
    expect(cursorCondition(2048, 7)).toEqual({
      [Op.or]: [{ position: { [Op.gt]: 2048 } }, { position: 2048, id: { [Op.gt]: 7 } }]
    });
  });
});
