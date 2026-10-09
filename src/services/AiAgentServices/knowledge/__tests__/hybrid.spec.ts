import { fuseRankings } from "../hybrid";

const hit = (chunkId: number) => ({ chunkId, content: `c${chunkId}` });

describe("fuseRankings", () => {
  it("puts a chunk found by both searches first", () => {
    const keyword = [hit(1), hit(2)];
    const semantic = [hit(3), hit(1)];
    expect(fuseRankings([keyword, semantic], 5).map(h => h.chunkId)).toEqual([1, 3, 2]);
  });

  it("breaks ties by the order the chunks were first seen (keyword list first)", () => {
    expect(fuseRankings([[hit(1)], [hit(2)]], 5).map(h => h.chunkId)).toEqual([1, 2]);
  });

  it("returns one list as is when the other is empty", () => {
    expect(fuseRankings([[hit(4), hit(5)], []], 5).map(h => h.chunkId)).toEqual([4, 5]);
    expect(fuseRankings([[], []], 5)).toEqual([]);
  });

  it("cuts at the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(i + 1));
    expect(fuseRankings([many], 5)).toHaveLength(5);
  });
});
