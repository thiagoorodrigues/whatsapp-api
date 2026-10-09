import { getProvider } from "../providers";
import { EmbeddingKind } from "../types";

// Embedding models offered per provider. Every vector is stored with the
// same size, so one pgvector column serves all of them.

export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH = 100;

// minSimilarity: cosine similarity below which a chunk is not a match, so an
// off-topic question finds nothing. Calibrated on HM (2026-10-09): related
// questions scored 0.49–0.71, unrelated ones up to 0.29 (small) / 0.36 (large).
// Gemini has no calibration yet: null = no floor.
const MODELS: Record<string, { id: string; label: string; minSimilarity: number | null }[]> = {
  openai: [
    { id: "text-embedding-3-small", label: "OpenAI text-embedding-3-small (econômico)", minSimilarity: 0.3 },
    { id: "text-embedding-3-large", label: "OpenAI text-embedding-3-large (mais preciso)", minSimilarity: 0.37 }
  ],
  gemini: [{ id: "gemini-embedding-001", label: "Gemini gemini-embedding-001", minSimilarity: null }],
  anthropic: []
};

export const embeddingModelsFor = (provider: string) =>
  (MODELS[provider] || []).map(({ id, label }) => ({ id, label }));

export const minSimilarityFor = (model: string): number | null =>
  Object.values(MODELS)
    .flat()
    .find(m => m.id === model)?.minSimilarity ?? null;

/** First model of the provider (null for providers without embeddings). */
export const defaultEmbeddingModel = (provider: string): string | null => embeddingModelsFor(provider)[0]?.id || null;

export const isEmbeddingModelFor = (provider: string, model: unknown): model is string =>
  typeof model === "string" && embeddingModelsFor(provider).some(m => m.id === model);

/** Model after switching the agent's provider: off stays off; a model the new provider lacks becomes its default. */
export const nextEmbeddingModel = (current: string | null, provider: string): string | null => {
  if (!current) return null;
  return isEmbeddingModelFor(provider, current) ? current : defaultEmbeddingModel(provider);
};

/**
 * Embedding model after saving the agent, and whether its documents need
 * vectors again: a model change, or a new key (documents a missing or wrong
 * key left in error are retried; ones already done are skipped).
 */
export const embeddingAfterUpdate = (p: {
  previousProvider: string;
  previousModel: string | null;
  provider: string;
  keyChanged: boolean;
}): { model: string | null; reembed: boolean } => {
  const model = p.provider === p.previousProvider ? p.previousModel : nextEmbeddingModel(p.previousModel, p.provider);
  return { model, reembed: model !== p.previousModel || (p.keyChanged && !!model) };
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
