import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as ServerMonitorController from "../controllers/ServerMonitorController";

const serverMonitorRoutes = Router();

serverMonitorRoutes.get("/server-monitor", isAuth, isSuper, ServerMonitorController.index);
serverMonitorRoutes.get("/server-monitor/history", isAuth, isSuper, ServerMonitorController.history);
serverMonitorRoutes.get("/server-monitor/alerts", isAuth, isSuper, ServerMonitorController.alerts);

export default serverMonitorRoutes;
