import express from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import { memoryUpload } from "../config/upload";
import * as FollowUpController from "../controllers/FollowUpController";

const followUpRoutes = express.Router();

followUpRoutes.get("/followup-rules", isAuth, isAdmin, FollowUpController.index);
followUpRoutes.post("/followup-rules", isAuth, isAdmin, FollowUpController.store);
// Before /:id, otherwise "media" is read as an id.
followUpRoutes.post("/followup-rules/media", isAuth, isAdmin, memoryUpload.single("file"), FollowUpController.uploadMedia);
followUpRoutes.get("/followup-rules/:id", isAuth, isAdmin, FollowUpController.show);
followUpRoutes.put("/followup-rules/:id", isAuth, isAdmin, FollowUpController.update);
followUpRoutes.delete("/followup-rules/:id", isAuth, isAdmin, FollowUpController.remove);
followUpRoutes.get("/followup-rules/:id/stats", isAuth, isAdmin, FollowUpController.stats);

followUpRoutes.get("/tickets/:ticketId/followup", isAuth, FollowUpController.ticketFollowUp);
followUpRoutes.delete("/tickets/:ticketId/followup", isAuth, FollowUpController.cancelTicketFollowUp);

export default followUpRoutes;
