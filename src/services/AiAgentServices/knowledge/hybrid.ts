// Reciprocal Rank Fusion: each list adds 1 / (k + position) to a chunk, so
// chunks found by both keyword and semantic search rise to the top without
// comparing their raw scores (which are on different scales).

export const RRF_K = 60;

export const fuseRankings = <T extends { chunkId: number }>(lists: T[][], limit: number, k = RRF_K): T[] => {
  const scores = new Map<number, { item: T; score: number; seen: number }>();
  let seen = 0;
  lists.forEach(list =>
    list.forEach((item, index) => {
      const add = 1 / (k + index + 1);
      const entry = scores.get(item.chunkId);
      if (entry) {
        entry.score += add;
      } else {
        scores.set(item.chunkId, { item, score: add, seen });
        seen += 1;
      }
    })
  );
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.seen - b.seen)
    .slice(0, limit)
    .map(e => e.item);
};
