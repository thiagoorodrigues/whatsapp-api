// Socket.IO rooms are always scoped by company: a socket only joins rooms of
// the company in its JWT, and every emit must target one of these rooms.
// Never use io.emit (it reaches every connected client of every company).
type Id = number | string;

export const companyRoom = (companyId: Id): string => `company-${companyId}`;

export const statusRoom = (companyId: Id, status: string): string =>
  `company-${companyId}-status-${status}`;

export const notificationRoom = (companyId: Id): string =>
  `company-${companyId}-notification`;

export const ticketRoom = (companyId: Id, ticketId: Id): string =>
  `company-${companyId}-ticket-${ticketId}`;

// Room names stay inside the company prefix anyway; this only keeps junk out.
export const isTicketStatus = (status: unknown): status is string =>
  typeof status === "string" && /^[a-z]{1,20}$/.test(status);
