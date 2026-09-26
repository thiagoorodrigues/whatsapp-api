import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";

import * as CampaignSettingController from "../controllers/CampaignSettingController";
import multer from "multer";
import uploadConfig from "../config/upload";

// Campaigns (and their contact lists) are sold per plan.
const campaignsInPlan = requirePlanFeature("useCampaigns");

const upload = multer(uploadConfig);

const routes = express.Router();

routes.get("/campaign-settings", isAuth, campaignsInPlan, CampaignSettingController.index);

routes.post("/campaign-settings", isAuth, campaignsInPlan, CampaignSettingController.store);

export default routes;
