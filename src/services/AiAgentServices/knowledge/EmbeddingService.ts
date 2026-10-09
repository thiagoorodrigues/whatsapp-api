import AppError from "../../../errors/AppError";
import AiAgent from "../../../models/AiAgent";
import AiKnowledgeChunk from "../../../models/AiKnowledgeChunk";
import AiKnowledgeDocument from "../../../models/AiKnowledgeDocument";
import { logger } from "../../../utils/logger";
import { agentKey } from "../keys";
import { embedTexts, toVectorLiteral } from "./embeddings";

// Chunk vectors of the knowledge base, made with the agent's own key and
// embedding model. A failure here never blocks keyword search: the document
// stays "ready" and only its embeddingStatus says what happened.

const WRITE_BATCH = 50;

const clearVectors = (documentId: number) =>
  AiKnowledgeChunk.sequelize.query(`UPDATE "AiKnowledgeChunks" SET embedding = NULL WHERE "documentId" = :documentId`, {
    replacements: { documentId }
  });

const readableError = (err: unknown): string => {
  if (err instanceof AppError && err.message === "ERR_AI_KEY_UNREADABLE") {
    return "A chave do agente não pôde ser lida; informe-a de novo.";
  }
  return String((err as Error)?.message || err).slice(0, 400);
};

const currentModel = async (agentId: number) => (await AiAgent.findByPk(agentId))?.embeddingModel || null;

export const embedDocument = async (documentId: number): Promise<void> => {
  const document = await AiKnowledgeDocument.findByPk(documentId);
  if (!document || document.status !== "ready") return;
  const agent = await AiAgent.findByPk(document.agentId);
  const model = agent?.embeddingModel || null;

  if (!agent || !model) {
    await clearVectors(documentId);
    await document.update({ embeddingStatus: "none", embeddingModel: null, embeddingError: null });
    return;
  }

  await document.update({ embeddingStatus: "processing", embeddingError: null });
  try {
    const apiKey = agentKey(agent);
    if (!apiKey) throw new Error("O agente está sem chave de API.");
    const chunks = await AiKnowledgeChunk.findAll({
      where: { documentId },
      attributes: ["id", "content"],
      order: [["position", "ASC"]]
    });
    const vectors = await embedTexts(agent.provider, apiKey, model, chunks.map(c => c.content), "document");
    // The model changed while this ran: the run for the new model writes.
    if ((await currentModel(agent.id)) !== model) return;
    for (let i = 0; i < chunks.length; i += WRITE_BATCH) {
      // eslint-disable-next-line no-await-in-loop
      await AiKnowledgeChunk.sequelize.query(
        `UPDATE "AiKnowledgeChunks" c SET embedding = v.e::vector
         FROM (SELECT unnest(ARRAY[:ids]::int[]) AS id, unnest(ARRAY[:vectors]::text[]) AS e) v
         WHERE c.id = v.id`,
        {
          replacements: {
            ids: chunks.slice(i, i + WRITE_BATCH).map(c => c.id),
            vectors: vectors.slice(i, i + WRITE_BATCH).map(toVectorLiteral)
          }
        }
      );
    }
    await document.update({ embeddingStatus: "ready", embeddingModel: model, embeddingError: null });
  } catch (err) {
    logger.warn(`Knowledge document ${documentId} embeddings failed: ${err}`);
    if ((await currentModel(agent.id)) !== model) return;
    await clearVectors(documentId);
    await document.update({
      embeddingStatus: "error",
      embeddingModel: null,
      embeddingError: `Busca por significado falhou: ${readableError(err)}`
    });
  }
};

/** Vectors of every ready document of the agent, one document at a time. */
export const reembedAgent = async (agentId: number): Promise<void> => {
  const documents = await AiKnowledgeDocument.findAll({
    where: { agentId, status: "ready" },
    attributes: ["id"],
    order: [["id", "ASC"]]
  });
  if (!documents.length) return;
  await AiKnowledgeDocument.update({ embeddingStatus: "processing" } as any, {
    where: { id: documents.map(d => d.id) }
  });
  for (const d of documents) {
    // eslint-disable-next-line no-await-in-loop
    await embedDocument(d.id);
  }
};

export const reembedAgentLater = (agentId: number): void => {
  setImmediate(() => {
    reembedAgent(agentId).catch(err => logger.error(`Knowledge re-embedding of agent ${agentId}: ${err}`));
  });
};

/** At startup: vectors a restart left half-made. */
export const resumeEmbeddings = async (): Promise<void> => {
  const stuck = await AiKnowledgeDocument.findAll({
    where: { status: "ready", embeddingStatus: "processing" },
    attributes: ["id"],
    order: [["id", "ASC"]]
  });
  for (const d of stuck) {
    // eslint-disable-next-line no-await-in-loop
    await embedDocument(d.id);
  }
};
