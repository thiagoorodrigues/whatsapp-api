import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";

import multer from "multer";
import * as AiAgentController from "../controllers/AiAgentController";
import * as AiKnowledgeController from "../controllers/AiKnowledgeController";

// Knowledge files are read in memory and only their text is kept.
const knowledgeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

// AI agents are sold per plan.
const aiInPlan = requirePlanFeature("useAiAgents");

const aiAgentRoutes = express.Router();

aiAgentRoutes.post("/ai-models/:provider", isAuth, aiInPlan, AiAgentController.models);

aiAgentRoutes.post("/ai-tools/http/test", isAuth, aiInPlan, AiAgentController.testHttpTool);
aiAgentRoutes.post("/ai-tools/mcp/probe", isAuth, aiInPlan, AiAgentController.probeMcp);
aiAgentRoutes.post("/ai-tools/mcp/oauth/start", isAuth, aiInPlan, AiAgentController.startMcpOAuth);
aiAgentRoutes.get("/ai-tools/mcp/oauth/status", isAuth, aiInPlan, AiAgentController.mcpOAuthStatus);
aiAgentRoutes.delete("/ai-tools/mcp/oauth/:serverId", isAuth, aiInPlan, AiAgentController.disconnectMcpOAuth);
// Public: reached by the provider's login page (validated by `state`).
aiAgentRoutes.get("/ai-tools/mcp/oauth/callback", AiAgentController.mcpOAuthCallback);

aiAgentRoutes.get("/ai-agents/runs", isAuth, aiInPlan, AiAgentController.runs);
aiAgentRoutes.get("/ai-agents", isAuth, aiInPlan, AiAgentController.index);
aiAgentRoutes.post("/ai-agents", isAuth, aiInPlan, AiAgentController.store);
aiAgentRoutes.get("/ai-agents/:agentId", isAuth, aiInPlan, AiAgentController.show);
aiAgentRoutes.put("/ai-agents/:agentId", isAuth, aiInPlan, AiAgentController.update);
aiAgentRoutes.delete("/ai-agents/:agentId", isAuth, aiInPlan, AiAgentController.remove);
aiAgentRoutes.put("/ai-agents/:agentId/connections", isAuth, aiInPlan, AiAgentController.connections);
aiAgentRoutes.post("/ai-agents/:agentId/test", isAuth, aiInPlan, AiAgentController.test);

aiAgentRoutes.get("/ai-agents/:agentId/knowledge", isAuth, aiInPlan, AiKnowledgeController.index);
aiAgentRoutes.post("/ai-agents/:agentId/knowledge", isAuth, aiInPlan, knowledgeUpload.single("file"), AiKnowledgeController.store);
aiAgentRoutes.put("/ai-agents/:agentId/knowledge/:documentId", isAuth, aiInPlan, AiKnowledgeController.update);
aiAgentRoutes.delete("/ai-agents/:agentId/knowledge/:documentId", isAuth, aiInPlan, AiKnowledgeController.remove);
aiAgentRoutes.post("/ai-agents/:agentId/knowledge/:documentId/reindex", isAuth, aiInPlan, AiKnowledgeController.reindex);
aiAgentRoutes.post("/ai-agents/:agentId/knowledge-search", isAuth, aiInPlan, AiKnowledgeController.search);

export default aiAgentRoutes;
