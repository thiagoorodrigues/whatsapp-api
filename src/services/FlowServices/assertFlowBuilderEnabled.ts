import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import Plan from "../../models/Plan";

export const isFlowBuilderEnabled = async (companyId: number): Promise<boolean> => {
  const company = await Company.findByPk(companyId, {
    include: [{ model: Plan, as: "plan", attributes: ["useFlowBuilder"] }]
  });
  return !!(company as any)?.plan?.useFlowBuilder;
};

// The chatbot is sold per plan: every flow endpoint checks it server side.
const assertFlowBuilderEnabled = async (companyId: number): Promise<void> => {
  if (!(await isFlowBuilderEnabled(companyId))) {
    throw new AppError("ERR_FLOW_BUILDER_NOT_IN_PLAN", 403);
  }
};

export default assertFlowBuilderEnabled;
