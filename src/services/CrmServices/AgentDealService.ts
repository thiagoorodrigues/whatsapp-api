import AppError from "../../errors/AppError";
import { hasPlanFeature } from "../../helpers/planFeature";
import Contact from "../../models/Contact";
import Deal from "../../models/Deal";
import DealEvent from "../../models/DealEvent";
import Funnel from "../../models/Funnel";
import FunnelStage from "../../models/FunnelStage";
import { emitDeal, loadCard, sanitizeDealInput, topPosition } from "./DealService";

// Deal changes made by the AI agent: same CRM rules, no user (events show
// as automatic), limited to the conversation's contact and one funnel.

export interface CrmToolConfig {
  enabled: boolean;
  funnelId: number | null;
  stageId: number | null;
  qualifiedStageId: number | null;
}

interface Outcome {
  ok: boolean;
  message: string;
  created?: boolean;
  dealId?: number;
}

const idOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const crmToolConfig = (raw: any): CrmToolConfig => ({
  enabled: !!(raw && raw.enabled),
  funnelId: idOrNull(raw && raw.funnelId),
  stageId: idOrNull(raw && raw.stageId),
  qualifiedStageId: idOrNull(raw && raw.qualifiedStageId)
});

const stamp = (at: Date) =>
  at
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
    .replace(",", "");

// Adds the agent's summary without touching what people already wrote.
export const appendSummary = (notes: string | null, summary: string, at: Date): string => {
  const line = `Resumo da IA (${stamp(at)}): ${summary.trim()}`;
  return notes && notes.trim() ? `${notes}\n\n${line}` : line;
};

const findOpenStage = (companyId: number, funnelId: number | null, stageId: number | null) =>
  stageId && funnelId
    ? FunnelStage.findOne({ where: { id: stageId, funnelId, companyId, kind: "open", archived: false } })
    : Promise.resolve(null);

const findActiveFunnel = (companyId: number, funnelId: number | null) =>
  funnelId ? Funnel.findOne({ where: { id: funnelId, companyId, archived: false } }) : Promise.resolve(null);

// Saving an agent: the funnel and stages must be this company's open ones.
export const assertCrmToolConfig = async (companyId: number, cfg: CrmToolConfig): Promise<void> => {
  if (!cfg || !cfg.enabled) return;
  const invalid = () => new AppError("ERR_AI_CRM_CONFIG", 400);
  if (!(await findActiveFunnel(companyId, cfg.funnelId))) throw invalid();
  if (!(await findOpenStage(companyId, cfg.funnelId, cfg.stageId))) throw invalid();
  if (cfg.qualifiedStageId && !(await findOpenStage(companyId, cfg.funnelId, cfg.qualifiedStageId))) throw invalid();
};

const unavailable = async (companyId: number, funnelId: number | null, stageId: number | null) => {
  if (!(await hasPlanFeature(companyId, "useCrm"))) return "O CRM não está disponível no plano desta empresa.";
  if (!(await findActiveFunnel(companyId, funnelId)) || !(await findOpenStage(companyId, funnelId, stageId))) {
    return "O funil ou a coluna configurados para o agente não estão mais disponíveis.";
  }
  return null;
};

const openDealOf = (companyId: number, funnelId: number, contactId: number) =>
  Deal.findOne({ where: { companyId, funnelId, contactId, status: "open" }, order: [["updatedAt", "DESC"]] });

const ERROR_TEXT: Record<string, string> = {
  ERR_CRM_INVALID_VALUE: "Valor inválido: informe um número maior ou igual a zero.",
  ERR_CRM_INVALID_SOURCE: "Origem inválida.",
  ERR_CRM_NAME_REQUIRED: "Título vazio."
};

export const registerContactDeal = async (params: {
  companyId: number;
  contactId: number;
  funnelId: number | null;
  stageId: number | null;
  summary: string;
  title?: string;
  value?: number | string;
  source?: string;
  now?: Date;
}): Promise<Outcome> => {
  const { companyId, contactId, funnelId, stageId } = params;
  const now = params.now || new Date();
  if (!params.summary || !params.summary.trim()) return { ok: false, message: "Informe o resumo da qualificação." };
  const problem = await unavailable(companyId, funnelId, stageId);
  if (problem) return { ok: false, message: problem };

  let fields: Record<string, unknown>;
  try {
    fields = sanitizeDealInput({ title: params.title || undefined, value: params.value, source: params.source || undefined });
  } catch (err) {
    const code = (err as AppError).message;
    return { ok: false, message: ERROR_TEXT[code] || "Dados inválidos para o negócio." };
  }
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);

  const existing = await openDealOf(companyId, funnelId as number, contactId);
  if (existing) {
    const patch = { ...fields, notes: appendSummary(existing.notes, params.summary, now) };
    await Deal.sequelize!.transaction(async transaction => {
      await existing.update(patch, { transaction });
      await DealEvent.create(
        { companyId, dealId: existing.id, userId: null, type: "edited", toValue: Object.keys(patch).join(",") } as any,
        { transaction }
      );
    });
    emitDeal(companyId, "update", await loadCard(companyId, existing.id));
    return { ok: true, created: false, dealId: existing.id, message: "Negócio do contato atualizado no CRM." };
  }

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) return { ok: false, message: "Contato não encontrado." };
  const id = await Deal.sequelize!.transaction(async transaction => {
    const deal = await Deal.create(
      {
        companyId,
        funnelId,
        stageId,
        contactId,
        userId: null,
        title: (fields.title as string) || contact.name,
        value: fields.value ?? 0,
        source: fields.source ?? null,
        notes: appendSummary(null, params.summary, now),
        status: "open",
        position: await topPosition(companyId, stageId as number, transaction),
        stageEnteredAt: now
      } as any,
      { transaction }
    );
    await DealEvent.create(
      { companyId, dealId: deal.id, userId: null, type: "created", toValue: String(stageId) } as any,
      { transaction }
    );
    return deal.id;
  });
  emitDeal(companyId, "create", await loadCard(companyId, id));
  return { ok: true, created: true, dealId: id, message: "Negócio criado no CRM para este contato." };
};

export const qualifyContactDeal = async (params: {
  companyId: number;
  contactId: number;
  funnelId: number | null;
  stageId: number | null;
  now?: Date;
}): Promise<Outcome> => {
  const { companyId, contactId, funnelId, stageId } = params;
  const now = params.now || new Date();
  const problem = await unavailable(companyId, funnelId, stageId);
  if (problem) return { ok: false, message: problem };
  const deal = await openDealOf(companyId, funnelId as number, contactId);
  if (!deal) return { ok: false, message: "Registre o negócio antes de marcar o lead como qualificado." };
  if (deal.stageId === stageId) return { ok: true, message: "O negócio já está na coluna de qualificado." };

  const from = deal.stageId;
  await Deal.sequelize!.transaction(async transaction => {
    await deal.update(
      { stageId, status: "open", stageEnteredAt: now, position: await topPosition(companyId, stageId as number, transaction) },
      { transaction }
    );
    await DealEvent.create(
      { companyId, dealId: deal.id, userId: null, type: "stage_changed", fromValue: String(from), toValue: String(stageId) } as any,
      { transaction }
    );
  });
  emitDeal(companyId, "update", await loadCard(companyId, deal.id));
  return { ok: true, dealId: deal.id, message: "Lead marcado como qualificado no CRM." };
};
