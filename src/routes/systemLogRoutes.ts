import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as SystemLogController from "../controllers/SystemLogController";

const systemLogRoutes = Router();

systemLogRoutes.get("/system-logs", isAuth, isSuper, SystemLogController.index);
systemLogRoutes.get("/system-logs/summary", isAuth, isSuper, SystemLogController.summary);
systemLogRoutes.post("/system-logs/client", isAuth, SystemLogController.client);

export default systemLogRoutes;
