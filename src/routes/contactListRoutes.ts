import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";
import uploadConfig from "../config/upload";

import * as ContactListController from "../controllers/ContactListController";
import multer from "multer";

// Campaigns (and their contact lists) are sold per plan.
const campaignsInPlan = requirePlanFeature("useCampaigns");

const routes = express.Router();

const upload = multer(uploadConfig);

routes.get("/contact-lists/list", isAuth, campaignsInPlan, ContactListController.findList);

routes.get("/contact-lists", isAuth, campaignsInPlan, ContactListController.index);

routes.get("/contact-lists/:id", isAuth, campaignsInPlan, ContactListController.show);

routes.post("/contact-lists", isAuth, campaignsInPlan, ContactListController.store);

routes.post(
  "/contact-lists/:id/upload",
  isAuth, campaignsInPlan,
  upload.array("file"),
  ContactListController.upload
);

routes.put("/contact-lists/:id", isAuth, campaignsInPlan, ContactListController.update);

routes.delete("/contact-lists/:id", isAuth, campaignsInPlan, ContactListController.remove);

export default routes;
