const findAgent = jest.fn();
jest.mock("../../AgentService", () => ({ findAgent: (...a: any[]) => findAgent(...a) }));
const reembedAgentLater = jest.fn();
jest.mock("../EmbeddingService", () => ({
  embedDocument: jest.fn(),
  resumeEmbeddings: jest.fn(),
  reembedAgentLater: (...a: any[]) => reembedAgentLater(...a)
}));
jest.mock("../../../../models/AiKnowledgeChunk", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../models/AiKnowledgeDocument", () => ({ __esModule: true, default: {} }));
// The real SDKs do not load under Jest.
jest.mock("../../providers", () => ({ getProvider: jest.fn(), isProviderName: () => true }));

// eslint-disable-next-line import/first
import { setEmbeddingModel } from "../KnowledgeService";

const agentWith = (provider: string, embeddingModel: string | null) => {
  const agent: any = { id: 3, provider, embeddingModel };
  agent.update = jest.fn(async (values: any) => Object.assign(agent, values));
  return agent;
};

describe("setEmbeddingModel", () => {
  it("saves a new model and redoes the vectors", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    const settings = await setEmbeddingModel(3, 2, "text-embedding-3-large");
    expect(agent.update).toHaveBeenCalledWith({ embeddingModel: "text-embedding-3-large" });
    expect(reembedAgentLater).toHaveBeenCalledWith(3);
    expect(settings.embeddingModel).toBe("text-embedding-3-large");
    expect(settings.options.map(o => o.id)).toEqual(["text-embedding-3-small", "text-embedding-3-large"]);
  });

  it("turns it off with null or empty", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    await setEmbeddingModel(3, 2, "");
    expect(agent.embeddingModel).toBeNull();
    expect(reembedAgentLater).toHaveBeenCalledWith(3);
  });

  it("does nothing when the model is the same", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    await setEmbeddingModel(3, 2, "text-embedding-3-small");
    expect(agent.update).not.toHaveBeenCalled();
    expect(reembedAgentLater).not.toHaveBeenCalled();
  });

  it("refuses a model of another provider and any model for Claude", async () => {
    findAgent.mockResolvedValue(agentWith("gemini", null));
    await expect(setEmbeddingModel(3, 2, "text-embedding-3-small")).rejects.toThrow("ERR_AI_EMBEDDING_MODEL_INVALID");
    findAgent.mockResolvedValue(agentWith("anthropic", null));
    await expect(setEmbeddingModel(3, 2, "text-embedding-3-small")).rejects.toThrow("ERR_AI_EMBEDDING_MODEL_INVALID");
  });
});
