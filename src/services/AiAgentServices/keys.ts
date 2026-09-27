import AppError from "../../errors/AppError";
import { decryptSecret, encryptSecret, secretHint } from "../../helpers/secretBox";
import { getProvider, isProviderName } from "./providers";

// Confirms a key with the provider (listing models) and returns what the
// agent stores.
export const validateKey = async (provider: string, apiKey: string) => {
  if (!isProviderName(provider)) throw new AppError("ERR_AI_PROVIDER_INVALID");
  const key = (apiKey || "").trim();
  if (key.length < 8) throw new AppError("ERR_AI_KEY_INVALID");
  try {
    await getProvider(provider).listModels(key);
  } catch (err) {
    throw new AppError("ERR_AI_KEY_REJECTED");
  }
  return { apiKeyEncrypted: encryptSecret(key), keyHint: secretHint(key) };
};

export const agentKey = (agent: { apiKeyEncrypted?: string | null }): string | null =>
  agent.apiKeyEncrypted ? decryptSecret(agent.apiKeyEncrypted) : null;

export const listModelsWithKey = async (provider: string, apiKey: string) => {
  if (!isProviderName(provider)) throw new AppError("ERR_AI_PROVIDER_INVALID");
  try {
    return await getProvider(provider).listModels(apiKey);
  } catch (err) {
    throw new AppError("ERR_AI_KEY_REJECTED");
  }
};
