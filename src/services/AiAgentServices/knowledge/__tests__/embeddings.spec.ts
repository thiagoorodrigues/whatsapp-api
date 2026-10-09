const embed = jest.fn();
jest.mock("../../providers", () => ({
  getProvider: (name: string) => (name === "anthropic" ? { name } : { name, embed: (...a: any[]) => embed(...a) })
}));

// eslint-disable-next-line import/first
import {
  defaultEmbeddingModel,
  embeddingAfterUpdate,
  embedTexts,
  isEmbeddingModelFor,
  minSimilarityFor,
  nextEmbeddingModel,
  toVectorLiteral
} from "../embeddings";

const vector = (value: number) => Array.from({ length: 1536 }, () => value);

describe("embedding models", () => {
  it("offers models per provider and none for Claude", () => {
    expect(defaultEmbeddingModel("openai")).toBe("text-embedding-3-small");
    expect(defaultEmbeddingModel("gemini")).toBe("gemini-embedding-001");
    expect(defaultEmbeddingModel("anthropic")).toBeNull();
    expect(isEmbeddingModelFor("openai", "text-embedding-3-large")).toBe(true);
    expect(isEmbeddingModelFor("gemini", "text-embedding-3-small")).toBe(false);
    expect(isEmbeddingModelFor("anthropic", "text-embedding-3-small")).toBe(false);
    expect(isEmbeddingModelFor("openai", null)).toBe(false);
  });

  it("keeps the model on provider change only when the new provider has it", () => {
    expect(nextEmbeddingModel(null, "openai")).toBeNull();
    expect(nextEmbeddingModel("text-embedding-3-large", "openai")).toBe("text-embedding-3-large");
    expect(nextEmbeddingModel("text-embedding-3-large", "gemini")).toBe("gemini-embedding-001");
    expect(nextEmbeddingModel("gemini-embedding-001", "anthropic")).toBeNull();
  });
});

describe("minSimilarityFor", () => {
  it("has a floor calibrated per OpenAI model and none otherwise", () => {
    expect(minSimilarityFor("text-embedding-3-small")).toBe(0.3);
    expect(minSimilarityFor("text-embedding-3-large")).toBe(0.37);
    expect(minSimilarityFor("gemini-embedding-001")).toBeNull();
    expect(minSimilarityFor("unknown")).toBeNull();
  });
});

describe("embeddingAfterUpdate", () => {
  const base = { previousProvider: "openai", previousModel: "text-embedding-3-small" as string | null, keyChanged: false };

  it("switches to the new provider's default and redoes the vectors", () => {
    expect(embeddingAfterUpdate({ ...base, provider: "gemini" })).toEqual({ model: "gemini-embedding-001", reembed: true });
  });

  it("turns off for Claude and redoes (clears) the vectors", () => {
    expect(embeddingAfterUpdate({ ...base, provider: "anthropic" })).toEqual({ model: null, reembed: true });
  });

  it("stays off when it was off", () => {
    expect(embeddingAfterUpdate({ ...base, previousModel: null, provider: "gemini" })).toEqual({ model: null, reembed: false });
  });

  it("does nothing when only other settings change", () => {
    expect(embeddingAfterUpdate({ ...base, provider: "openai" })).toEqual({ model: "text-embedding-3-small", reembed: false });
  });

  it("retries the vectors when a new key arrives (documents left in error without a key)", () => {
    expect(embeddingAfterUpdate({ ...base, provider: "openai", keyChanged: true })).toEqual({ model: "text-embedding-3-small", reembed: true });
    expect(embeddingAfterUpdate({ ...base, previousModel: null, provider: "openai", keyChanged: true })).toEqual({ model: null, reembed: false });
  });
});

describe("embedTexts", () => {
  it("sends batches of 100 with 1536 dimensions and normalizes the vectors", async () => {
    embed.mockImplementation(async (req: any) => req.texts.map(() => vector(2)));
    const texts = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const out = await embedTexts("openai", "k", "text-embedding-3-small", texts, "document");
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0][0]).toMatchObject({ apiKey: "k", model: "text-embedding-3-small", kind: "document", dimensions: 1536 });
    expect(embed.mock.calls[0][0].texts).toHaveLength(100);
    expect(embed.mock.calls[1][0].texts).toHaveLength(50);
    expect(out).toHaveLength(150);
    const norm = Math.sqrt(out[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("returns nothing for no texts without calling the provider", async () => {
    expect(await embedTexts("openai", "k", "text-embedding-3-small", [], "document")).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("rejects a provider without embeddings or a model of another provider", async () => {
    await expect(embedTexts("anthropic", "k", "text-embedding-3-small", ["a"], "query")).rejects.toThrow();
    await expect(embedTexts("gemini", "k", "text-embedding-3-small", ["a"], "query")).rejects.toThrow();
  });

  it("rejects a reply with the wrong count or size", async () => {
    embed.mockResolvedValueOnce([vector(1)]);
    await expect(embedTexts("openai", "k", "text-embedding-3-small", ["a", "b"], "document")).rejects.toThrow();
    embed.mockResolvedValueOnce([[1, 2, 3]]);
    await expect(embedTexts("openai", "k", "text-embedding-3-small", ["a"], "document")).rejects.toThrow();
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe("[0.5,-1,0]");
  });
});
