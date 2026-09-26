import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";

import * as CampaignController from "../controllers/CampaignController";
import multer from "multer";
import uploadConfig from "../config/upload";

// Campaigns (and their contact lists) are sold per plan.
const campaignsInPlan = requirePlanFeature("useCampaigns");

const upload = multer(uploadConfig);

const routes = express.Router();

routes.get("/campaigns/list", isAuth, campaignsInPlan, CampaignController.findList);

routes.get("/campaigns", isAuth, campaignsInPlan, CampaignController.index);

routes.get("/campaigns/:id", isAuth, campaignsInPlan, CampaignController.show);

routes.post("/campaigns", isAuth, campaignsInPlan, CampaignController.store);

routes.put("/campaigns/:id", isAuth, campaignsInPlan, CampaignController.update);

routes.delete("/campaigns/:id", isAuth, campaignsInPlan, CampaignController.remove);

routes.post("/campaigns/:id/cancel", isAuth, campaignsInPlan, CampaignController.cancel);

routes.post("/campaigns/:id/restart", isAuth, campaignsInPlan, CampaignController.restart);

routes.post(
  "/campaigns/:id/media-upload",
  isAuth, campaignsInPlan,
  upload.array("file"),
  CampaignController.mediaUpload
);

routes.delete(
  "/campaigns/:id/media-upload",
  isAuth, campaignsInPlan,
  CampaignController.deleteMedia
);

export default routes;
