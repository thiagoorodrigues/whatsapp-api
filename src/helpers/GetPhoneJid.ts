/**
 * WhatsApp started delivering senders as LIDs (`123@lid`) instead of phone
 * JIDs (`5531...@s.whatsapp.net`). Baileys 6.7.x keeps the phone JID on the
 * message key as `senderPn` / `participantPn` (or the `*Alt` variants).
 * Contacts and tickets are keyed by phone number, so every lookup must go
 * through here or the same person ends up as two contacts.
 *
 * Deliberately free of Baileys imports: Baileys 6.7.x ships as ESM, which the
 * project's Jest 27 cannot load, and the LID check is only a suffix test.
 */
export const isLidJid = (jid?: string | null): boolean =>
  !!jid && jid.endsWith("@lid");

export interface PhoneAwareKey {
  remoteJid?: string | null;
  participant?: string | null;
  senderPn?: string | null;
  participantPn?: string | null;
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
}

export const getRemotePhoneJid = (key: PhoneAwareKey): string | undefined => {
  const jid = key.remoteJid || undefined;
  if (isLidJid(jid)) {
    return key.senderPn || key.remoteJidAlt || jid;
  }
  return jid;
};

export const getParticipantPhoneJid = (
  key: PhoneAwareKey
): string | undefined => {
  const jid = key.participant || undefined;
  if (isLidJid(jid)) {
    return key.participantPn || key.participantAlt || jid;
  }
  return jid;
};

/**
 * Outgoing messages sent from another linked device reach us with only the
 * LID and no phone alias. `lookupLid` maps a LID we have seen before (stored
 * on the contact, or on an earlier incoming message) back to its phone JID.
 */
export const resolvePhoneJid = async (
  key: PhoneAwareKey,
  lookupLid: (lid: string) => Promise<string | undefined>
): Promise<string | undefined> => {
  const direct = getRemotePhoneJid(key);
  if (!isLidJid(direct)) return direct;

  const mapped = await lookupLid(direct as string);
  return mapped || direct;
};

/**
 * Address to SEND to. Once a contact writes to us through their LID, their
 * side of the chat is LID-addressed and only decrypts messages encrypted
 * for the LID session; sending to the phone JID shows up for them as
 * "Aguardando mensagem" forever. So: group -> @g.us, known LID -> the LID,
 * otherwise the phone JID.
 */
export const getContactJid = (
  contact: { number: string; lid?: string | null },
  isGroup = false
): string => {
  const number = `${contact.number}`;
  if (isGroup) return number.includes("@") ? number : `${number}@g.us`;
  if (isLidJid(contact.lid)) return contact.lid as string;
  return `${number.replace(/\D/g, "")}@s.whatsapp.net`;
};

const userPart = (jid: string): string => jid.split("@")[0].split(":")[0];

/** "123:12@lid" | "123@lid" | "123" -> "123@lid" (device part dropped). */
export const toUserLid = (lid?: string | null): string | undefined => {
  if (!lid) return undefined;
  const user = userPart(lid);
  return user ? `${user}@lid` : undefined;
};

/** "5531...:3@s.whatsapp.net" | "5531..." -> "5531..." (digits only). */
export const toPhoneNumber = (pn?: string | null): string | undefined => {
  if (!pn) return undefined;
  const digits = userPart(pn).replace(/\D/g, "");
  return digits || undefined;
};
