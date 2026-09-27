jest.mock("../../../models/AiAgent", () => ({}));
jest.mock("../../../models/AiAgentRun", () => ({}));
jest.mock("../../../models/Whatsapp", () => ({}));
jest.mock("../keys", () => ({ validateKey: jest.fn() }));
jest.mock("../providers", () => ({ isProviderName: () => true }));

// eslint-disable-next-line import/first
import { serializeAgent } from "../AgentService";

describe("serializeAgent", () => {
  it("never exposes the encrypted key, only whether there is one", () => {
    const agent = {
      toJSON: () => ({ id: 1, name: "Ana", apiKeyEncrypted: "v1:abc:def:ghi", keyHint: "…1234" })
    } as any;
    const out = serializeAgent(agent);
    expect(out).toEqual({ id: 1, name: "Ana", keyHint: "…1234", hasKey: true, tools: { http: [], mcp: [] } });
    expect(JSON.stringify(out)).not.toContain("v1:abc");
  });

  it("masks the header values of HTTP and MCP tools", () => {
    const header = { key: "Authorization", valueEncrypted: "v1:seg:red:o" };
    const out = serializeAgent({
      toJSON: () => ({ id: 3, tools: { http: [{ id: "h", headers: [header] }], mcp: [{ id: "m", headers: [header] }] } })
    } as any);
    expect(JSON.stringify(out)).not.toContain("v1:seg");
    expect(out.tools.http[0].headers).toEqual([{ key: "Authorization", hasValue: true }]);
    expect(out.tools.mcp[0].headers).toEqual([{ key: "Authorization", hasValue: true }]);
  });

  it("reports a missing key", () => {
    const out = serializeAgent({ toJSON: () => ({ id: 2, apiKeyEncrypted: null }) } as any);
    expect(out.hasKey).toBe(false);
  });
});
