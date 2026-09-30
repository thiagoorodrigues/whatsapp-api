export const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

// Position for a card dropped between two neighbours (null = column edge).
export const positionBetween = (before: number | null, after: number | null): number => {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  return (before + after) / 2;
};

export const needsRenumber = (before: number | null, after: number | null): boolean =>
  before !== null && after !== null && after - before < MIN_GAP;

export const renumber = <T extends { id: number }>(ordered: T[]): { id: number; position: number }[] =>
  ordered.map((item, i) => ({ id: item.id, position: (i + 1) * POSITION_STEP }));
