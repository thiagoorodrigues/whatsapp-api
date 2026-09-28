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
