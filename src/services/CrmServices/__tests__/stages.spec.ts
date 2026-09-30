import { sortStages, reorderOpen, canCreateFunnel } from "../stages";

const stages = [
  { id: 5, kind: "won" as const, position: 0 },
  { id: 2, kind: "open" as const, position: 2048 },
  { id: 6, kind: "lost" as const, position: 0 },
  { id: 1, kind: "open" as const, position: 1024 }
];

describe("sortStages", () => {
  it("puts open stages by position, then won, then lost", () => {
    expect(sortStages(stages).map(s => s.id)).toEqual([1, 2, 5, 6]);
  });
});

describe("reorderOpen", () => {
  it("renumbers the open stages in the given order", () => {
    expect(reorderOpen(stages, [2, 1])).toEqual([
      { id: 2, position: 1024 },
      { id: 1, position: 2048 }
    ]);
  });
  it("refuses won or lost stages in the list", () => {
    expect(() => reorderOpen(stages, [2, 1, 5])).toThrow("ERR_CRM_STAGE_LOCKED");
  });
  it("refuses a list that misses or repeats open stages", () => {
    expect(() => reorderOpen(stages, [2])).toThrow("ERR_CRM_STAGE_ORDER");
    expect(() => reorderOpen(stages, [2, 2])).toThrow("ERR_CRM_STAGE_ORDER");
    expect(() => reorderOpen(stages, [2, 99])).toThrow("ERR_CRM_STAGE_ORDER");
  });
});

describe("canCreateFunnel", () => {
  it("treats 0 as unlimited", () => {
    expect(canCreateFunnel(0, 50)).toBe(true);
  });
  it("blocks at the limit", () => {
    expect(canCreateFunnel(1, 0)).toBe(true);
    expect(canCreateFunnel(1, 1)).toBe(false);
  });
});
