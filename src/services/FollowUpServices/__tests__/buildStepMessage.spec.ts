const runTurn = jest.fn();
jest.mock("../../AiAgentServices/providers", () => ({ getProvider: () => ({ runTurn }) }));
jest.mock("../../AiAgentServices/keys", () => ({ agentKey: (a: any) => a.apiKeyEncrypted || null }));
jest.mock("../../AiAgentServices/RunAiAgentService", () => ({
  toHistory: (ms: any[]) => ms.map(m => ({ role: m.fromMe ? "assistant" : "user", text: m.body })),
  trimHistory: (h: any) => h
}));
jest.mock("../../../models/AiAgent", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findAll: jest.fn(async () => [{ fromMe: true, body: "Segue o orçamento" }]) } }));
jest.mock("../../../config/upload", () => ({ __esModule: true, default: { directory: "/srv/public" } }));
jest.mock("../../../utils/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import AiAgent from "../../../models/AiAgent";
// eslint-disable-next-line import/first
import { buildStepMessage } from "../buildStepMessage";

const ticket: any = { id: 50, companyId: 4, contact: { name: "Maria Souza" } };
const rule: any = { aiAgentId: 5 };
const textStep: any = { mode: "text", body: "Oi {{firstName}}, conseguiu ver?", mediaPath: null };

beforeEach(() => jest.clearAllMocks());

describe("buildStepMessage", () => {
  it("fills the usual variables", async () => {
    expect(await buildStepMessage(textStep, ticket, rule)).toEqual({ type: "text", text: "Oi Maria, conseguiu ver?" });
  });
  it("sends the company's file with the text as caption", async () => {
    const out: any = await buildStepMessage({ ...textStep, mediaPath: "company4/1_ab_foto.jpg", mediaName: "foto.jpg" }, ticket, rule);
    expect(out).toMatchObject({ type: "image", path: "/srv/public/company4/1_ab_foto.jpg", caption: "Oi Maria, conseguiu ver?" });
  });
  it("ignores a file outside the company folder", async () => {
    const out = await buildStepMessage({ ...textStep, mediaPath: "company9/x.jpg", mediaName: "x.jpg" }, ticket, rule);
    expect(out).toEqual({ type: "text", text: "Oi Maria, conseguiu ver?" });
  });
  it("asks the rule's agent, without tools, for an AI step", async () => {
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "gpt-x", prompt: "Você é a Ana.", apiKeyEncrypted: "k" });
    runTurn.mockResolvedValue({ text: "Oi Maria! Ficou alguma dúvida?" });
    const out = await buildStepMessage({ mode: "ai", body: "reserva", aiInstruction: "Retome o orçamento" } as any, ticket, rule);
    expect(out).toEqual({ type: "text", text: "Oi Maria! Ficou alguma dúvida?" });
    expect(AiAgent.findOne).toHaveBeenCalledWith({ where: { id: 5, companyId: 4 } });
    const req = runTurn.mock.calls[0][0];
    expect(req.tools).toEqual([]);
    expect(req.maxSteps).toBe(1);
    expect(req.system).toContain("Você é a Ana.");
    expect(req.history[req.history.length - 1]).toMatchObject({ role: "user" });
    expect(req.history[req.history.length - 1].text).toContain("Retome o orçamento");
  });
  it("falls back to the fixed text when the AI fails, has no key or answers empty", async () => {
    const step: any = { mode: "ai", body: "Oi {{firstName}}", aiInstruction: "Retome" };
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "m", prompt: "", apiKeyEncrypted: "k" });
    runTurn.mockRejectedValue(new Error("429"));
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
    runTurn.mockResolvedValue({ text: "  " });
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "m", apiKeyEncrypted: null });
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
  });
});
