import express from "express";
import isAuth from "../middleware/isAuth";

import * as FlowController from "../controllers/FlowController";

const flowRoutes = express.Router();

flowRoutes.get("/flows", isAuth, FlowController.index);
flowRoutes.post("/flows", isAuth, FlowController.store);
flowRoutes.get("/flows/:flowId", isAuth, FlowController.show);
flowRoutes.put("/flows/:flowId", isAuth, FlowController.update);
flowRoutes.post("/flows/:flowId/duplicate", isAuth, FlowController.duplicate);
flowRoutes.put("/flows/:flowId/connections", isAuth, FlowController.connections);
flowRoutes.delete("/flows/:flowId", isAuth, FlowController.remove);

export default flowRoutes;
