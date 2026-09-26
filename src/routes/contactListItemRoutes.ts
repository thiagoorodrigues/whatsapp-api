import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";

import * as ContactListItemController from "../controllers/ContactListItemController";

// Campaigns (and their contact lists) are sold per plan.
const campaignsInPlan = requirePlanFeature("useCampaigns");

const routes = express.Router();

routes.get(
  "/contact-list-items/list",
  isAuth, campaignsInPlan,
  ContactListItemController.findList
);

routes.get("/contact-list-items", isAuth, campaignsInPlan, ContactListItemController.index);

routes.get("/contact-list-items/:id", isAuth, campaignsInPlan, ContactListItemController.show);

routes.post("/contact-list-items", isAuth, campaignsInPlan, ContactListItemController.store);

routes.put("/contact-list-items/:id", isAuth, campaignsInPlan, ContactListItemController.update);

routes.delete(
  "/contact-list-items/:id",
  isAuth, campaignsInPlan,
  ContactListItemController.remove
);

export default routes;
