import * as Sentry from "@sentry/node";
import { Op, QueryTypes } from "sequelize";
import AppError from "../../../errors/AppError";
import AiKnowledgeChunk from "../../../models/AiKnowledgeChunk";
import AiKnowledgeDocument from "../../../models/AiKnowledgeDocument";
import { logger } from "../../../utils/logger";
import { findAgent } from "../AgentService";
import { agentKey } from "../keys";
import { chunkText } from "./chunk";
import { embedDocument, resumeEmbeddings } from "./EmbeddingService";
import { embedTexts, toVectorLiteral } from "./embeddings";
import { fuseRankings } from "./hybrid";
import { extractText } from "./extract";

// Knowledge base of an agent. Documents are split into chunks searched with
// Postgres full-text search (Portuguese, accents ignored); documents marked
// "always include" go whole into the agent's prompt instead.

export const MAX_DOCUMENT_CHARS = 2_000_000;
/** Total text of an agent's "always include" documents. */
export const MAX_ALWAYS_INCLUDE_CHARS = 30_000;
export const SEARCH_LIMIT = 5;

const LIST_ATTRIBUTES = [
  "id",
  "title",
  "description",
  "sourceType",
  "fileName",
  "mimeType",
  "status",
  "error",
  "alwaysInclude",
  "isActive",
  "charCount",
  "chunkCount",
  "embeddingModel",
  "embeddingStatus",
  "embeddingError",
  "createdAt",
  "updatedAt"
];

const documentOf = async (agentId: number, documentId: number | string, companyId: number) => {
  if (!/^\d+$/.test(String(documentId))) throw new AppError("ERR_AI_KNOWLEDGE_NOT_FOUND", 404);
  const document = await AiKnowledgeDocument.findOne({ where: { id: documentId, agentId, companyId } });
  if (!document) throw new AppError("ERR_AI_KNOWLEDGE_NOT_FOUND", 404);
  return document;
};

const titleOf = (value: unknown, fallback: string) =>
  (String(value || "").trim() || fallback).replace(/\s+/g, " ").slice(0, 200);

/** Splits the document's text into chunks (runs in the background). */
export const indexDocument = async (documentId: number): Promise<void> => {
  const document = await AiKnowledgeDocument.findByPk(documentId);
  if (!document?.content) return;
  try {
    await document.update({ status: "processing", error: null });
    const chunks = chunkText(document.content);
    await AiKnowledgeChunk.destroy({ where: { documentId } });
    for (let i = 0; i < chunks.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      await AiKnowledgeChunk.bulkCreate(
        chunks.slice(i, i + 200).map((content, index) => ({
          documentId,
          companyId: document.companyId,
          agentId: document.agentId,
          position: i + index,
          content
        })) as any
      );
    }
    await document.update({ status: "ready", chunkCount: chunks.length });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Knowledge document ${documentId} failed: ${err}`);
    await document.update({ status: "error", error: String((err as Error)?.message || err).slice(0, 500) });
  }
  // Outside the try: an embeddings failure must not mark the document as failed.
  await embedDocument(documentId).catch(err => logger.error(`Knowledge embeddings ${documentId}: ${err}`));
};

const indexLater = (documentId: number) => {
  setImmediate(() => {
    indexDocument(documentId).catch(err => logger.error(`Knowledge indexing ${documentId}: ${err}`));
  });
};

export const listDocuments = async (agentId: number | string, companyId: number) => {
  const agent = await findAgent(agentId, companyId);
  return AiKnowledgeDocument.findAll({
    where: { agentId: agent.id, companyId },
    attributes: LIST_ATTRIBUTES,
    order: [["createdAt", "DESC"]]
  });
};

const createDocument = async (
  agentId: number | string,
  companyId: number,
  values: { title: string; description?: string; sourceType: "file" | "text"; fileName?: string; mimeType?: string; text: string }
) => {
  const agent = await findAgent(agentId, companyId);
  const content = values.text.slice(0, MAX_DOCUMENT_CHARS);
  const document = await AiKnowledgeDocument.create({
    companyId,
    agentId: agent.id,
    title: values.title,
    description: values.description ? String(values.description).trim().slice(0, 500) : null,
    sourceType: values.sourceType,
    fileName: values.fileName || null,
    mimeType: values.mimeType || null,
    status: "processing",
    content,
    charCount: content.length
  } as any);
  indexLater(document.id);
  return AiKnowledgeDocument.findByPk(document.id, { attributes: LIST_ATTRIBUTES });
};

export const createFromFile = async (
  agentId: number | string,
  companyId: number,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  meta: { title?: string; description?: string }
) => {
  const text = await extractText(file.buffer, file.originalname);
  return createDocument(agentId, companyId, {
    title: titleOf(meta.title, file.originalname.replace(/\.[^.]+$/, "")),
    description: meta.description,
    sourceType: "file",
    fileName: file.originalname.slice(0, 300),
    mimeType: file.mimetype,
    text
  });
};

export const createFromText = async (
  agentId: number | string,
  companyId: number,
  data: { title?: string; description?: string; text?: string }
) => {
  const text = String(data.text || "").trim();
  if (!text) throw new AppError("ERR_AI_KNOWLEDGE_EMPTY");
  return createDocument(agentId, companyId, {
    title: titleOf(data.title, "Texto"),
    description: data.description,
    sourceType: "text",
    text
  });
};

export const updateDocument = async (
  agentId: number | string,
  documentId: number | string,
  companyId: number,
  data: { title?: string; description?: string; alwaysInclude?: boolean; isActive?: boolean; text?: string }
) => {
  const agent = await findAgent(agentId, companyId);
  const document = await documentOf(agent.id, documentId, companyId);
  const values: Record<string, unknown> = {};

  if (data.title !== undefined) values.title = titleOf(data.title, document.title);
  if (data.description !== undefined) values.description = String(data.description || "").trim().slice(0, 500) || null;
  if (data.isActive !== undefined) values.isActive = !!data.isActive;

  let reindex = false;
  if (data.text !== undefined && document.sourceType === "text") {
    const text = String(data.text).trim().slice(0, MAX_DOCUMENT_CHARS);
    if (!text) throw new AppError("ERR_AI_KNOWLEDGE_EMPTY");
    Object.assign(values, { content: text, charCount: text.length, status: "processing" });
    reindex = true;
  }

  if (data.alwaysInclude !== undefined) {
    const always = !!data.alwaysInclude;
    if (always && !document.alwaysInclude) {
      const others: number =
        (await AiKnowledgeDocument.sum("charCount", {
          where: { agentId: agent.id, companyId, alwaysInclude: true, id: { [Op.ne]: document.id } }
        })) || 0;
      const size = Number(values.charCount ?? document.charCount);
      if (others + size > MAX_ALWAYS_INCLUDE_CHARS) throw new AppError("ERR_AI_KNOWLEDGE_ALWAYS_LIMIT");
    }
    values.alwaysInclude = always;
  }

  await document.update(values);
  if (reindex) indexLater(document.id);
  return AiKnowledgeDocument.findByPk(document.id, { attributes: LIST_ATTRIBUTES });
};

export const deleteDocument = async (agentId: number | string, documentId: number | string, companyId: number) => {
  const agent = await findAgent(agentId, companyId);
  const document = await documentOf(agent.id, documentId, companyId);
  await document.destroy();
};

export const reindexDocument = async (agentId: number | string, documentId: number | string, companyId: number) => {
  const agent = await findAgent(agentId, companyId);
  const document = await documentOf(agent.id, documentId, companyId);
  await document.update({ status: "processing", error: null });
  indexLater(document.id);
  return AiKnowledgeDocument.findByPk(document.id, { attributes: LIST_ATTRIBUTES });
};

export interface KnowledgeHit {
  chunkId: number;
  documentId: number;
  title: string;
  description: string | null;
  content: string;
  rank: number;
}

export interface SearchAgent {
  id: number;
  companyId: number;
  provider: string;
  embeddingModel: string | null;
  apiKeyEncrypted?: string | null;
}

/** Candidates taken from each search before fusing them. */
export const SEARCH_CANDIDATES = 20;

// Any of the question's words counts (OR), ranked by how many match and how
// close together.
const keywordHits = (agent: SearchAgent, text: string, limit: number) =>
  AiKnowledgeChunk.sequelize.query<KnowledgeHit>(
    `
    WITH q AS (
      SELECT to_tsquery('portuguese', string_agg(quote_literal(lexeme), ' | ')) AS query
      FROM unnest(to_tsvector('portuguese', ai_unaccent(:text)))
    )
    SELECT c.id AS "chunkId", c."documentId", d.title, d.description, c.content,
           ts_rank_cd(c."searchVector", q.query) AS rank
    FROM "AiKnowledgeChunks" c
    JOIN "AiKnowledgeDocuments" d ON d.id = c."documentId"
    CROSS JOIN q
    WHERE q.query IS NOT NULL
      AND c."agentId" = :agentId AND c."companyId" = :companyId
      AND d."isActive" AND d.status = 'ready' AND NOT d."alwaysInclude"
      AND c."searchVector" @@ q.query
    ORDER BY rank DESC, c."documentId", c.position
    LIMIT :limit
    `,
    { replacements: { text, agentId: agent.id, companyId: agent.companyId, limit }, type: QueryTypes.SELECT }
  );

// Nearest chunks by cosine distance, only among documents embedded with the
// agent's current model (others are being redone and count by keywords).
// Exact search over the agent's chunks: no approximate index, see the spec.
const semanticHits = async (agent: SearchAgent, text: string, limit: number) => {
  const apiKey = agentKey(agent);
  if (!apiKey || !agent.embeddingModel) return [];
  const [vector] = await embedTexts(agent.provider, apiKey, agent.embeddingModel, [text], "query");
  return AiKnowledgeChunk.sequelize.query<KnowledgeHit>(
    `
    SELECT c.id AS "chunkId", c."documentId", d.title, d.description, c.content,
           1 - (c.embedding <=> CAST(:vector AS vector)) AS rank
    FROM "AiKnowledgeChunks" c
    JOIN "AiKnowledgeDocuments" d ON d.id = c."documentId"
    WHERE c."agentId" = :agentId AND c."companyId" = :companyId
      AND d."isActive" AND d.status = 'ready' AND NOT d."alwaysInclude"
      AND d."embeddingModel" = :model AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> CAST(:vector AS vector)
    LIMIT :limit
    `,
    {
      replacements: {
        vector: toVectorLiteral(vector),
        model: agent.embeddingModel,
        agentId: agent.id,
        companyId: agent.companyId,
        limit
      },
      type: QueryTypes.SELECT
    }
  );
};

/**
 * Chunks that best answer the question: keyword search, plus search by
 * meaning when the agent has an embedding model, fused by rank. "Always
 * include" documents are left out (they are already in the prompt).
 */
export const searchKnowledge = async (agent: SearchAgent, query: string, limit = SEARCH_LIMIT): Promise<KnowledgeHit[]> => {
  const text = String(query || "").trim().slice(0, 500);
  if (!text) return [];
  const keyword = await keywordHits(agent, text, SEARCH_CANDIDATES);
  if (!agent.embeddingModel) return keyword.slice(0, limit);
  let semantic: KnowledgeHit[] = [];
  try {
    semantic = await semanticHits(agent, text, SEARCH_CANDIDATES);
  } catch (err) {
    logger.warn(`Knowledge semantic search of agent ${agent.id} failed, keywords only: ${err}`);
  }
  return fuseRankings([keyword, semantic], limit);
};

export interface KnowledgeForTurn {
  /** Text of the "always include" documents, for the prompt. */
  alwaysIncluded: { title: string; description: string | null; content: string }[];
  /** There are documents to search (enables the search tool). */
  searchable: boolean;
}

export const knowledgeForTurn = async (agentId: number, companyId: number): Promise<KnowledgeForTurn> => {
  const documents = await AiKnowledgeDocument.findAll({
    where: { agentId, companyId, isActive: true, status: "ready" },
    attributes: ["title", "description", "alwaysInclude", "content"]
  });
  return {
    alwaysIncluded: documents
      .filter(d => d.alwaysInclude)
      .map(d => ({ title: d.title, description: d.description, content: d.content || "" })),
    searchable: documents.some(d => !d.alwaysInclude)
  };
};

/** At startup: documents left half-processed by a restart are indexed again. */
export const resumeInterruptedIndexing = async (): Promise<void> => {
  const stuck = await AiKnowledgeDocument.findAll({
    where: { status: { [Op.in]: ["pending", "processing"] } },
    attributes: ["id"]
  });
  stuck.forEach(d => indexLater(d.id));
  setImmediate(() => {
    resumeEmbeddings().catch(err => logger.error(`Knowledge embeddings resume failed: ${err}`));
  });
};
