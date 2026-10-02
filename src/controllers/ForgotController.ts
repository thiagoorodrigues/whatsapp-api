import { Request, Response } from "express";
import {
  requestPasswordReset,
  resetPassword
} from "../services/PasswordResetServices/PasswordResetService";
import sendResetMail from "../services/PasswordResetServices/sendResetMail";

// E-mail, code and new password travel in the body: URLs end up in logs.
export const store = async (req: Request, res: Response): Promise<Response> => {
  await requestPasswordReset(req.body?.email, sendResetMail);

  return res.json({
    message: "Se o e-mail estiver cadastrado, você receberá o código de verificação."
  });
};

export const resetPasswords = async (req: Request, res: Response): Promise<Response> => {
  const { email, token, password } = req.body || {};

  await resetPassword(email, token, password);

  return res.json({ message: "Senha redefinida com sucesso" });
};
