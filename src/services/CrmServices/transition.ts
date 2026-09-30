import AppError from "../../errors/AppError";
import { StageKind } from "../../models/FunnelStage";
import { DealStatus } from "../../models/Deal";
import { DealEventType } from "../../models/DealEvent";

export interface StageChangeEvent {
  type: DealEventType;
  fromValue: string | null;
  toValue: string | null;
}

// What changes on a deal when it lands on another stage.
export const stageChange = (
  deal: { stageId: number; status: DealStatus },
  target: { id: number; kind: StageKind },
  input: { lossReasonId?: number | null; lossNote?: string | null },
  now: Date
): { patch: Record<string, unknown>; events: StageChangeEvent[] } => {
  if (deal.stageId === target.id) return { patch: {}, events: [] };
  if (target.kind === "lost" && !input.lossReasonId) {
    throw new AppError("ERR_CRM_LOSS_REASON_REQUIRED", 400);
  }

  const patch: Record<string, unknown> = { stageId: target.id, status: target.kind, stageEnteredAt: now };
  const events: StageChangeEvent[] = [
    { type: "stage_changed", fromValue: String(deal.stageId), toValue: String(target.id) }
  ];

  if (target.kind === "won") {
    Object.assign(patch, { closedAt: now, lossReasonId: null, lossNote: null });
    events.push({ type: "won", fromValue: null, toValue: null });
  } else if (target.kind === "lost") {
    Object.assign(patch, { closedAt: now, lossReasonId: input.lossReasonId, lossNote: input.lossNote ?? null });
    events.push({ type: "lost", fromValue: null, toValue: String(input.lossReasonId) });
  } else if (deal.status !== "open") {
    Object.assign(patch, { closedAt: null, lossReasonId: null, lossNote: null });
    events.push({ type: "reopened", fromValue: deal.status, toValue: null });
  }

  return { patch, events };
};
