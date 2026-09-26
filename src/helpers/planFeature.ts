import Company from "../models/Company";
import Plan from "../models/Plan";

export type PlanFeature =
  | "useCampaigns"
  | "useSchedules"
  | "useExternalApi"
  | "useKanban"
  | "useIntegrations"
  | "useFlowBuilder";

// Whether the company's plan includes a feature.
export const hasPlanFeature = async (companyId: number, feature: PlanFeature): Promise<boolean> => {
  const company = await Company.findByPk(companyId, {
    include: [{ model: Plan, as: "plan", attributes: [feature] }]
  });
  return !!(company as any)?.plan?.[feature];
};
