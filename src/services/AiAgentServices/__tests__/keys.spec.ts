process.env.SECRETS_KEY = process.env.SECRETS_KEY || "teste";

// The provider SDKs need browser globals that jest/node does not define.
jest.mock("../providers", () => ({ getProvider: jest.fn(), isProviderName: jest.fn() }));

const warn = jest.fn();
jest.mock("../../../utils/logger", () => ({ __esModule: true, default: { warn: (...a: any[]) => warn(...a) }, logger: { warn: (...a: any[]) => warn(...a) } }));

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
    expect(warn).toHaveBeenCalledWith({ err: expect.objectContaining({ message: expect.any(String) }) }, "agentKey: chave do agente ilegível");
  });
  it("returns null without a key", () => {
    expect(agentKey({ apiKeyEncrypted: null })).toBeNull();
  });
});
