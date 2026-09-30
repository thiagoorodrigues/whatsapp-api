import { Op, fn, col, where as sqlWhere, WhereOptions } from "sequelize";
import { subDays } from "date-fns";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Deal from "../../models/Deal";
import DealEvent from "../../models/DealEvent";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Ticket from "../../models/Ticket";
import FunnelStage from "../../models/FunnelStage";
import Funnel from "../../models/Funnel";
import { DEAL_SOURCES } from "./defaults";
import { findVisibleFunnel, findVisibleStage, FunnelView } from "./FunnelService";
import { findActiveLossReason } from "./LossReasonService";
import { needsRenumber, positionBetween, renumber } from "./position";
import { stageChange } from "./transition";
import { canSeeDeal, ownerScope, Viewer } from "./visibility";

export const PAGE_SIZE = 50;
export const CLOSED_WINDOW_DAYS = 30;

export interface DealInput {
  title?: string;
  value?: number | string;
  userId?: number | null;
  expectedCloseDate?: string | null;
  source?: string | null;
  notes?: string | null;
}

export interface DealCard {
  id: number;
  title: string;
  value: number;
  userId: number | null;
  user: { id: number; name: string } | null;
  contact: { id: number; name: string; number: string; profilePicUrl: string };
  funnelId: number;
  stageId: number;
  position: number;
  status: string;
  stageEnteredAt: Date;
  unread: number;
}

const notFound = () => new AppError("ERR_CRM_NOT_FOUND", 404);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const blank = (s: unknown) => s === null || s === undefined || String(s).trim() === "";

// Whitelists and normalises editable deal fields.
export const sanitizeDealInput = (data: DealInput): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (data.title !== undefined) {
    if (blank(data.title)) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    out.title = String(data.title).trim();
  }
  if (data.value !== undefined) {
    const n = typeof data.value === "number" ? data.value : parseFloat(String(data.value).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new AppError("ERR_CRM_INVALID_VALUE", 400);
    out.value = Math.round(n * 100) / 100;
  }
  if (data.source !== undefined) {
    if (blank(data.source)) out.source = null;
    else if (!DEAL_SOURCES.includes(String(data.source))) throw new AppError("ERR_CRM_INVALID_SOURCE", 400);
    else out.source = data.source;
  }
  if (data.notes !== undefined) out.notes = blank(data.notes) ? null : String(data.notes).trim();
  if (data.expectedCloseDate !== undefined) {
    if (blank(data.expectedCloseDate)) out.expectedCloseDate = null;
    else if (!DATE_RE.test(String(data.expectedCloseDate))) throw new AppError("ERR_CRM_INVALID_DATE", 400);
    else out.expectedCloseDate = data.expectedCloseDate;
  }
  if (data.userId !== undefined) out.userId = data.userId === null ? null : Number(data.userId);
  return out;
};

const cardInclude = [
  { model: Contact, as: "contact", attributes: ["id", "name", "number", "profilePicUrl"] },
  { model: User, as: "user", attributes: ["id", "name"] }
];

const unreadByContact = async (companyId: number, contactIds: number[]): Promise<Map<number, number>> => {
  if (!contactIds.length) return new Map();
  const rows: any[] = await Ticket.findAll({
    where: { companyId, contactId: { [Op.in]: contactIds } },
    attributes: ["contactId", [fn("SUM", col("unreadMessages")), "unread"]],
    group: ["contactId"],
    raw: true
  });
  return new Map(rows.map(r => [Number(r.contactId), Number(r.unread) || 0]));
};

const toCard = (d: Deal, unread: Map<number, number>): DealCard => ({
  id: d.id,
  title: d.title,
  value: Number(d.value),
  userId: d.userId,
  user: d.user ? { id: d.user.id, name: d.user.name } : null,
  contact: {
    id: d.contact.id,
    name: d.contact.name,
    number: d.contact.number,
    profilePicUrl: d.contact.profilePicUrl
  },
  funnelId: d.funnelId,
  stageId: d.stageId,
  position: d.position,
  status: d.status,
  stageEnteredAt: d.stageEnteredAt,
  unread: unread.get(d.contactId) || 0
});

const loadCard = async (companyId: number, id: number): Promise<DealCard> => {
  const deal = await Deal.findOne({ where: { id, companyId }, include: cardInclude });
  if (!deal) throw notFound();
  return toCard(deal, await unreadByContact(companyId, [deal.contactId]));
};

// Sockets reach every client, so events carry ids only; the board refetches
// through the scoped REST routes.
export const dealEventPayload = (action: "create" | "update" | "delete", deal: DealCard) => ({
  action,
  dealId: deal.id,
  funnelId: deal.funnelId,
  stageId: deal.stageId
});

const emitDeal = (companyId: number, action: "create" | "update" | "delete", deal: DealCard) => {
  getIO().emit(`company-${companyId}-deal`, dealEventPayload(action, deal));
};

const ownerWhere = (v: Viewer, funnel: FunnelView): WhereOptions | undefined => {
  const scope = ownerScope(v, funnel);
  if (scope === null) return undefined;
  return { [Op.or]: [{ userId: v.id }, { userId: null }] };
};

const assertUserInCompany = async (companyId: number, userId: unknown) => {
  if (userId === null || userId === undefined) return;
  const user = await User.findOne({ where: { id: userId as number, companyId }, attributes: ["id"] });
  if (!user) throw notFound();
};

const findVisibleDeal = async (v: Viewer, id: number): Promise<{ deal: Deal; funnel: FunnelView }> => {
  const deal = await Deal.findOne({ where: { id, companyId: v.companyId } });
  if (!deal) throw notFound();
  const funnel = await findVisibleFunnel(v, deal.funnelId);
  if (!canSeeDeal(v, funnel, deal)) throw notFound();
  return { deal, funnel };
};

export const listDeals = async (
  v: Viewer,
  funnelId: number,
  q: { stageId?: number; page?: number; search?: string; userId?: number; source?: string; allClosed?: boolean }
) => {
  const funnel = await findVisibleFunnel(v, funnelId);
  const stages = q.stageId ? funnel.stages.filter(s => s.id === q.stageId) : funnel.stages;
  if (q.stageId && !stages.length) throw notFound();
  const page = Math.max(1, Number(q.page) || 1);

  const base: any[] = [{ companyId: v.companyId, funnelId }];
  const owner = ownerWhere(v, funnel);
  if (owner) base.push(owner);
  if (q.userId) base.push({ userId: q.userId });
  if (q.source) base.push({ source: q.source });
  if (q.search && q.search.trim()) {
    const term = `%${q.search.trim().toLowerCase()}%`;
    base.push({
      [Op.or]: [
        sqlWhere(fn("LOWER", col("Deal.title")), "LIKE", term),
        sqlWhere(fn("LOWER", col("contact.name")), "LIKE", term),
        { "$contact.number$": { [Op.like]: `%${q.search.trim()}%` } }
      ]
    });
  }
  const since = subDays(new Date(), CLOSED_WINDOW_DAYS);

  const result = [];
  for (const stage of stages) {
    const conds = [...base, { stageId: stage.id }];
    if (stage.kind !== "open" && !q.allClosed) conds.push({ closedAt: { [Op.gte]: since } });
    const whereStage = { [Op.and]: conds };
    const [{ count, rows }, total] = await Promise.all([
      Deal.findAndCountAll({
        where: whereStage,
        include: cardInclude,
        order: [["position", "ASC"], ["id", "ASC"]],
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        distinct: true,
        subQuery: false
      }),
      Deal.sum("value", { where: whereStage, include: [{ model: Contact, as: "contact", attributes: [] }] } as any)
    ]);
    const unread = await unreadByContact(v.companyId, rows.map(r => r.contactId));
    result.push({
      stageId: stage.id,
      count,
      total: Number(total) || 0,
      deals: rows.map(r => toCard(r, unread)),
      hasMore: count > page * PAGE_SIZE
    });
  }
  return { stages: result };
};

const topPosition = async (companyId: number, stageId: number, transaction: any): Promise<number> => {
  const first = await Deal.findOne({
    where: { companyId, stageId },
    order: [["position", "ASC"]],
    attributes: ["position"],
    transaction
  });
  return positionBetween(null, first ? first.position : null);
};

export const createDeal = async (
  v: Viewer,
  data: DealInput & { funnelId: number; contactId: number; stageId?: number }
): Promise<DealCard> => {
  const funnel = await findVisibleFunnel(v, Number(data.funnelId));
  if (funnel.archived) throw notFound();
  const stage = data.stageId
    ? funnel.stages.find(s => s.id === Number(data.stageId))
    : funnel.stages.find(s => s.kind === "open");
  if (!stage) throw notFound();
  if (stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  const contact = await Contact.findOne({ where: { id: data.contactId, companyId: v.companyId } });
  if (!contact) throw notFound();

  const fields = sanitizeDealInput(data);
  if (fields.userId === undefined) fields.userId = v.id;
  // Sellers limited to their own deals cannot hand new deals to others.
  if (ownerScope(v, funnel) !== null && fields.userId !== v.id && fields.userId !== null) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  await assertUserInCompany(v.companyId, fields.userId);

  const now = new Date();
  const id = await Deal.sequelize!.transaction(async transaction => {
    const deal = await Deal.create(
      {
        companyId: v.companyId,
        funnelId: funnel.id,
        stageId: stage.id,
        contactId: contact.id,
        title: (fields.title as string) || contact.name,
        value: fields.value ?? 0,
        userId: fields.userId,
        expectedCloseDate: fields.expectedCloseDate ?? null,
        source: fields.source ?? null,
        notes: fields.notes ?? null,
        status: "open",
        position: await topPosition(v.companyId, stage.id, transaction),
        stageEnteredAt: now
      } as any,
      { transaction }
    );
    await DealEvent.create(
      { companyId: v.companyId, dealId: deal.id, userId: v.id, type: "created", toValue: String(stage.id) } as any,
      { transaction }
    );
    return deal.id;
  });
  const card = await loadCard(v.companyId, id);
  emitDeal(v.companyId, "create", card);
  return card;
};

export const showDeal = async (v: Viewer, id: number) => {
  const { deal } = await findVisibleDeal(v, id);
  const [full, events, ticket] = await Promise.all([
    Deal.findOne({
      where: { id: deal.id, companyId: v.companyId },
      include: [...cardInclude, { model: FunnelStage, as: "stage" }, { model: Funnel, as: "funnel", attributes: ["id", "name"] }]
    }),
    DealEvent.findAll({
      where: { dealId: deal.id, companyId: v.companyId },
      include: [{ model: User, as: "user", attributes: ["id", "name"] }],
      order: [["createdAt", "DESC"]],
      limit: 100
    }),
    Ticket.findOne({
      where: { contactId: deal.contactId, companyId: v.companyId },
      attributes: ["id", "uuid", "status"],
      order: [["updatedAt", "DESC"]]
    })
  ]);
  return { deal: full, events, ticket: ticket ? { id: ticket.id, uuid: ticket.uuid, status: ticket.status } : null };
};

export const updateDeal = async (v: Viewer, id: number, data: DealInput): Promise<DealCard> => {
  const { deal, funnel } = await findVisibleDeal(v, id);
  const fields = sanitizeDealInput(data);
  if (fields.userId !== undefined) {
    if (ownerScope(v, funnel) !== null && fields.userId !== v.id && fields.userId !== null) {
      throw new AppError("ERR_NO_PERMISSION", 403);
    }
    await assertUserInCompany(v.companyId, fields.userId);
  }
  const changed = Object.keys(fields).filter(k => {
    const before = (deal as any)[k];
    const after = fields[k];
    return k === "value" ? Number(before) !== after : (before ?? null) !== after;
  });
  if (!changed.length) return loadCard(v.companyId, deal.id);

  await Deal.sequelize!.transaction(async transaction => {
    const events: any[] = [];
    if (changed.includes("userId")) {
      events.push({ type: "owner_changed", fromValue: deal.userId === null ? null : String(deal.userId), toValue: fields.userId === null ? null : String(fields.userId) });
    }
    const others = changed.filter(k => k !== "userId");
    if (others.length) events.push({ type: "edited", fromValue: null, toValue: others.join(",") });
    await deal.update(Object.fromEntries(changed.map(k => [k, fields[k]])), { transaction });
    await DealEvent.bulkCreate(
      events.map(e => ({ ...e, companyId: v.companyId, dealId: deal.id, userId: v.id })) as any,
      { transaction }
    );
  });
  const card = await loadCard(v.companyId, deal.id);
  emitDeal(v.companyId, "update", card);
  return card;
};

// Reads inside the move's transaction so it sees a renumbering done there.
const neighbourPosition = async (
  companyId: number,
  stageId: number,
  dealId: number | null | undefined,
  transaction: any
) => {
  if (!dealId) return null;
  const n = await Deal.findOne({ where: { id: dealId, companyId, stageId }, attributes: ["position"], transaction });
  if (!n) throw notFound();
  return n.position;
};

export const moveDeal = async (
  v: Viewer,
  id: number,
  data: { stageId: number; beforeId?: number | null; afterId?: number | null; lossReasonId?: number | null; lossNote?: string | null }
): Promise<DealCard> => {
  const { deal } = await findVisibleDeal(v, id);
  const { stage, funnel: target } = await findVisibleStage(v, Number(data.stageId));
  if (!canSeeDeal(v, target, deal)) throw notFound();
  // Reordering inside Perdido keeps the reason it already has.
  if (stage.kind === "lost" && stage.id !== deal.stageId) {
    if (!data.lossReasonId || !(await findActiveLossReason(v.companyId, Number(data.lossReasonId)))) {
      throw new AppError("ERR_CRM_LOSS_REASON_REQUIRED", 400);
    }
  }
  const { patch, events } = stageChange(
    deal,
    { id: stage.id, kind: stage.kind },
    { lossReasonId: data.lossReasonId ? Number(data.lossReasonId) : null, lossNote: data.lossNote ?? null },
    new Date()
  );
  if (target.id !== deal.funnelId) patch.funnelId = target.id;

  await Deal.sequelize!.transaction(async transaction => {
    let before = await neighbourPosition(v.companyId, stage.id, data.beforeId, transaction);
    let after = await neighbourPosition(v.companyId, stage.id, data.afterId, transaction);
    if (needsRenumber(before, after)) {
      const ordered = await Deal.findAll({
        where: { companyId: v.companyId, stageId: stage.id, id: { [Op.ne]: deal.id } },
        order: [["position", "ASC"], ["id", "ASC"]],
        attributes: ["id"],
        transaction
      });
      for (const p of renumber(ordered)) {
        await Deal.update({ position: p.position }, { where: { id: p.id, companyId: v.companyId }, transaction });
      }
      before = await neighbourPosition(v.companyId, stage.id, data.beforeId, transaction);
      after = await neighbourPosition(v.companyId, stage.id, data.afterId, transaction);
    }
    await deal.update({ ...patch, position: positionBetween(before, after) }, { transaction });
    if (events.length) {
      await DealEvent.bulkCreate(
        events.map(e => ({ ...e, companyId: v.companyId, dealId: deal.id, userId: v.id })) as any,
        { transaction }
      );
    }
  });
  const card = await loadCard(v.companyId, deal.id);
  emitDeal(v.companyId, "update", card);
  return card;
};

export const listContactDeals = async (v: Viewer, contactId: number) => {
  const deals = await Deal.findAll({
    where: { companyId: v.companyId, contactId, status: "open" },
    include: [
      { model: FunnelStage, as: "stage", attributes: ["id", "name", "color"] },
      { model: Funnel, as: "funnel", attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]]
  });
  const visible = [];
  for (const d of deals) {
    try {
      const funnel = await findVisibleFunnel(v, d.funnelId);
      if (!funnel.archived && canSeeDeal(v, funnel, d)) visible.push(d);
    } catch (e) {
      // funnel hidden from this user
    }
  }
  return visible.map(d => ({
    id: d.id,
    title: d.title,
    value: Number(d.value),
    funnelId: d.funnelId,
    funnelName: d.funnel.name,
    stageId: d.stageId,
    stageName: d.stage.name,
    stageColor: d.stage.color
  }));
};
