import { getProvider } from "../providers";
import { EmbeddingKind } from "../types";

// Embedding models offered per provider. Every vector is stored with the
// same size, so one pgvector column serves all of them.

export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH = 100;

const MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "text-embedding-3-small", label: "OpenAI text-embedding-3-small (econômico)" },
    { id: "text-embedding-3-large", label: "OpenAI text-embedding-3-large (mais preciso)" }
  ],
  gemini: [{ id: "gemini-embedding-001", label: "Gemini gemini-embedding-001" }],
  anthropic: []
};

export const embeddingModelsFor = (provider: string) => MODELS[provider] || [];

/** First model of the provider (null for providers without embeddings). */
export const defaultEmbeddingModel = (provider: string): string | null => embeddingModelsFor(provider)[0]?.id || null;

export const isEmbeddingModelFor = (provider: string, model: unknown): model is string =>
  typeof model === "string" && embeddingModelsFor(provider).some(m => m.id === model);

/** Model after switching the agent's provider: off stays off; a model the new provider lacks becomes its default. */
export const nextEmbeddingModel = (current: string | null, provider: string): string | null => {
  if (!current) return null;
  return isEmbeddingModelFor(provider, current) ? current : defaultEmbeddingModel(provider);
};

// Reduced-size vectors (Gemini) are not unit length; cosine search wants them to be.
const normalize = (v: number[]) => {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm ? v.map(x => x / norm) : v;
};

export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

export const embedTexts = async (
  provider: string,
  apiKey: string,
  model: string,
  texts: string[],
  kind: EmbeddingKind
): Promise<number[][]> => {
  const { embed } = getProvider(provider);
  if (!embed || !isEmbeddingModelFor(provider, model)) {
    throw new Error(`Modelo de embedding indisponível: ${provider}/${model}`);
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH);
    // eslint-disable-next-line no-await-in-loop
    const vectors = await embed({ apiKey, model, texts: batch, kind, dimensions: EMBEDDING_DIMENSIONS });
    if (vectors.length !== batch.length || vectors.some(v => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error("O provedor devolveu vetores em formato inesperado.");
    }
    out.push(...vectors.map(normalize));
  }
  return out;
};
