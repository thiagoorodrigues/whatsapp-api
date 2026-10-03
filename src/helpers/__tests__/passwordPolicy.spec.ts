import { assertStrongPassword, isStrongPassword } from "../passwordPolicy";

describe("password policy", () => {
  it("accepts 6+ characters with uppercase, lowercase and a number", () => {
    expect(isStrongPassword("Abc123")).toBe(true);
    expect(isStrongPassword("Senha2026!")).toBe(true);
  });

  it("refuses short passwords or ones missing a kind of character", () => {
    expect(isStrongPassword("Ab123")).toBe(false); // 5 chars
    expect(isStrongPassword("abc123")).toBe(false); // no uppercase
    expect(isStrongPassword("ABC123")).toBe(false); // no lowercase
    expect(isStrongPassword("Abcdef")).toBe(false); // no number
    expect(isStrongPassword("")).toBe(false);
    expect(isStrongPassword(undefined)).toBe(false);
  });

  it("throws ERR_WEAK_PASSWORD", () => {
    expect(() => assertStrongPassword("mudar123")).toThrow("ERR_WEAK_PASSWORD");
    expect(() => assertStrongPassword("Mudar123")).not.toThrow();
  });
});
