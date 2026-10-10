import AppError from "../../errors/AppError";
import Plan from "../../models/Plan";
import { sanitizeIntegrationKeys } from "../IntegrationServices/providers";

interface PlanData {
  name: string;
  id?: number | string;
  users?: number;
  connections?: number;
  queues?: number;
  value?: number;
  useCampaigns?: boolean;
  useSchedules?: boolean;
  useExternalApi?: boolean;
  useKanban?: boolean;
  useIntegrations?: boolean;
  useFlowBuilder?: boolean;
  useAiAgents?: boolean;
  useCrm?: boolean;
  crmFunnels?: number;
  integrations?: string[];
}

const UpdatePlanService = async (planData: PlanData): Promise<Plan> => {
  const { id, name, users, connections, queues, value } = planData;

  const plan = await Plan.findByPk(id);

  if (!plan) {
    throw new AppError("ERR_NO_PLAN_FOUND", 404);
  }

  const data = planData.integrations === undefined
    ? planData
    : { ...planData, integrations: sanitizeIntegrationKeys(planData.integrations) };
  await plan.update(data);

  return plan;
};

export default UpdatePlanService;
