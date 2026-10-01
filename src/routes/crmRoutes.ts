import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";
import * as CrmController from "../controllers/CrmController";

// The CRM is sold per plan.
const crmInPlan = requirePlanFeature("useCrm");

const crmRoutes = express.Router();

crmRoutes.get("/crm/funnels", isAuth, crmInPlan, CrmController.listFunnelsHandler);
crmRoutes.post("/crm/funnels", isAuth, crmInPlan, CrmController.createFunnelHandler);
crmRoutes.put("/crm/funnels/:funnelId", isAuth, crmInPlan, CrmController.updateFunnelHandler);
crmRoutes.post("/crm/funnels/:funnelId/archive", isAuth, crmInPlan, CrmController.archiveFunnelHandler);
crmRoutes.post("/crm/funnels/:funnelId/stages", isAuth, crmInPlan, CrmController.createStageHandler);
// Before /stages/:stageId, otherwise "order" is read as a stageId.
crmRoutes.put("/crm/funnels/:funnelId/stages/order", isAuth, crmInPlan, CrmController.reorderStagesHandler);
crmRoutes.put("/crm/funnels/:funnelId/stages/:stageId", isAuth, crmInPlan, CrmController.updateStageHandler);
crmRoutes.delete("/crm/funnels/:funnelId/stages/:stageId", isAuth, crmInPlan, CrmController.deleteStageHandler);
crmRoutes.get("/crm/funnels/:funnelId/deals", isAuth, crmInPlan, CrmController.listDealsHandler);
crmRoutes.get("/crm/funnels/:funnelId/stats", isAuth, crmInPlan, CrmController.dealStatsHandler);

crmRoutes.post("/crm/deals", isAuth, crmInPlan, CrmController.createDealHandler);
crmRoutes.get("/crm/deals/:dealId", isAuth, crmInPlan, CrmController.showDealHandler);
crmRoutes.put("/crm/deals/:dealId", isAuth, crmInPlan, CrmController.updateDealHandler);
crmRoutes.put("/crm/deals/:dealId/move", isAuth, crmInPlan, CrmController.moveDealHandler);
crmRoutes.get("/crm/contacts/:contactId/deals", isAuth, crmInPlan, CrmController.contactDealsHandler);

crmRoutes.get("/crm/loss-reasons", isAuth, crmInPlan, CrmController.listLossReasonsHandler);
crmRoutes.post("/crm/loss-reasons", isAuth, crmInPlan, CrmController.createLossReasonHandler);
crmRoutes.put("/crm/loss-reasons/:id", isAuth, crmInPlan, CrmController.updateLossReasonHandler);

crmRoutes.get("/crm/rules", isAuth, crmInPlan, CrmController.listRulesHandler);
crmRoutes.post("/crm/rules", isAuth, crmInPlan, CrmController.createRuleHandler);
crmRoutes.put("/crm/rules/:id", isAuth, crmInPlan, CrmController.updateRuleHandler);
crmRoutes.delete("/crm/rules/:id", isAuth, crmInPlan, CrmController.deleteRuleHandler);

export default crmRoutes;
