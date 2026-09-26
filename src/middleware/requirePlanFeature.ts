import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import { hasPlanFeature, PlanFeature } from "../helpers/planFeature";

// Route guard for features sold per plan; use after isAuth.
const requirePlanFeature = (feature: PlanFeature) => async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!(await hasPlanFeature(req.user.companyId, feature))) {
      throw new AppError("ERR_PLAN_FEATURE_NOT_AVAILABLE", 403);
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default requirePlanFeature;
