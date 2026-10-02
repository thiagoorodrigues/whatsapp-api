import crypto from "crypto";

// WhatsApp Web echoes every message the account sends (messages.upsert,
// fromMe). Messages sent through the channel are saved by whoever sent them,
// so their echo must not go through the inbound pipeline again; messages
// typed on the phone still do. Kept per connection: the same number paired on
// another connection (or by another company) gets the echo too and must save
// it.

const TTL_MS = 10 * 60 * 1000;
const sent = new Map<string, number>();

const sweep = (now: number) => {
  sent.forEach((expiresAt, id) => {
    if (expiresAt <= now) sent.delete(id);
  });
};

/** Same format as Baileys' own ids (3EB0 + 18 hex digits). */
export const newMessageId = (): string => `3EB0${crypto.randomBytes(9).toString("hex").toUpperCase()}`;

export const markSentByPlatform = (connectionId: number, id: string): void => {
  const now = Date.now();
  if (sent.size > 5000) sweep(now);
  sent.set(`${connectionId}:${id}`, now + TTL_MS);
};

export const wasSentByPlatform = (connectionId: number, id?: string | null): boolean => {
  if (!id) return false;
  const expiresAt = sent.get(`${connectionId}:${id}`);
  return !!expiresAt && expiresAt > Date.now();
};
