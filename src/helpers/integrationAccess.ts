import AppError from "../errors/AppError";
import Company from "../models/Company";
import Plan from "../models/Plan";
import { getProvider, IntegrationProvider, sanitizeIntegrationKeys } from "../services/IntegrationServices/providers";

// Partner integrations the company's plan includes.
export const companyIntegrations = async (companyId: number): Promise<string[]> => {
  const company = await Company.findByPk(companyId, {
    include: [{ model: Plan, as: "plan", attributes: ["integrations"] }]
  });
  return sanitizeIntegrationKeys((company as any)?.plan?.integrations);
};

export const assertIntegration = async (companyId: number, key: string): Promise<IntegrationProvider> => {
  const provider = getProvider(key);
  if (!provider || !provider.isAvailable()) throw new AppError("ERR_INTEGRATION_NOT_FOUND", 404);
  if (!(await companyIntegrations(companyId)).includes(key)) {
    throw new AppError("ERR_INTEGRATION_NOT_AVAILABLE", 403);
  }
  return provider;
};
