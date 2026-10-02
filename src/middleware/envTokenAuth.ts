import { Request, Response, NextFunction } from "express";

import AppError from "../errors/AppError";

type TokenPayload = {
  token: string | undefined;
};

// Integration token for /auth/signup. Without ENV_TOKEN configured the route
// is closed: an unset variable must never match a request without token.
const envTokenAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const expected = process.env.ENV_TOKEN;
  const { token: bodyToken } = (req.body || {}) as TokenPayload;
  const { token: queryToken } = req.query as TokenPayload;
  const given = bodyToken || queryToken;

  if (expected && typeof given === "string" && given === expected) {
    return next();
  }

  throw new AppError("Token inválido", 403);
};

export default envTokenAuth;
