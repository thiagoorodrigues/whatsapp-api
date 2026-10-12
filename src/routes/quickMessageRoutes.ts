import express from "express";
import isAuth from "../middleware/isAuth";

import * as QuickMessageController from "../controllers/QuickMessageController";
import { memoryUpload } from "../config/upload";

const routes = express.Router();

routes.get("/quick-messages/list", isAuth, QuickMessageController.findList);

routes.get("/quick-messages", isAuth, QuickMessageController.index);

routes.get("/quick-messages/:id", isAuth, QuickMessageController.show);

routes.post("/quick-messages", isAuth, QuickMessageController.store);

routes.put("/quick-messages/:id", isAuth, QuickMessageController.update);

routes.delete("/quick-messages/:id", isAuth, QuickMessageController.remove);

routes.post(
    "/quick-messages/:id/media-upload",
    isAuth,
    memoryUpload.array("file", 1),
    QuickMessageController.mediaUpload
  );
  
  routes.delete(
    "/quick-messages/:id/media-upload",
    isAuth,
    QuickMessageController.deleteMedia
  );
  
export default routes;
