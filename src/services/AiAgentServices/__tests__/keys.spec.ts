process.env.SECRETS_KEY = process.env.SECRETS_KEY || "teste";

// The provider SDKs need browser globals that jest/node does not define.
jest.mock("../providers", () => ({ getProvider: jest.fn(), isProviderName: jest.fn() }));

// eslint-disable-next-line import/first
import { agentKey } from "../keys";
// eslint-disable-next-line import/first
import { encryptSecret } from "../../../helpers/secretBox";

describe("agentKey", () => {
  it("decrypts a stored key", () => {
    expect(agentKey({ apiKeyEncrypted: encryptSecret("sk-teste-123") })).toBe("sk-teste-123");
  });
  it("explains when the key cannot be read", () => {
    expect(() => agentKey({ apiKeyEncrypted: "v1:aaaa:bbbb:cccc" })).toThrow("ERR_AI_KEY_UNREADABLE");
  });
  it("returns null without a key", () => {
    expect(agentKey({ apiKeyEncrypted: null })).toBeNull();
  });
});
