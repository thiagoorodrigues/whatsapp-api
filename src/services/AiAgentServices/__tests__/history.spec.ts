import { normalizeHistory, parseToolInput } from "../types";
import { buildContext, buildSystemPrompt, GUARDRAILS } from "../prompt";

jest.mock("../../../models/AiAgent", () => ({}));
jest.mock("../../../models/AiAgentRun", () => ({}));
jest.mock("../../../models/Company", () => ({}));
jest.mock("../../../models/Contact", () => ({}));
jest.mock("../../../models/Message", () => ({}));
jest.mock("../../../models/Queue", () => ({}));
jest.mock("../../../models/Ticket", () => ({}));
jest.mock("../../../models/Whatsapp", () => ({}));
jest.mock("../../TicketServices/UpdateTicketService", () => jest.fn());
jest.mock("../keys", () => ({ agentKey: jest.fn() }));
jest.mock("../generateReply", () => jest.fn());

// eslint-disable-next-line import/first
import { agentMayAnswer, toHistory } from "../RunAiAgentService";

describe("conversation history", () => {
  it("leaves internal notes out of the agent history", () => {
    const history = toHistory([
      { fromMe: false, body: "Quero cancelar", isDeleted: false, isPrivate: false },
      { fromMe: true, body: "cliente irritado, cuidado", isDeleted: false, isPrivate: true }
    ] as any);
    expect(history).toEqual([{ role: "user", text: "Quero cancelar" }]);
  });

  it("merges consecutive turns and starts with the customer", () => {
    expect(
      normalizeHistory([
        { role: "assistant", text: "Olá!" },
        { role: "user", text: "oi" },
        { role: "user", text: "tudo bem?" },
        { role: "assistant", text: "Tudo sim" },
        { role: "user", text: "  " }
      ])
    ).toEqual([
      { role: "user", text: "oi\ntudo bem?" },
      { role: "assistant", text: "Tudo sim" }
    ]);
  });

  it("maps stored messages, describing customer media", () => {
    const msgs = [
      { fromMe: false, body: "", mediaType: "image", isDeleted: false },
      { fromMe: true, body: "Recebi!", isDeleted: false },
      { fromMe: false, body: "apagada", isDeleted: true },
      { fromMe: true, body: "", mediaType: "image", isDeleted: false }
    ] as any;
    expect(toHistory(msgs)).toEqual([
      { role: "user", text: "[o cliente enviou uma imagem]" },
      { role: "assistant", text: "Recebi!" }
    ]);
  });

  it("parses tool input safely", () => {
    expect(parseToolInput('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolInput("{bad")).toEqual({ __invalidJson: "{bad" });
    expect(parseToolInput({ b: 2 })).toEqual({ b: 2 });
  });
});

describe("agentMayAnswer", () => {
  const base = { status: "pending", isGroup: false, userId: null, queueId: null, useIntegration: false, aiStoppedAt: null };
  it("answers new conversations only", () => {
    expect(agentMayAnswer(base as any)).toBe(true);
    expect(agentMayAnswer({ ...base, userId: 3 } as any)).toBe(false);
    expect(agentMayAnswer({ ...base, queueId: 1 } as any)).toBe(false);
    expect(agentMayAnswer({ ...base, status: "closed" } as any)).toBe(false);
    expect(agentMayAnswer({ ...base, isGroup: true } as any)).toBe(false);
    expect(agentMayAnswer({ ...base, aiStoppedAt: new Date() } as any)).toBe(false);
  });
});

describe("prompt", () => {
  it("puts the company prompt before the fixed rules", () => {
    const prompt = buildSystemPrompt("Você é a Ana da Loja X.");
    expect(prompt.startsWith("Você é a Ana da Loja X.")).toBe(true);
    expect(prompt).toContain(GUARDRAILS);
  });

  it("keeps volatile facts out of the stable prompt", () => {
    const context = buildContext({ companyName: "Loja X", contactName: "João", now: new Date(2026, 8, 27, 14, 30) });
    expect(context).toContain("Loja X");
    expect(context).toContain("João");
    expect(context).toContain("27/09/2026 14:30");
    expect(buildSystemPrompt("")).not.toContain("27/09/2026");
  });
});

describe("trimHistory", () => {
  // eslint-disable-next-line global-require
  const { trimHistory } = require("../RunAiAgentService");
  it("keeps the most recent messages within the budget", () => {
    const msgs = [
      { role: "user", text: "a".repeat(50) },
      { role: "assistant", text: "b".repeat(50) },
      { role: "user", text: "c".repeat(50) }
    ];
    expect(trimHistory(msgs, 120).map((m: any) => m.text[0])).toEqual(["b", "c"]);
    expect(trimHistory(msgs, 1000)).toHaveLength(3);
  });

  it("always keeps the latest message, even if it alone is too long", () => {
    expect(trimHistory([{ role: "user", text: "x".repeat(500) }], 100)).toHaveLength(1);
  });
});
