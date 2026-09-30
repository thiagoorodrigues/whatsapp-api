import { positionBetween, needsRenumber, renumber, POSITION_STEP } from "../position";

describe("positionBetween", () => {
  it("starts an empty column at one step", () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
  });
  it("goes above the first card and below the last one", () => {
    expect(positionBetween(null, 2048)).toBe(1024);
    expect(positionBetween(2048, null)).toBe(3072);
  });
  it("takes the midpoint between neighbours", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});

describe("needsRenumber / renumber", () => {
  it("asks for renumbering when neighbours are too close", () => {
    expect(needsRenumber(1, 1 + 1e-7)).toBe(true);
    expect(needsRenumber(1, 2)).toBe(false);
    expect(needsRenumber(null, 1)).toBe(false);
  });
  it("keeps the order after many moves between the same two cards", () => {
    let a = 1024;
    const b = 2048;
    for (let i = 0; i < 60; i++) a = positionBetween(a, b);
    expect(needsRenumber(a, b)).toBe(true);
    expect(renumber([{ id: 7 }, { id: 3 }, { id: 9 }])).toEqual([
      { id: 7, position: 1024 },
      { id: 3, position: 2048 },
      { id: 9, position: 3072 }
    ]);
  });
});
