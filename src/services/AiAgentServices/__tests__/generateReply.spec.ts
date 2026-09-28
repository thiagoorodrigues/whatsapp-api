const runTurn = jest.fn();
jest.mock("../providers", () => ({ getProvider: () => ({ runTurn }) }));
const knowledgeForTurn = jest.fn(async (..._a: any[]) => ({ alwaysIncluded: [], searchable: false }));
const searchKnowledge = jest.fn();
jest.mock("../knowledge/KnowledgeService", () => ({
  knowledgeForTurn: (...a: any[]) => knowledgeForTurn(...a),
  searchKnowledge: (...a: any[]) => searchKnowledge(...a)
}));

// eslint-disable-next-line import/first
import generateReply from "../generateReply";

describe("generateReply", () => {
  it("passes the agent settings and collects deferred actions from tool calls", async () => {
    runTurn.mockImplementation(async req => {
      const call = await req.executeTool("transferir_para_atendente", { fila: "Suporte", motivo: "boleto" });
      return {
        text: "Vou te passar para o suporte.",
        inputTokens: 10,
        outputTokens: 5,
        toolCalls: [{ name: "transferir_para_atendente", input: {}, result: call.result }],
        stopReason: "end_turn"
      };
    });

    const agent = {
      provider: "anthropic",
      model: "claude-opus-5",
      effort: "low",
      prompt: "Você é a Ana.",
      tools: { transfer: { enabled: true } }
    } as any;

    const result = await generateReply({
      agent,
      apiKey: "k",
      history: [{ role: "user", text: "meu boleto" }],
      queues: [{ id: 7, name: "Suporte" }],
      companyName: "Loja"
    });

    const req = runTurn.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5");
    expect(req.effort).toBe("low");
    expect(req.system).toContain("Você é a Ana.");
    expect(req.systemContext).toContain("Loja");
    expect(req.tools.map((t: any) => t.name)).toEqual(["transferir_para_atendente"]);
    expect(result.reply).toBe("Vou te passar para o suporte.");
    expect(result.actions).toEqual([{ type: "transfer", queueId: 7, reason: "boleto" }]);
  });

  it("offers the knowledge search and puts 'always include' documents in the prompt", async () => {
    knowledgeForTurn.mockResolvedValueOnce({
      alwaysIncluded: [{ title: "Preços", description: null, content: "Entrega Contagem: R$ 15" }],
      searchable: true
    });
    searchKnowledge.mockResolvedValue([{ title: "Manual", description: "v2", content: "Modo econômico: botão 3" }]);
    runTurn.mockImplementation(async req => {
      const call = await req.executeTool("buscar_base_conhecimento", { consulta: "modo econômico" });
      return { text: "Aperte o botão 3.", toolCalls: [{ name: "buscar_base_conhecimento", input: {}, result: call.result }], inputTokens: 1, outputTokens: 1, stopReason: "end_turn" };
    });
    await generateReply({
      agent: { id: 4, companyId: 1, provider: "anthropic", model: "m", prompt: "Você é a Ana.", tools: {} } as any,
      apiKey: "k",
      history: [{ role: "user", text: "como ligo o modo econômico?" }],
      queues: []
    });
    const req = runTurn.mock.calls[runTurn.mock.calls.length - 1][0];
    expect(req.tools.map((t: any) => t.name)).toContain("buscar_base_conhecimento");
    expect(req.system).toContain('<documento titulo="Preços">');
    expect(req.system).toContain("Entrega Contagem: R$ 15");
    expect(searchKnowledge).toHaveBeenCalledWith(4, 1, "modo econômico");
  });
});
