/**
 * WhatsApp mentions ("@name" in a group). The text only carries "@<digits>"
 * (phone or LID); who was mentioned comes in contextInfo.mentionedJid of
 * the message content, which may be wrapped (ephemeral, view once, document
 * with caption, edits). Free of Baileys imports so business services and
 * Jest can use it on Message.dataJson.
 */
const MAX_DEPTH = 6;

const collect = (node: unknown, depth: number, out: string[]): void => {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
  const obj = node as Record<string, unknown>;
  const context = obj.contextInfo as { mentionedJid?: unknown } | undefined;
  if (context && Array.isArray(context.mentionedJid)) {
    context.mentionedJid.forEach(jid => {
      if (typeof jid === "string" && jid && !out.includes(jid)) out.push(jid);
    });
  }
  Object.keys(obj).forEach(key => {
    if (key !== "contextInfo") collect(obj[key], depth + 1, out);
  });
};

export const getMentionedJids = (message: unknown): string[] => {
  const out: string[] = [];
  collect(message, 0, out);
  return out;
};

/** "5511...:3@s.whatsapp.net" -> "5511..."; "1407...@lid" -> "1407...". */
export const mentionToken = (jid: string): string =>
  jid.split("@")[0].split(":")[0].replace(/\D/g, "");

export interface MentionName {
  token: string;
  name: string | null;
  phone: string | null;
}

// Same display as the app's formatPhone: "+55 (DD) XXXXX-XXXX" for
// Brazilian numbers, "+digits" otherwise.
const formatPhone = (digits: string): string => {
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const local = digits.slice(4);
    const split = local.length - 4;
    return `+55 (${digits.slice(2, 4)}) ${local.slice(0, split)}-${local.slice(split)}`;
  }
  return `+${digits}`;
};

/**
 * Plain-text version of a message with mentions ("@Maria" instead of
 * "@1407..."), for places that show text without markup: the ticket list
 * preview (Ticket.lastMessage).
 */
export const mentionsToText = (text: string, mentions?: MentionName[]): string => {
  if (!text || !mentions || mentions.length === 0) return text;
  return mentions.reduce((acc, mention) => {
    if (!mention.token) return acc;
    const label = mention.name || (mention.phone ? formatPhone(mention.phone) : mention.token);
    return acc.replace(new RegExp(`@${mention.token}(?!\\d)`, "g"), () => `@${label}`);
  }, text);
};

/**
 * New ticket list preview for a saved message, or null to keep it: only
 * when the preview is this message's own text and some mention is known.
 */
export const previewWithMentions = (
  lastMessage: string | null | undefined,
  body: string,
  mentions?: MentionName[]
): string | null => {
  if (!body || lastMessage !== body) return null;
  if (!mentions?.some(m => m.token && (m.name || m.phone))) return null;
  return mentionsToText(body, mentions);
};
