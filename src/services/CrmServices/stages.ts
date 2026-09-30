import AppError from "../../errors/AppError";
import { StageKind } from "../../models/FunnelStage";
import { renumber } from "./position";

const RANK: Record<StageKind, number> = { open: 0, won: 1, lost: 2 };

// Open stages in their order, then won, then lost.
export const sortStages = <T extends { kind: StageKind; position: number }>(stages: T[]): T[] =>
  [...stages].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.position - b.position);

// New positions for the open stages; won and lost never move.
export const reorderOpen = (
  stages: { id: number; kind: StageKind }[],
  openIds: number[]
): { id: number; position: number }[] => {
  const byId = new Map(stages.map(s => [s.id, s]));
  if (openIds.some(id => byId.get(id) && byId.get(id)!.kind !== "open")) {
    throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  }
  const open = stages.filter(s => s.kind === "open").map(s => s.id);
  const unique = new Set(openIds);
  if (unique.size !== openIds.length || openIds.length !== open.length || openIds.some(id => !open.includes(id))) {
    throw new AppError("ERR_CRM_STAGE_ORDER", 400);
  }
  return renumber(openIds.map(id => ({ id })));
};

export const canCreateFunnel = (limit: number, activeCount: number): boolean =>
  limit === 0 || activeCount < limit;
