import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";

import * as TicketTagController from "../controllers/TicketTagController";

const ticketTagRoutes = express.Router();

// Before /:ticketId/:tagId, otherwise "kanban" is read as a tagId.
ticketTagRoutes.put("/ticket-tags/:ticketId/kanban", isAuth, requirePlanFeature("useKanban"), TicketTagController.moveKanban);
ticketTagRoutes.put("/ticket-tags/:ticketId/:tagId", isAuth, TicketTagController.store);
ticketTagRoutes.delete("/ticket-tags/:ticketId", isAuth, TicketTagController.remove);

export default ticketTagRoutes;
