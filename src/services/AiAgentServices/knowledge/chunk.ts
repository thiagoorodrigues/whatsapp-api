// Splits a document into overlapping pieces of about `size` characters,
// breaking at paragraphs, then sentences, then words.

const sentences = (text: string): string[] => text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];

const pieces = (paragraph: string, size: number): string[] => {
  if (paragraph.length <= size) return [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences(paragraph)) {
    if (sentence.length > size) {
      // A "sentence" longer than a chunk (tables, lists without dots).
      if (current) out.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += size) out.push(sentence.slice(i, i + size));
      continue;
    }
    if (current && current.length + sentence.length + 1 > size) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out;
};

export const chunkText = (text: string, size = 1200, overlap = 200): string[] => {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const units = paragraphs.flatMap(p => pieces(p, size));

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > size) {
      chunks.push(current);
      // Repeat the end of the previous chunk so an answer split across two
      // chunks is still found whole in one of them.
      const tail = current.slice(-overlap);
      const cut = tail.indexOf(" ");
      current = `${cut >= 0 ? tail.slice(cut + 1) : tail}\n\n${unit}`;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};
