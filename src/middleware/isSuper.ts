import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import User from "../models/User";

// The JWT does not carry "super": read it from the database on each call.
export const userIsSuper = async (userId: string | number): Promise<boolean> => {
  const user = await User.findByPk(userId, { attributes: ["id", "super"] });
  return !!user?.super;
};

// SaaS management (companies, plans, invoices): super users only.
const isSuper = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!(await userIsSuper(req.user.id))) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  return next();
};

export default isSuper;
