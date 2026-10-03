import AppError from "../errors/AppError";

// Password rule for every account (users, company admins, password reset):
// at least 6 characters with an uppercase letter, a lowercase letter and a
// number. Same rule in whatsapp-app/src/utils/passwordPolicy.js.
export const isStrongPassword = (password: unknown): boolean =>
  typeof password === "string" &&
  password.length >= 6 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /[0-9]/.test(password);

export const assertStrongPassword = (password: unknown): void => {
  if (!isStrongPassword(password)) {
    throw new AppError("ERR_WEAK_PASSWORD", 400);
  }
};
