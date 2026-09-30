import { StageKind } from "../../models/FunnelStage";

export const DEFAULT_STAGES: { name: string; color: string; kind: StageKind }[] = [
  { name: "Lead", color: "#64748B", kind: "open" },
  { name: "Qualificação", color: "#2070F8", kind: "open" },
  { name: "Proposta", color: "#8B5CF6", kind: "open" },
  { name: "Negociação", color: "#F59E0B", kind: "open" },
  { name: "Ganho", color: "#16A34A", kind: "won" },
  { name: "Perdido", color: "#DC2626", kind: "lost" }
];

export const DEAL_SOURCES = ["ad", "instagram", "site", "referral", "whatsapp", "other"];

export const DEFAULT_LOSS_REASONS = ["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"];
