import crypto from "crypto";
import { QueryTypes, Sequelize } from "sequelize";
import AppError from "../../errors/AppError";
import User from "../../models/User";
import { logger } from "../../utils/logger";

// "Users"."resetPassword" is not mapped on the model on purpose, so it never
// shows up in user payloads. It holds "<sha256 of the code>.<expiry ms>".
const TTL_MS = 30 * 60 * 1000;
const MIN_PASSWORD = 5;

const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

const normalizeEmail = (email: unknown): string =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

// Case-insensitive equality (no LIKE: "%" or "_" in the input stay literal).
const byEmail = (email: unknown) => ({
  where: Sequelize.where(Sequelize.fn("lower", Sequelize.col("email")), normalizeEmail(email))
});

export const makeResetValue = (code: string, now: number): string =>
  `${sha256(code)}.${now + TTL_MS}`;

export const matchesResetValue = (
  stored: string | null | undefined,
  code: string,
  now: number
): boolean => {
  if (!stored || !code) return false;
  const [hash, expiresAt] = stored.split(".");
  if (!hash || !(Number(expiresAt) > now)) return false;
  const given = Buffer.from(sha256(code));
  const expected = Buffer.from(hash);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

type SendCode = (email: string, code: string) => Promise<unknown>;

// Unknown e-mails get the same answer as known ones (no account probing).
export const requestPasswordReset = async (
  email: unknown,
  send: SendCode
): Promise<void> => {
  const user = await User.findOne(byEmail(email));
  if (!user) return;

  const code = crypto.randomBytes(16).toString("hex");
  await User.sequelize!.query(
    `UPDATE "Users" SET "resetPassword" = :value WHERE id = :id`,
    { replacements: { value: makeResetValue(code, Date.now()), id: user.id }, type: QueryTypes.UPDATE }
  );
  // Not awaited and never surfaced: a slow or failing SMTP must not tell a
  // known e-mail apart from an unknown one.
  Promise.resolve()
    .then(() => send(user.email, code))
    .catch(err => logger.error(`Password reset e-mail not sent: ${err?.message || err}`));
};

export const resetPassword = async (
  email: unknown,
  code: unknown,
  password: unknown
): Promise<void> => {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new AppError("ERR_PASSWORD_TOO_SHORT", 400);
  }
  const invalid = new AppError("ERR_INVALID_RESET_TOKEN", 400);

  const user = await User.findOne(byEmail(email));
  if (!user || typeof code !== "string") throw invalid;

  const rows: any[] = await User.sequelize!.query(
    `SELECT "resetPassword" FROM "Users" WHERE id = :id`,
    { replacements: { id: user.id }, type: QueryTypes.SELECT }
  );
  if (!matchesResetValue(rows[0]?.resetPassword, code, Date.now())) throw invalid;

  // tokenVersion++ invalidates the refresh tokens of every open session.
  await user.update({ password, tokenVersion: (user.tokenVersion || 0) + 1 });
  await User.sequelize!.query(
    `UPDATE "Users" SET "resetPassword" = '' WHERE id = :id`,
    { replacements: { id: user.id }, type: QueryTypes.UPDATE }
  );
};
