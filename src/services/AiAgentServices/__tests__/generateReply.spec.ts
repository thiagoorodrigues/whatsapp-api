const runTurn = jest.fn();
jest.mock("../providers", () => ({ getProvider: () => ({ runTurn }) }));

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
});
