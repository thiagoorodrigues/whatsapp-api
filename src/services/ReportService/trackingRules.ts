/**
 * Rules shared by the dashboard, the reports and the ticket lifecycle.
 *
 * A TicketTraking row is one attendance: a contact's ticket entering the
 * queue (queuedAt), being picked up by an attendant (startedAt, userId) and
 * being closed (finishedAt). The Tickets row is reused for every attendance
 * of the same contact, so reports must read TicketTraking, never
 * Tickets.userId / Tickets.status.
 */

// When the attendance entered the system. queuedAt was historically only
// set for tickets that went through a queue, so fall back to startedAt and
// to the row creation time.
export const ENTRY_DATE_SQL = 'coalesce(tt."queuedAt", tt."startedAt", tt."createdAt")';

export const TRACKING_STATUS_SQL = {
  closed: 'tt."finishedAt" is not null',
  open: 'tt."finishedAt" is null and tt."startedAt" is not null',
  pending: 'tt."finishedAt" is null and tt."startedAt" is null'
};

// Minutes between two timestamps, including days/months (unlike date_part
// on age(), which dropped whole months).
export const minutesBetweenSql = (to: string, from: string): string =>
  `(extract(epoch from (${to} - ${from})) / 60)`;

export type TrackingStatus = "open" | "pending" | "closed";

export const trackingStatus = (tracking: {
  startedAt?: Date | null;
  finishedAt?: Date | null;
}): TrackingStatus => {
  if (tracking.finishedAt) return "closed";
  if (tracking.startedAt) return "open";
  return "pending";
};

/**
 * Who gets credit for an attendance being closed: the ticket's current
 * attendant; else whoever already held it (ticket returned to the queue);
 * else whoever closed it (closed straight from the queue).
 */
export const closingUserId = ({
  ticketUserId,
  trackingUserId,
  closerUserId
}: {
  ticketUserId?: number | null;
  trackingUserId?: number | null;
  closerUserId?: number | string | null;
}): number | null => {
  const candidate = ticketUserId || trackingUserId || closerUserId;
  const id = Number(candidate);
  return candidate && Number.isFinite(id) ? id : null;
};

export interface DashboardFilterParams {
  days?: number | string;
  date_from?: string;
  date_to?: string;
  userId?: number | string;
}

/** WHERE clause (over TicketTraking tt) and bound values for the dashboard. */
export const buildDashboardFilter = (
  companyId: number | string,
  params: DashboardFilterParams
): { where: string; replacements: any[] } => {
  let where = 'where tt."companyId" = ?';
  const replacements: any[] = [companyId];

  if (params.days !== undefined && params.days !== null && params.days !== "") {
    const days = parseInt(`${params.days}`.replace(/\D/g, ""), 10);
    if (Number.isFinite(days)) {
      where += ` and ${ENTRY_DATE_SQL} >= (now() - ?::interval)`;
      replacements.push(`${days} days`);
    }
  }

  if (params.date_from) {
    where += ` and ${ENTRY_DATE_SQL} >= ?`;
    replacements.push(`${params.date_from} 00:00:00`);
  }

  if (params.date_to) {
    where += ` and ${ENTRY_DATE_SQL} <= ?`;
    replacements.push(`${params.date_to} 23:59:59`);
  }

  if (params.userId !== undefined && params.userId !== null) {
    const userId = parseInt(`${params.userId}`, 10);
    if (Number.isFinite(userId)) {
      where += ' and tt."userId" = ?';
      replacements.push(userId);
    }
  }

  return { where, replacements };
};

/**
 * One ticket-report row per attendance, in the shape the report page
 * already renders (id = ticket id so "open ticket" keeps working; rowKey is
 * unique per attendance).
 */
export const toTicketReportRow = (tracking: any) => {
  const ticket = tracking.ticket || {};
  return {
    id: ticket.id,
    uuid: ticket.uuid,
    rowKey: tracking.id,
    status: trackingStatus(tracking),
    user: tracking.user || null,
    whatsapp: tracking.whatsapp || ticket.whatsapp || null,
    contact: ticket.contact || null,
    queue: ticket.queue || null,
    tags: ticket.tags || [],
    createdAt: tracking.queuedAt || tracking.startedAt || tracking.createdAt,
    updatedAt: tracking.finishedAt || null
  };
};
