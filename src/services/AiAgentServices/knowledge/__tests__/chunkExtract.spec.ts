import { chunkText } from "../chunk";
import { extractText, normalizeText } from "../extract";

describe("chunkText", () => {
  it("keeps short documents in one chunk", () => {
    expect(chunkText("Horário: seg a sex, 9h às 18h.")).toEqual(["Horário: seg a sex, 9h às 18h."]);
  });

  it("splits long text at paragraphs with overlap and no oversized chunks", () => {
    const paragraph = (n: number) => `Parágrafo ${n}. ${"Texto de exemplo sobre entregas e prazos. ".repeat(12)}`;
    const text = Array.from({ length: 8 }, (_, i) => paragraph(i + 1)).join("\n\n");
    const chunks = chunkText(text, 1200, 200);
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(1200 + 200 + 2));
    // the start of each chunk repeats the end of the previous one
    expect(chunks[0].endsWith(chunks[1].split("\n\n")[0])).toBe(true);
    expect(chunks.join(" ")).toContain("Parágrafo 8.");
  });

  it("cuts text without paragraphs or sentences", () => {
    const chunks = chunkText("x".repeat(3000), 1000, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(1102));
  });
});

describe("extractText", () => {
  it("reads plain text files and cleans whitespace", async () => {
    const text = await extractText(Buffer.from("Preços\r\n\r\n\r\n\r\nEntrega:\t R$ 15  "), "precos.txt");
    expect(text).toBe("Preços\n\nEntrega: R$ 15");
  });

  it("drops the page markers pdf-parse adds", () => {
    expect(normalizeText("Página um\n\n-- 1 of 2 --\n\nPágina dois\n-- 2 of 2 --")).toBe("Página um\n\nPágina dois");
  });

  it("refuses unsupported and empty files", async () => {
    await expect(extractText(Buffer.from("x"), "planilha.xlsx")).rejects.toThrow("ERR_AI_KNOWLEDGE_FILE_TYPE");
    await expect(extractText(Buffer.from("   \n "), "vazio.txt")).rejects.toThrow("ERR_AI_KNOWLEDGE_EMPTY");
  });
});
