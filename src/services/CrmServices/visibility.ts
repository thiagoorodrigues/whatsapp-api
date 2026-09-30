export interface Viewer {
  id: number;
  profile: string;
  companyId: number;
  queueIds: number[];
}

export const isAdmin = (v: Viewer): boolean => v.profile === "admin";

// Admins see every active funnel; other users only funnels sharing a queue.
export const canSeeFunnel = (v: Viewer, f: { archived: boolean; queueIds: number[] }): boolean => {
  if (f.archived) return false;
  if (isAdmin(v)) return true;
  return f.queueIds.some(id => v.queueIds.includes(id));
};

// Allowed deal owners inside a funnel, or null for no filter. 0 stands for
// "no owner" so callers can map it to IS NULL.
export const ownerScope = (v: Viewer, f: { ownDealsOnly: boolean }): number[] | null =>
  isAdmin(v) || !f.ownDealsOnly ? null : [v.id, 0];

export const canSeeDeal = (v: Viewer, f: { ownDealsOnly: boolean }, d: { userId: number | null }): boolean => {
  const scope = ownerScope(v, f);
  return scope === null || scope.includes(d.userId ?? 0);
};
