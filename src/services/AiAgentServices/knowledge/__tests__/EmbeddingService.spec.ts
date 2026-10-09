const query = jest.fn(async (..._a: any[]) => [] as any);
const chunkFindAll = jest.fn();
jest.mock("../../../../models/AiKnowledgeChunk", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => chunkFindAll(...a), sequelize: { query: (...a: any[]) => query(...a) } }
}));
const documentFindByPk = jest.fn();
jest.mock("../../../../models/AiKnowledgeDocument", () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => documentFindByPk(...a), findAll: jest.fn(async () => []), update: jest.fn() }
}));
const agentFindByPk = jest.fn();
jest.mock("../../../../models/AiAgent", () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => agentFindByPk(...a) }
}));
const agentKey = jest.fn((..._a: any[]) => "k" as string | null);
jest.mock("../../keys", () => ({ agentKey: (...a: any[]) => agentKey(...a) }));
// The real SDKs do not load under Jest; only embedTexts is replaced below.
jest.mock("../../providers", () => ({ getProvider: jest.fn() }));
const embedTexts = jest.fn();
jest.mock("../embeddings", () => ({
  ...jest.requireActual("../embeddings"),
  embedTexts: (...a: any[]) => embedTexts(...a)
}));

// eslint-disable-next-line import/first
import { embedDocument } from "../EmbeddingService";

const makeDocument = () => {
  const doc: any = { id: 9, agentId: 3, status: "ready" };
  doc.update = jest.fn(async (values: any) => Object.assign(doc, values));
  return doc;
};
const agentWith = (embeddingModel: string | null) => ({ id: 3, provider: "openai", embeddingModel, apiKeyEncrypted: "x" });

describe("embedDocument", () => {
  it("stores the vectors and marks the document ready with the model", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }, { id: 2, content: "b" }]);
    embedTexts.mockResolvedValue([[0.1], [0.2]]);

    await embedDocument(9);

    expect(embedTexts).toHaveBeenCalledWith("openai", "k", "text-embedding-3-small", ["a", "b"], "document");
    const update = query.mock.calls.find(c => String(c[0]).includes("SET embedding = v.e::vector"));
    expect(update[1].replacements).toEqual({ ids: [1, 2], vectors: ["[0.1]", "[0.2]"] });
    expect(doc).toMatchObject({ embeddingStatus: "ready", embeddingModel: "text-embedding-3-small", embeddingError: null });
  });

  it("clears the vectors when the agent has no model", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith(null));

    await embedDocument(9);

    expect(embedTexts).not.toHaveBeenCalled();
    expect(query.mock.calls.some(c => String(c[0]).includes("SET embedding = NULL"))).toBe(true);
    expect(doc).toMatchObject({ embeddingStatus: "none", embeddingModel: null });
  });

  it("marks ready without calling the provider when there are no chunks", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([]);
    embedTexts.mockResolvedValue([]);

    await embedDocument(9);

    expect(doc).toMatchObject({ embeddingStatus: "ready", embeddingModel: "text-embedding-3-small" });
  });

  it("keeps keyword search and records a readable error when the key is missing", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    agentKey.mockReturnValueOnce(null);

    await embedDocument(9);

    expect(doc.status).toBe("ready");
    expect(doc.embeddingStatus).toBe("error");
    expect(doc.embeddingModel).toBeNull();
    expect(doc.embeddingError).toContain("sem chave de API");
  });

  it("records the provider error", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }]);
    embedTexts.mockRejectedValue(new Error("429 You exceeded your current quota"));

    await embedDocument(9);

    expect(doc.embeddingStatus).toBe("error");
    expect(doc.embeddingError).toContain("429");
  });

  it("discards the result when the agent's model changed meanwhile", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk
      .mockResolvedValueOnce(agentWith("text-embedding-3-small"))
      .mockResolvedValueOnce(agentWith("text-embedding-3-large"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }]);
    embedTexts.mockResolvedValue([[0.1]]);

    await embedDocument(9);

    expect(query.mock.calls.some(c => String(c[0]).includes("SET embedding = v.e::vector"))).toBe(false);
    expect(doc.embeddingModel).toBeUndefined();
  });

  it("does nothing for a document that is not ready", async () => {
    documentFindByPk.mockResolvedValue({ ...makeDocument(), status: "processing" });
    await embedDocument(9);
    expect(agentFindByPk).not.toHaveBeenCalled();
  });
});
