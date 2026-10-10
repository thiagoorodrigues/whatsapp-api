import plamev from "./plamev";
import { IntegrationProvider } from "./types";

export * from "./types";

const PROVIDERS: IntegrationProvider[] = [plamev];

export const getProvider = (key: string): IntegrationProvider | undefined =>
  PROVIDERS.find(p => p.key === key);

export const availableProviders = (): IntegrationProvider[] => PROVIDERS.filter(p => p.isAvailable());

// Plan input -> known keys only, no duplicates. Unknown or non-array -> [].
export const sanitizeIntegrationKeys = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const known = new Set(PROVIDERS.map(p => p.key));
  return [...new Set(input.filter((k): k is string => typeof k === "string" && known.has(k)))];
};
