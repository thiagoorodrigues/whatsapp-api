import AppError from "../../errors/AppError";
import { hasPlanFeature } from "../../helpers/planFeature";

export const isFlowBuilderEnabled = (companyId: number): Promise<boolean> =>
  hasPlanFeature(companyId, "useFlowBuilder");

// The chatbot is sold per plan: every flow endpoint checks it server side.
const assertFlowBuilderEnabled = async (companyId: number): Promise<void> => {
  if (!(await isFlowBuilderEnabled(companyId))) {
    throw new AppError("ERR_FLOW_BUILDER_NOT_IN_PLAN", 403);
  }
};

export default assertFlowBuilderEnabled;
