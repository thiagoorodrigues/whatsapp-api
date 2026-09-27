import { AiProvider, AiProviderName } from "../types";
import anthropicProvider from "./anthropic";
import openaiProvider from "./openai";
import geminiProvider from "./gemini";

export const PROVIDERS: Record<AiProviderName, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider
};

export const isProviderName = (value: unknown): value is AiProviderName =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, value);

export const getProvider = (name: string): AiProvider => {
  if (!isProviderName(name)) throw new Error(`Unknown AI provider: ${name}`);
  return PROVIDERS[name];
};
