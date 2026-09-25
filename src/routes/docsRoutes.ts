import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import openapi from "../docs/openapi";

// Public docs for the external messaging API. The operations themselves
// still require a connection token; only the documentation is open.
const docsRoutes = Router();

docsRoutes.get("/api-docs.json", (_req, res) => res.json(openapi));
docsRoutes.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: "SwEasy OmniChannel – API",
    swaggerOptions: { persistAuthorization: true }
  })
);

export default docsRoutes;
