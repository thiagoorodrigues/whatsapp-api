const findOne = jest.fn();
const query = jest.fn();

jest.mock("../../../models/User", () => ({
  __esModule: true,
  default: {
    findOne: (...a: any[]) => findOne(...a),
    sequelize: { query: (...a: any[]) => query(...a) }
  }
}));

jest.mock("../../../utils/logger", () => ({ logger: { error: jest.fn() } }));

/* eslint-disable import/first */
import {
  requestPasswordReset,
  resetPassword,
  makeResetValue,
  matchesResetValue
} from "../PasswordResetService";
/* eslint-enable import/first */

const NOW = 1_700_000_000_000;

beforeEach(() => {
  findOne.mockReset();
  query.mockReset().mockResolvedValue([]);
});

describe("reset value", () => {
  it("stores only a hash and accepts the right code before it expires", () => {
    const value = makeResetValue("abc123", NOW);
    expect(value).not.toContain("abc123");
    expect(matchesResetValue(value, "abc123", NOW + 60_000)).toBe(true);
    expect(matchesResetValue(value, "abc124", NOW + 60_000)).toBe(false);
    expect(matchesResetValue(value, "abc123", NOW + 31 * 60_000)).toBe(false);
    expect(matchesResetValue("", "", NOW)).toBe(false);
    expect(matchesResetValue(null, "abc123", NOW)).toBe(false);
  });
});

describe("requestPasswordReset", () => {
  it("does nothing and sends nothing for an unknown e-mail", async () => {
    findOne.mockResolvedValue(null);
    const send = jest.fn();
    await requestPasswordReset("nobody@x.com", send);
    expect(send).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("answers the same when the e-mail cannot be sent", async () => {
    findOne.mockResolvedValue({ id: 3, email: "a@x.com" });
    const send = jest.fn().mockRejectedValue(new Error("smtp down"));
    await expect(requestPasswordReset("a@x.com", send)).resolves.toBeUndefined();
    await new Promise(r => setImmediate(r));
    expect(send).toHaveBeenCalled();
  });

  it("looks the user up through the model, never by string-built SQL", async () => {
    findOne.mockResolvedValue({ id: 3, email: "a@x.com" });
    const send = jest.fn();
    await requestPasswordReset(" A@X.com' OR 1=1 -- ", send);
    await new Promise(r => setImmediate(r));
    expect(JSON.stringify(findOne.mock.calls[0][0])).toContain(`"logic":"a@x.com' or 1=1 --"`);
    const [sql, opts] = query.mock.calls[0];
    expect(sql).not.toContain("a@x.com");
    expect(opts.replacements).toEqual(expect.objectContaining({ id: 3 }));
    expect(send).toHaveBeenCalledWith("a@x.com", expect.stringMatching(/^[0-9a-f]{32}$/));
  });
});

describe("resetPassword", () => {
  it("refuses a wrong code and leaves the password alone", async () => {
    const user = { id: 3, tokenVersion: 0, update: jest.fn() };
    findOne.mockResolvedValue(user);
    query.mockResolvedValueOnce([{ resetPassword: makeResetValue("right", Date.now()) }]);
    await expect(resetPassword("a@x.com", "wrong", "novaSenha1")).rejects.toMatchObject({
      message: "ERR_INVALID_RESET_TOKEN"
    });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("refuses an unknown e-mail with the same error", async () => {
    findOne.mockResolvedValue(null);
    await expect(resetPassword("x@x.com", "any", "novaSenha1")).rejects.toMatchObject({
      message: "ERR_INVALID_RESET_TOKEN"
    });
  });

  it("changes the password, burns the code and ends the open sessions", async () => {
    const user = { id: 3, tokenVersion: 4, update: jest.fn() };
    findOne.mockResolvedValue(user);
    query.mockResolvedValueOnce([{ resetPassword: makeResetValue("right", Date.now()) }]);
    await resetPassword("a@x.com", "right", "novaSenha1");
    expect(user.update).toHaveBeenCalledWith({ password: "novaSenha1", tokenVersion: 5 });
    const [sql, opts] = query.mock.calls[1];
    expect(sql).toContain(`"resetPassword" = ''`);
    expect(opts.replacements).toEqual({ id: 3 });
  });

  it("refuses a weak password", async () => {
    await expect(resetPassword("a@x.com", "right", "novasenha1")).rejects.toMatchObject({
      message: "ERR_WEAK_PASSWORD"
    });
    expect(findOne).not.toHaveBeenCalled();
  });
});
