import {
  FlowGraph,
  startFlow,
  continueFlow,
  interpolate,
  matchOption,
  DEFAULT_INVALID_TEXT,
  MAX_WAIT_SECONDS
} from "../FlowEngine";

const graph: FlowGraph = {
  nodes: [
    { id: "start", type: "start", data: {} },
    { id: "hello", type: "message", data: { text: "Olá! Bem-vindo." } },
    {
      id: "menu",
      type: "menu",
      data: {
        text: "Como podemos ajudar?",
        variable: "assunto",
        options: [
          { id: "sales", label: "Vendas" },
          { id: "support", label: "Suporte técnico" }
        ]
      }
    },
    { id: "askName", type: "question", data: { text: "Qual seu nome?", variable: "nome" } },
    { id: "thanks", type: "message", data: { text: "Obrigado, {{nome}}! {{name}}" } },
    {
      id: "isVip",
      type: "condition",
      data: { variable: "nome", operator: "equals", value: "joão" }
    },
    { id: "toSales", type: "transfer", data: { queueId: 3, text: "Transferindo..." } },
    { id: "bye", type: "end", data: { text: "Até mais", closeTicket: true } },
    { id: "support", type: "transfer", data: { queueId: 7 } }
  ],
  edges: [
    { source: "start", target: "hello" },
    { source: "hello", target: "menu" },
    { source: "menu", sourceHandle: "sales", target: "askName" },
    { source: "menu", sourceHandle: "support", target: "support" },
    { source: "askName", target: "thanks" },
    { source: "thanks", target: "isVip" },
    { source: "isVip", sourceHandle: "true", target: "toSales" },
    { source: "isVip", sourceHandle: "false", target: "bye" }
  ]
};

describe("FlowEngine", () => {
  it("runs from start until the first node that waits for an answer", () => {
    const result = startFlow(graph);
    expect(result.finished).toBe(false);
    expect(result.state.nodeId).toBe("menu");
    expect(result.actions).toEqual([
      { type: "text", text: "Olá! Bem-vindo." },
      { type: "text", text: "Como podemos ajudar?\n\n*1* - Vendas\n*2* - Suporte técnico" }
    ]);
  });

  it("repeats the menu on an invalid answer", () => {
    const result = continueFlow(graph, { nodeId: "menu", variables: {} }, "9");
    expect(result.state.nodeId).toBe("menu");
    expect(result.actions[0]).toEqual({ type: "text", text: DEFAULT_INVALID_TEXT });
    expect(result.finished).toBe(false);
  });

  it("follows the chosen option by number or by label, ignoring accents", () => {
    const byNumber = continueFlow(graph, { nodeId: "menu", variables: {} }, " 1 ");
    expect(byNumber.state).toEqual({ nodeId: "askName", variables: { assunto: "Vendas" } });

    const byLabel = continueFlow(graph, { nodeId: "menu", variables: {} }, "suporte tecnico");
    expect(byLabel.finished).toBe(true);
    expect(byLabel.actions).toEqual([{ type: "transfer", queueId: 7, userId: null }]);
  });

  it("stores answers and interpolates them, keeping unknown placeholders", () => {
    const result = continueFlow(
      graph,
      { nodeId: "askName", variables: { assunto: "Vendas" } },
      "João"
    );
    expect(result.actions[0]).toEqual({ type: "text", text: "Obrigado, João! {{name}}" });
    // condition: "João" equals "joão" (accent and case insensitive)
    expect(result.actions.slice(1)).toEqual([
      { type: "text", text: "Transferindo..." },
      { type: "transfer", queueId: 3, userId: null }
    ]);
    expect(result.finished).toBe(true);
    expect(result.state.nodeId).toBeNull();
  });

  it("takes the false branch and ends the ticket", () => {
    const result = continueFlow(graph, { nodeId: "askName", variables: {} }, "Maria");
    expect(result.actions.slice(-2)).toEqual([
      { type: "text", text: "Até mais" },
      { type: "end", closeTicket: true }
    ]);
  });

  it("finishes when a node has no outgoing edge", () => {
    const result = startFlow({
      nodes: [
        { id: "s", type: "start", data: {} },
        { id: "m", type: "message", data: { text: "Oi" } }
      ],
      edges: [{ source: "s", target: "m" }]
    });
    expect(result.finished).toBe(true);
    expect(result.actions).toEqual([{ type: "text", text: "Oi" }]);
  });

  it("finishes immediately for a flow without a start node", () => {
    expect(startFlow({ nodes: [], edges: [] })).toEqual({
      actions: [],
      state: { nodeId: null, variables: {} },
      finished: true
    });
  });

  it("stops infinite loops", () => {
    const loop: FlowGraph = {
      nodes: [
        { id: "s", type: "start", data: {} },
        { id: "a", type: "message", data: { text: "a" } }
      ],
      edges: [
        { source: "s", target: "a" },
        { source: "a", target: "a" }
      ]
    };
    const result = startFlow(loop);
    expect(result.finished).toBe(true);
    expect(result.actions.length).toBeLessThan(60);
  });

  it("sends media with caption and caps waits", () => {
    const result = startFlow({
      nodes: [
        { id: "s", type: "start", data: {} },
        { id: "w", type: "wait", data: { seconds: 999 } },
        {
          id: "img",
          type: "message",
          data: { mediaUrl: "https://x/y.png", mediaType: "image", text: "Veja" }
        }
      ],
      edges: [
        { source: "s", target: "w" },
        { source: "w", target: "img" }
      ]
    });
    expect(result.actions).toEqual([
      { type: "wait", seconds: MAX_WAIT_SECONDS },
      { type: "media", url: "https://x/y.png", mediaType: "image", caption: "Veja" }
    ]);
  });

  it("restarts when the saved node no longer exists", () => {
    const result = continueFlow(graph, { nodeId: "gone", variables: {} }, "oi");
    expect(result.state.nodeId).toBe("menu");
  });

  it("interpolate and matchOption helpers", () => {
    expect(interpolate("{{ a }}-{{b}}", { a: "1" })).toBe("1-{{b}}");
    const menu = graph.nodes[2];
    expect(matchOption(menu, "")).toBeUndefined();
    expect(matchOption(menu, "VENDAS")?.id).toBe("sales");
  });
});
