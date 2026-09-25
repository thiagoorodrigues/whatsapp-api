import fs from "fs";
import path from "path";
import { Router } from "express";

// package.json sits two levels up from both src/routes and dist/routes.
const { version } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
);

// Public status of the API, e.g. for health checks and quick version checks.
const statusRoutes = Router();

statusRoutes.get("/", (_req, res) =>
  res.json({
    version,
    message: "API SwEasy OmniChannel em funcionamento.",
    docs: "/api-docs"
  })
);

export default statusRoutes;
