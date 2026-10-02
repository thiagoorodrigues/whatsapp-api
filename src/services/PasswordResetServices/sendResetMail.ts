import nodemailer from "nodemailer";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

// SMTP of the platform (not of a tenant): SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS and MAIL_FROM in the environment. Never hard-code credentials.
const sendResetMail = async (email: string, code: string): Promise<void> => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) {
    logger.error("Password reset: SMTP_HOST, SMTP_USER, SMTP_PASS or MAIL_FROM not set");
    throw new AppError("ERR_MAIL_NOT_CONFIGURED", 503);
  }

  const port = Number(SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Redefinição de Senha",
    text: `Olá,\n\nVocê solicitou a redefinição de senha da sua conta no WeConex. Use este Código de Verificação para concluir:\n\nCódigo de Verificação: ${code}\n\nO código vale por 30 minutos e só pode ser usado uma vez.\n\nSe você não pediu a redefinição, ignore este e-mail.\n\nAtenciosamente,\nEquipe WeConex`
  });
};

export default sendResetMail;
