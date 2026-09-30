import { stageChange } from "../transition";

const now = new Date("2026-09-30T12:00:00Z");
const openDeal = { stageId: 1, status: "open" as const };

describe("stageChange", () => {
  it("returns nothing when the stage does not change", () => {
    expect(stageChange(openDeal, { id: 1, kind: "open" }, {}, now)).toEqual({ patch: {}, events: [] });
  });
  it("moves between open stages", () => {
    const r = stageChange(openDeal, { id: 2, kind: "open" }, {}, now);
    expect(r.patch).toEqual({ stageId: 2, status: "open", stageEnteredAt: now });
    expect(r.events).toEqual([{ type: "stage_changed", fromValue: "1", toValue: "2" }]);
  });
  it("closes as won", () => {
    const r = stageChange(openDeal, { id: 5, kind: "won" }, {}, now);
    expect(r.patch).toMatchObject({ stageId: 5, status: "won", closedAt: now, lossReasonId: null, lossNote: null });
    expect(r.events.map(e => e.type)).toEqual(["stage_changed", "won"]);
  });
  it("requires a loss reason to close as lost", () => {
    expect(() => stageChange(openDeal, { id: 6, kind: "lost" }, {}, now)).toThrow("ERR_CRM_LOSS_REASON_REQUIRED");
    expect(() => stageChange(openDeal, { id: 6, kind: "lost" }, { lossReasonId: null }, now)).toThrow(
      "ERR_CRM_LOSS_REASON_REQUIRED"
    );
  });
  it("closes as lost with reason and note", () => {
    const r = stageChange(openDeal, { id: 6, kind: "lost" }, { lossReasonId: 3, lossNote: "caro" }, now);
    expect(r.patch).toMatchObject({ status: "lost", closedAt: now, lossReasonId: 3, lossNote: "caro" });
    expect(r.events[1]).toEqual({ type: "lost", fromValue: null, toValue: "3" });
  });
  it("reopens a closed deal and clears the closing data", () => {
    const r = stageChange({ stageId: 6, status: "lost" }, { id: 2, kind: "open" }, {}, now);
    expect(r.patch).toEqual({
      stageId: 2, status: "open", stageEnteredAt: now, closedAt: null, lossReasonId: null, lossNote: null
    });
    expect(r.events.map(e => e.type)).toEqual(["stage_changed", "reopened"]);
  });
});
