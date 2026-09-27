import { encryptSecret, decryptSecret, secretHint } from "../secretBox";

describe("secretBox", () => {
  beforeAll(() => {
    process.env.SECRETS_KEY = "test-secrets-key";
  });

  it("round-trips a secret and never stores it in clear", () => {
    const payload = encryptSecret("sk-ant-123456789");
    expect(payload).not.toContain("sk-ant");
    expect(decryptSecret(payload)).toBe("sk-ant-123456789");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered payloads", () => {
    const [v, iv, tag, data] = encryptSecret("secret").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("shows only the last characters", () => {
    expect(secretHint("sk-ant-abcdef")).toBe("…cdef");
  });
});
