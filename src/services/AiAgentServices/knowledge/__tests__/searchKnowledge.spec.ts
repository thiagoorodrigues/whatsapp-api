const query = jest.fn();
jest.mock("../../../../models/AiKnowledgeChunk", () => ({
  __esModule: true,
  default: { sequelize: { query: (...a: any[]) => query(...a) } }
}));
jest.mock("../../../../models/AiKnowledgeDocument", () => ({ __esModule: true, default: {} }));
jest.mock("../../AgentService", () => ({ findAgent: jest.fn() }));
jest.mock("../EmbeddingService", () => ({ embedDocument: jest.fn(), resumeEmbeddings: jest.fn(), reembedAgentLater: jest.fn() }));
jest.mock("../../keys", () => ({ agentKey: () => "k" }));
// The real SDKs do not load under Jest; only embedTexts is replaced below.
jest.mock("../../providers", () => ({ getProvider: jest.fn() }));
const embedTexts = jest.fn();
jest.mock("../embeddings", () => ({
  ...jest.requireActual("../embeddings"),
  embedTexts: (...a: any[]) => embedTexts(...a)
}));

// eslint-disable-next-line import/first
import { searchKnowledge } from "../KnowledgeService";

const hit = (chunkId: number) => ({ chunkId, documentId: 1, title: "Doc", description: null, content: `c${chunkId}`, rank: 1 });
const agent = (embeddingModel: string | null) => ({ id: 3, companyId: 2, provider: "openai", embeddingModel, apiKeyEncrypted: "x" });
const isVectorQuery = (sql: string) => sql.includes("<=>");

describe("searchKnowledge", () => {
  it("uses keyword search only when the agent has no model", async () => {
    query.mockResolvedValue(Array.from({ length: 8 }, (_, i) => hit(i + 1)));
    const result = await searchKnowledge(agent(null), "frete");
    expect(embedTexts).not.toHaveBeenCalled();
    expect(result.map(h => h.chunkId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("fuses keyword and semantic results", async () => {
    query.mockImplementation(async (sql: string) => (isVectorQuery(sql) ? [hit(3), hit(1)] : [hit(1), hit(2)]));
    embedTexts.mockResolvedValue([[0.5, 0.5]]);
    const result = await searchKnowledge(agent("text-embedding-3-small"), "quanto é o frete?");
    expect(embedTexts).toHaveBeenCalledWith("openai", "k", "text-embedding-3-small", ["quanto é o frete?"], "query");
    const vectorCall = query.mock.calls.find(c => isVectorQuery(c[0]));
    expect(vectorCall[1].replacements).toMatchObject({
      model: "text-embedding-3-small",
      vector: "[0.5,0.5]",
      agentId: 3,
      companyId: 2,
      minSimilarity: 0.3
    });
    expect(vectorCall[0]).toContain(">= :minSimilarity");
    expect(result.map(h => h.chunkId)).toEqual([1, 3, 2]);
  });

  it("falls back to keyword search when the embedding call fails", async () => {
    query.mockResolvedValue([hit(7)]);
    embedTexts.mockRejectedValue(new Error("401 Incorrect API key"));
    const result = await searchKnowledge(agent("text-embedding-3-small"), "frete");
    expect(result.map(h => h.chunkId)).toEqual([7]);
    expect(query.mock.calls.some(c => isVectorQuery(c[0]))).toBe(false);
  });

  it("finds nothing for an off-topic question (no keyword hit, semantic below the floor)", async () => {
    query.mockResolvedValue([]);
    embedTexts.mockResolvedValue([[1, 0]]);
    expect(await searchKnowledge(agent("text-embedding-3-small"), "vocês vendem pneus?")).toEqual([]);
  });

  it("does not filter by similarity for a model without a calibrated floor", async () => {
    query.mockResolvedValue([]);
    embedTexts.mockResolvedValue([[1, 0]]);
    await searchKnowledge({ ...agent("gemini-embedding-001"), provider: "gemini" }, "frete");
    const vectorCall = query.mock.calls.find(c => isVectorQuery(c[0]));
    expect(vectorCall[0]).not.toContain(":minSimilarity");
  });

  it("returns nothing for an empty question", async () => {
    expect(await searchKnowledge(agent("text-embedding-3-small"), "   ")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
