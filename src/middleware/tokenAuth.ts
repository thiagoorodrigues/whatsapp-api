import { Request, Response, NextFunction } from "express";

import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";

// Connections are created without a token: an empty value must never match
// one of them. (Existing tokens may be short, so any non-empty value counts.)

export const readBearer = (header: unknown): string | null => {
  if (typeof header !== "string") return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token ? token : null;
};

const tokenAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = readBearer(req.headers.authorization);
  const whatsapp = token ? await Whatsapp.findOne({ where: { token } }) : null;

  if (!whatsapp) {
    throw new AppError("Acesso não permitido", 401);
  }

  req.params = {
    whatsappId: whatsapp.id.toString()
  };

  return next();
};

export default tokenAuth;
