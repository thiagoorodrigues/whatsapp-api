// Splits an agent reply into WhatsApp-sized messages: one per paragraph
// (blank line), and a long single-line paragraph is cut at sentence ends.
// Lists and line breaks inside a paragraph stay in the same message.

export const MAX_PARTS = 6;
const LONG_PARAGRAPH = 400;
const TARGET_SIZE = 250;

const bySentence = (paragraph: string): string[] => {
  if (paragraph.length <= LONG_PARAGRAPH || paragraph.includes("\n")) return [paragraph];
  const sentences = paragraph.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)\s*/g) || [paragraph];
  const parts: string[] = [];
  let current = "";
  sentences.forEach(sentence => {
    if (current && (current + sentence).trim().length > TARGET_SIZE) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  });
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export const splitReply = (text: string, maxParts = MAX_PARTS): string[] => {
  const parts = (text || "")
    .split(/\n[ \t]*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .flatMap(bySentence);
  if (parts.length <= maxParts) return parts;
  // Too many pieces read like spam: the rest goes in the last message.
  return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join("\n\n")];
};

export const MAX_DELAY = 60;
export const MAX_WAIT = 60;
export const DEFAULT_WAIT = 3;

// Seconds of silence to wait before answering: 1 to 60.
export const waitToolConfig = (wait?: { enabled?: boolean; seconds?: unknown }) => {
  const seconds = Math.round(Number(wait?.seconds));
  return {
    enabled: !!wait?.enabled,
    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_WAIT) : DEFAULT_WAIT
  };
};

// Saved settings: the pause is whole seconds, 1 to 60, or null (automatic).
export const splitToolConfig = (split?: { enabled?: boolean; delay?: unknown }) => {
  const delay = split?.delay === null || split?.delay === "" ? NaN : Number(split?.delay);
  return {
    enabled: !!split?.enabled,
    delay: Number.isFinite(delay) && delay > 0 ? Math.min(Math.round(delay), MAX_DELAY) || 1 : null
  };
};

// Pause with "typing..." before a message, as if someone were writing it:
// the configured seconds, or by the size of the text (1 to 4 s).
export const typingDelay = (text: string, delay?: number | null): number =>
  delay ? delay * 1000 : Math.min(Math.max(text.length * 30, 1000), 4000);
