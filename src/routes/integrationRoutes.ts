import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import isSuper from "../middleware/isSuper";
import * as IntegrationController from "../controllers/IntegrationController";

const integrationRoutes = Router();

integrationRoutes.get("/integrations/catalog", isAuth, isSuper, IntegrationController.catalog);
integrationRoutes.get("/integrations", isAuth, IntegrationController.index);
integrationRoutes.put("/integrations/:provider", isAuth, isAdmin, IntegrationController.update);
integrationRoutes.post("/integrations/:provider/test", isAuth, isAdmin, IntegrationController.test);
integrationRoutes.delete("/integrations/:provider", isAuth, isAdmin, IntegrationController.remove);

export default integrationRoutes;
