import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";
import { cancelForTicket, FollowUpTicket, markReplied, startOrRestart } from "./EnrollmentService";

// Follow-up never gets in the way of a message or a ticket update.
const safely = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Follow-up ${what} failed: ${err}`);
  }
};

// Our attendant, the AI agent or the phone wrote: wait for the customer.
export const followUpOnAgentMessage = (ticket: FollowUpTicket): Promise<void> =>
  safely("start", () => startOrRestart(ticket));

export const followUpOnCustomerMessage = (ticket: { id: number; companyId: number }): Promise<void> =>
  safely("reply", () => markReplied(ticket));

// Queue or connection changed: the next message of the attendant starts the new queue's rule.
export const followUpOnTicketChanged = (
  ticket: { id: number; companyId: number },
  change: { closed: boolean; queueChanged: boolean }
): Promise<void> =>
  safely("ticket change", async () => {
    if (change.closed) await cancelForTicket(ticket.id, ticket.companyId, "ticket_closed");
    else if (change.queueChanged) await cancelForTicket(ticket.id, ticket.companyId, "queue_changed");
  });
