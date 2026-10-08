import axios from "axios";
import * as Sentry from "@sentry/node";
import QueueIntegrations from "../../models/QueueIntegrations";
import Ticket from "../../models/Ticket";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import { InboundMessage, normalizedForWebhook } from "../../channels/inbound";
import { decryptSecret, encryptSecret, secretHint } from "../../helpers/secretBox";
import { logger } from "../../utils/logger";

// N8N was the same thing under another name.
export const isWebhook = (integration?: Pick<QueueIntegrations, "type"> | null): boolean =>
  !!integration && (integration.type === "webhook" || integration.type === "n8n");

const BOOLEAN_OPTIONS = [
  "webhookActive",
  "webhookOnPending",
  "webhookOnOpen",
  "webhookSendTags",
  "webhookSendQueue",
  "webhookSendBotMessages"
] as const;

/**
 * Webhook options from the panel. webhookToken: absent keeps the saved one,
 * empty removes it, text replaces it (stored encrypted).
 */
export const webhookOptionsFrom = (body: Record<string, any>): Record<string, any> => {
  const options: Record<string, any> = {};
  BOOLEAN_OPTIONS.forEach(key => {
    if (typeof body?.[key] === "boolean") options[key] = body[key];
  });
  if (typeof body?.webhookToken === "string") {
    const token = body.webhookToken.trim();
    options.webhookToken = token ? encryptSecret(token) : null;
  }
  return options;
};

// The saved (encrypted) token: the default scope leaves it out.
const savedToken = async (id: number): Promise<string | null> => {
  const row = await QueueIntegrations.unscoped().findByPk(id, { attributes: ["webhookToken"] });
  return row?.webhookToken || null;
};

/** What the panel gets: no token, only whether there is one and its end. */
export const publicIntegration = async (integration: QueueIntegrations | null): Promise<any> => {
  if (!integration) return integration;
  const { webhookToken: ignored, ...rest } = integration.toJSON() as any;
  const token = await savedToken(integration.id);
  let webhookTokenHint = null;
  if (token) {
    try {
      webhookTokenHint = secretHint(decryptSecret(token));
    } catch (err) {
      webhookTokenHint = "…";
    }
  }
  return { ...rest, hasWebhookToken: !!token, webhookTokenHint };
};

/** Whether this message goes to the webhook, by its options. */
export const shouldDeliver = (
  integration: Pick<QueueIntegrations, "type" | "webhookActive" | "webhookOnPending" | "webhookOnOpen" | "webhookSendBotMessages">,
  ticket: Pick<Ticket, "status">,
  fromMe: boolean
): boolean => {
  if (!isWebhook(integration) || integration.webhookActive === false) return false;
  if (fromMe && !integration.webhookSendBotMessages) return false;
  if (ticket.status === "pending") return integration.webhookOnPending !== false;
  if (ticket.status === "open") return !!integration.webhookOnOpen;
  return false;
};

const TIMEOUT_MS = 10000;

/**
 * Posts the message to the webhook. Never throws: a slow or broken URL must
 * not stop the message from being processed.
 */
export const deliverWebhook = async (
  integration: QueueIntegrations,
  inbound: InboundMessage,
  ticket: Ticket
): Promise<void> => {
  if (!integration.urlN8N || !shouldDeliver(integration, ticket, inbound.fromMe)) return;
  try {
    // The channel's own payload, as before, plus the channel-neutral view.
    const payload: Record<string, any> = {
      ...(inbound.raw as object),
      normalized: normalizedForWebhook(inbound),
      ticket: { id: ticket.id, uuid: ticket.uuid, status: ticket.status, fromMe: inbound.fromMe }
    };
    if (integration.webhookSendQueue) {
      const queue = ticket.queueId ? await Queue.findByPk(ticket.queueId, { attributes: ["id", "name"] }) : null;
      payload.queue = queue ? { id: queue.id, name: queue.name } : null;
    }
    if (integration.webhookSendTags) {
      const withTags = await Ticket.findByPk(ticket.id, {
        attributes: ["id"],
        include: [{ model: Tag, as: "tags", attributes: ["id", "name"], through: { attributes: [] } }]
      });
      payload.tags = (withTags?.tags || []).map(tag => ({ id: tag.id, name: tag.name }));
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = await savedToken(integration.id);
    if (token) headers.Authorization = `Bearer ${decryptSecret(token)}`;

    await axios.post(integration.urlN8N, payload, { headers, timeout: TIMEOUT_MS });
  } catch (err: any) {
    Sentry.captureException(err);
    logger.warn(`Webhook ${integration.id} failed for ticket ${ticket.id}: ${err?.message}`);
  }
};
