# Busca por significado na base de conhecimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A base de conhecimento dos agentes passa a buscar por significado (embeddings no pgvector) combinado com a busca por palavras atual, usando a chave do agente e um modelo escolhido na tela.

**Architecture:** Os trechos (`AiKnowledgeChunks`) ganham uma coluna `vector(1536)`. Cada provedor com embeddings (OpenAI, Gemini) implementa `embed`; um módulo `embeddings.ts` concentra catálogo de modelos, lotes e normalização. A indexação gera os vetores depois de dividir o documento (`EmbeddingService`); a busca roda palavras + vetor e junta por RRF (`hybrid.ts`). Trocar o modelo (aba Base de conhecimento) ou o provedor (editor) reprocessa os documentos em segundo plano.

**Tech Stack:** Node 24 + TypeScript, Sequelize (sequelize-typescript), Postgres 18 com pgvector 0.8.6, SDKs `openai` e `@google/genai`, Jest; front React (CRA) + Material UI v4.

**Spec:** `docs/superpowers/specs/2026-10-09-busca-por-significado-design.md`

Repos: `whatsapp-api` = `/Users/thiagorodrigues/Projetos/weconex/whatsapp-api`, `whatsapp-app` = `/Users/thiagorodrigues/Projetos/weconex/whatsapp-app`. Ambos na branch `main` local; **não dar push** (push na main = deploy em produção).

## Global Constraints

- Todos os vetores têm **1536 dimensões** (`EMBEDDING_DIMENSIONS = 1536`).
- Modelos: openai `text-embedding-3-small` (padrão) e `text-embedding-3-large`; gemini `gemini-embedding-001` (padrão); anthropic nenhum.
- Gemini: `taskType` `RETRIEVAL_DOCUMENT` para trechos e `RETRIEVAL_QUERY` para a pergunta; todo vetor é normalizado na API.
- Lotes de até 100 textos por chamada de embedding.
- Sem índice HNSW: distância exata filtrada por `agentId`.
- RRF com `k = 60`; 20 candidatos de cada lista; 5 resultados finais (`SEARCH_LIMIT`).
- Falha de embedding nunca quebra a busca nem a indexação: cai para busca por palavras.
- Agentes novos OpenAI/Gemini nascem com o modelo padrão; agentes existentes ficam com `embeddingModel = NULL` (desligado).
- Textos da tela em português do Brasil; traduções só em `pt.js`.
- Comentários de código em inglês, curtos, como no restante do código.

## Review Focus

1. **Troca de modelo durante um reprocessamento** — duas trocas seguidas (A→B) não podem deixar documentos marcados com o modelo A. Teste em Task 4 (`embedDocument` descarta o resultado quando o modelo do agente mudou).
2. **Chave do agente ausente ou ilegível** (provedor trocado sem chave nova, `SECRETS_KEY` diferente) — o documento fica `ready` para palavras, com `embeddingStatus = error` e mensagem legível. Teste em Task 4.
3. **Agente Claude** — `searchKnowledge` nunca chama embeddings e a rota de configuração recusa qualquer modelo. Testes em Task 2 (`isEmbeddingModelFor`) e Task 5.
4. **Documento sem trechos ou desativado** — `embedDocument` com zero trechos marca `ready` sem chamar o provedor; documentos inativos são ignorados pela busca. Teste em Task 4.
5. **Provedor responde com quantidade/dimensão errada** — `embedTexts` lança erro em vez de gravar vetor torto. Teste em Task 2.

---

## File Structure

whatsapp-api:
- Create `src/database/migrations/20261009150000-add-embeddings-to-ai-knowledge.ts` — colunas novas.
- Modify `src/models/AiAgent.ts` — `embeddingModel`.
- Modify `src/models/AiKnowledgeDocument.ts` — `embeddingModel`, `embeddingStatus`, `embeddingError`.
- Modify `src/services/AiAgentServices/types.ts` — `EmbedRequest`, `AiProvider.embed?`.
- Modify `src/services/AiAgentServices/providers/openai.ts`, `providers/gemini.ts` — `embed`.
- Create `src/services/AiAgentServices/knowledge/embeddings.ts` — catálogo, `embedTexts`, `nextEmbeddingModel`.
- Create `src/services/AiAgentServices/knowledge/hybrid.ts` — `fuseRankings`.
- Create `src/services/AiAgentServices/knowledge/EmbeddingService.ts` — `embedDocument`, `reembedAgent(Later)`, `resumeEmbeddings`.
- Modify `src/services/AiAgentServices/knowledge/KnowledgeService.ts` — indexação chama embeddings, busca híbrida, configurações.
- Modify `src/services/AiAgentServices/AgentService.ts` — padrão na criação, troca de provedor.
- Modify `src/services/AiAgentServices/generateReply.ts`, `tools.ts` — nova assinatura e descrição da ferramenta.
- Modify `src/controllers/AiKnowledgeController.ts`, `src/routes/aiAgentRoutes.ts` — rota `knowledge-settings`.
- Tests em `src/services/AiAgentServices/knowledge/__tests__/` e `src/services/AiAgentServices/__tests__/tools.spec.ts`.

whatsapp-app:
- Create `src/pages/AiAgents/knowledgeEmbedding.js` + `knowledgeEmbedding.test.js` — selo do documento.
- Modify `src/pages/AiAgents/KnowledgeBase.js` — seletor, aviso, selos, polling.
- Modify `src/pages/AiAgents/Editor.js` — aviso ao trocar provedor.
- Modify `src/translate/languages/pt.js` — `ERR_AI_EMBEDDING_MODEL_INVALID`.

---

### Task 1: Migration e modelos

**Files:**
- Create: `whatsapp-api/src/database/migrations/20261009150000-add-embeddings-to-ai-knowledge.ts`
- Modify: `whatsapp-api/src/models/AiAgent.ts` (depois de `temperature`)
- Modify: `whatsapp-api/src/models/AiKnowledgeDocument.ts` (depois de `chunkCount`)

**Interfaces:**
- Produces: `AiAgent.embeddingModel: string | null`; `AiKnowledgeDocument.embeddingModel: string | null`, `.embeddingStatus: EmbeddingStatus`, `.embeddingError: string | null`; tipo exportado `EmbeddingStatus = "none" | "processing" | "ready" | "error"`; coluna SQL `AiKnowledgeChunks.embedding vector(1536)` (fora do model Sequelize — lida e gravada só por SQL).

- [ ] **Step 1: Criar a migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Semantic search in the knowledge base: chunk vectors (pgvector, enabled by
// 20260928020000) and which embedding model each agent/document uses.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "embeddingModel", { type: DataTypes.STRING, allowNull: true });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingModel", { type: DataTypes.STRING, allowNull: true });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingStatus", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "none"
    });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingError", { type: DataTypes.TEXT, allowNull: true });
    await queryInterface.sequelize.query(`ALTER TABLE "AiKnowledgeChunks" ADD COLUMN embedding vector(1536)`);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`ALTER TABLE "AiKnowledgeChunks" DROP COLUMN embedding`);
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingError");
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingStatus");
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingModel");
    await queryInterface.removeColumn("AiAgents", "embeddingModel");
  }
};
```

- [ ] **Step 2: Coluna no `AiAgent`** — inserir depois do bloco `temperature`:

```ts
  // Embedding model of the knowledge base's semantic search; null = off
  // (keyword search only). See knowledge/embeddings.ts.
  @Column
  embeddingModel: string | null;
```

- [ ] **Step 3: Colunas no `AiKnowledgeDocument`** — exportar o tipo ao lado de `KnowledgeStatus` e inserir depois de `chunkCount`:

```ts
export type EmbeddingStatus = "none" | "processing" | "ready" | "error";
```

```ts
  // Model that produced the current chunk vectors (null = none).
  @Column
  embeddingModel: string | null;

  @Default("none")
  @Column
  embeddingStatus: EmbeddingStatus;

  @Column(DataType.TEXT)
  embeddingError: string | null;
```

- [ ] **Step 4: Rodar a migration no HM e conferir**

Run (em `whatsapp-api`): `npm run build && npx sequelize db:migrate`
Expected: `20261009150000-add-embeddings-to-ai-knowledge: migrated`.
Conferir: `docker exec whatsapp-api-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d \"AiKnowledgeChunks\""'` mostra `embedding | vector(1536)`.

(Se o HM rodar a api em container que migra ao subir, usar o fluxo do HM: build + migrate + restart — ver memória weconex-hm-deploy.)

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/20261009150000-add-embeddings-to-ai-knowledge.ts src/models/AiAgent.ts src/models/AiKnowledgeDocument.ts
git commit -m "Base de conhecimento: colunas de embeddings"
```

---

### Task 2: Embeddings nos provedores e catálogo de modelos

**Files:**
- Modify: `whatsapp-api/src/services/AiAgentServices/types.ts`
- Modify: `whatsapp-api/src/services/AiAgentServices/providers/openai.ts`
- Modify: `whatsapp-api/src/services/AiAgentServices/providers/gemini.ts`
- Create: `whatsapp-api/src/services/AiAgentServices/knowledge/embeddings.ts`
- Test: `whatsapp-api/src/services/AiAgentServices/knowledge/__tests__/embeddings.spec.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type EmbeddingKind = "document" | "query"`; `interface EmbedRequest { apiKey: string; model: string; texts: string[]; kind: EmbeddingKind; dimensions: number }`; `AiProvider.embed?: (req: EmbedRequest) => Promise<number[][]>`.
  - `embeddings.ts`: `EMBEDDING_DIMENSIONS = 1536`; `EMBEDDING_BATCH = 100`; `embeddingModelsFor(provider: string): { id: string; label: string }[]`; `defaultEmbeddingModel(provider: string): string | null`; `isEmbeddingModelFor(provider: string, model: unknown): model is string`; `toVectorLiteral(v: number[]): string`; `embedTexts(provider: string, apiKey: string, model: string, texts: string[], kind: EmbeddingKind): Promise<number[][]>`; `nextEmbeddingModel(current: string | null, provider: string): string | null`.

- [ ] **Step 1: Escrever os testes**

```ts
const embed = jest.fn();
jest.mock("../../providers", () => ({
  getProvider: (name: string) => (name === "anthropic" ? { name } : { name, embed: (...a: any[]) => embed(...a) })
}));

// eslint-disable-next-line import/first
import {
  defaultEmbeddingModel,
  embedTexts,
  isEmbeddingModelFor,
  nextEmbeddingModel,
  toVectorLiteral
} from "../embeddings";

const vector = (value: number) => Array.from({ length: 1536 }, () => value);

describe("embedding models", () => {
  it("offers models per provider and none for Claude", () => {
    expect(defaultEmbeddingModel("openai")).toBe("text-embedding-3-small");
    expect(defaultEmbeddingModel("gemini")).toBe("gemini-embedding-001");
    expect(defaultEmbeddingModel("anthropic")).toBeNull();
    expect(isEmbeddingModelFor("openai", "text-embedding-3-large")).toBe(true);
    expect(isEmbeddingModelFor("gemini", "text-embedding-3-small")).toBe(false);
    expect(isEmbeddingModelFor("anthropic", "text-embedding-3-small")).toBe(false);
    expect(isEmbeddingModelFor("openai", null)).toBe(false);
  });

  it("keeps the model on provider change only when the new provider has it", () => {
    expect(nextEmbeddingModel(null, "openai")).toBeNull();
    expect(nextEmbeddingModel("text-embedding-3-large", "openai")).toBe("text-embedding-3-large");
    expect(nextEmbeddingModel("text-embedding-3-large", "gemini")).toBe("gemini-embedding-001");
    expect(nextEmbeddingModel("gemini-embedding-001", "anthropic")).toBeNull();
  });
});

describe("embedTexts", () => {
  it("sends batches of 100 with 1536 dimensions and normalizes the vectors", async () => {
    embed.mockImplementation(async (req: any) => req.texts.map(() => vector(2)));
    const texts = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const out = await embedTexts("openai", "k", "text-embedding-3-small", texts, "document");
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0][0]).toMatchObject({ apiKey: "k", model: "text-embedding-3-small", kind: "document", dimensions: 1536 });
    expect(embed.mock.calls[0][0].texts).toHaveLength(100);
    expect(embed.mock.calls[1][0].texts).toHaveLength(50);
    expect(out).toHaveLength(150);
    const norm = Math.sqrt(out[0].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("returns nothing for no texts without calling the provider", async () => {
    expect(await embedTexts("openai", "k", "text-embedding-3-small", [], "document")).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("rejects a provider without embeddings or a model of another provider", async () => {
    await expect(embedTexts("anthropic", "k", "text-embedding-3-small", ["a"], "query")).rejects.toThrow();
    await expect(embedTexts("gemini", "k", "text-embedding-3-small", ["a"], "query")).rejects.toThrow();
  });

  it("rejects a reply with the wrong count or size", async () => {
    embed.mockResolvedValueOnce([vector(1)]);
    await expect(embedTexts("openai", "k", "text-embedding-3-small", ["a", "b"], "document")).rejects.toThrow();
    embed.mockResolvedValueOnce([[1, 2, 3]]);
    await expect(embedTexts("openai", "k", "text-embedding-3-small", ["a"], "document")).rejects.toThrow();
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe("[0.5,-1,0]");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/embeddings.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../embeddings'`.

- [ ] **Step 3: Tipos** — em `types.ts`, antes de `export interface AiProvider`:

```ts
export type EmbeddingKind = "document" | "query";

export interface EmbedRequest {
  apiKey: string;
  model: string;
  texts: string[];
  // Gemini tunes vectors for documents vs. questions; OpenAI ignores it.
  kind: EmbeddingKind;
  dimensions: number;
}
```

e em `AiProvider` acrescentar:

```ts
  // Text embeddings (knowledge base semantic search); absent = not offered.
  embed?: (request: EmbedRequest) => Promise<number[][]>;
```

- [ ] **Step 4: OpenAI** — em `providers/openai.ts`, importar `EmbedRequest` de `../types` e adicionar antes de `const openaiProvider`:

```ts
const embed = async (req: EmbedRequest): Promise<number[][]> => {
  const client = new OpenAI({ apiKey: req.apiKey, timeout: 60_000, maxRetries: 2 });
  const response = await client.embeddings.create({ model: req.model, input: req.texts, dimensions: req.dimensions });
  return [...response.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
};
```

e trocar a exportação por `const openaiProvider: AiProvider = { name: "openai", runTurn, listModels, embed };`.

- [ ] **Step 5: Gemini** — em `providers/gemini.ts`, importar `EmbedRequest` de `../types` e adicionar antes de `const geminiProvider`:

```ts
const embed = async (req: EmbedRequest): Promise<number[][]> => {
  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const response = await ai.models.embedContent({
    model: req.model,
    contents: req.texts,
    config: {
      outputDimensionality: req.dimensions,
      taskType: req.kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT"
    }
  });
  return (response.embeddings || []).map(e => e.values || []);
};
```

e trocar a exportação por `const geminiProvider: AiProvider = { name: "gemini", runTurn, listModels, embed };`.

- [ ] **Step 6: Criar `knowledge/embeddings.ts`**

```ts
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
```

- [ ] **Step 7: Rodar os testes**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/embeddings.spec.ts --coverage=false`
Expected: PASS (7 testes).
Run também: `npx tsc --noEmit -p .` — Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/services/AiAgentServices/types.ts src/services/AiAgentServices/providers/openai.ts src/services/AiAgentServices/providers/gemini.ts src/services/AiAgentServices/knowledge/embeddings.ts src/services/AiAgentServices/knowledge/__tests__/embeddings.spec.ts
git commit -m "Embeddings nos provedores OpenAI e Gemini"
```

---

### Task 3: Fusão dos rankings (RRF)

**Files:**
- Create: `whatsapp-api/src/services/AiAgentServices/knowledge/hybrid.ts`
- Test: `whatsapp-api/src/services/AiAgentServices/knowledge/__tests__/hybrid.spec.ts`

**Interfaces:**
- Produces: `RRF_K = 60`; `fuseRankings<T extends { chunkId: number }>(lists: T[][], limit: number, k?: number): T[]`.

- [ ] **Step 1: Escrever os testes**

```ts
import { fuseRankings } from "../hybrid";

const hit = (chunkId: number) => ({ chunkId, content: `c${chunkId}` });

describe("fuseRankings", () => {
  it("puts a chunk found by both searches first", () => {
    const keyword = [hit(1), hit(2)];
    const semantic = [hit(3), hit(1)];
    expect(fuseRankings([keyword, semantic], 5).map(h => h.chunkId)).toEqual([1, 3, 2]);
  });

  it("breaks ties by the order the chunks were first seen (keyword list first)", () => {
    expect(fuseRankings([[hit(1)], [hit(2)]], 5).map(h => h.chunkId)).toEqual([1, 2]);
  });

  it("returns one list as is when the other is empty", () => {
    expect(fuseRankings([[hit(4), hit(5)], []], 5).map(h => h.chunkId)).toEqual([4, 5]);
    expect(fuseRankings([[], []], 5)).toEqual([]);
  });

  it("cuts at the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(i + 1));
    expect(fuseRankings([many], 5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/hybrid.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../hybrid'`.

- [ ] **Step 3: Implementar**

```ts
// Reciprocal Rank Fusion: each list adds 1 / (k + position) to a chunk, so
// chunks found by both keyword and semantic search rise to the top without
// comparing their raw scores (which are on different scales).

export const RRF_K = 60;

export const fuseRankings = <T extends { chunkId: number }>(lists: T[][], limit: number, k = RRF_K): T[] => {
  const scores = new Map<number, { item: T; score: number; seen: number }>();
  let seen = 0;
  lists.forEach(list =>
    list.forEach((item, index) => {
      const add = 1 / (k + index + 1);
      const entry = scores.get(item.chunkId);
      if (entry) {
        entry.score += add;
      } else {
        scores.set(item.chunkId, { item, score: add, seen });
        seen += 1;
      }
    })
  );
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.seen - b.seen)
    .slice(0, limit)
    .map(e => e.item);
};
```

- [ ] **Step 4: Rodar os testes**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/hybrid.spec.ts --coverage=false`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/services/AiAgentServices/knowledge/hybrid.ts src/services/AiAgentServices/knowledge/__tests__/hybrid.spec.ts
git commit -m "Base de conhecimento: fusão RRF dos rankings"
```

---

### Task 4: Gerar vetores dos documentos

**Files:**
- Create: `whatsapp-api/src/services/AiAgentServices/knowledge/EmbeddingService.ts`
- Modify: `whatsapp-api/src/services/AiAgentServices/knowledge/KnowledgeService.ts` (`LIST_ATTRIBUTES`, `indexDocument`, `resumeInterruptedIndexing`)
- Test: `whatsapp-api/src/services/AiAgentServices/knowledge/__tests__/EmbeddingService.spec.ts`

**Interfaces:**
- Consumes: `embedTexts`, `toVectorLiteral` (Task 2); `agentKey(agent): string | null` de `../keys` (existente; lança `AppError("ERR_AI_KEY_UNREADABLE")`); colunas da Task 1.
- Produces: `embedDocument(documentId: number): Promise<void>`; `reembedAgent(agentId: number): Promise<void>`; `reembedAgentLater(agentId: number): void`; `resumeEmbeddings(): Promise<void>`.
- **Não** importar `AgentService` aqui (AgentService importa este módulo — evitar ciclo).

- [ ] **Step 1: Escrever os testes**

```ts
const query = jest.fn(async (..._a: any[]) => [] as any);
const chunkFindAll = jest.fn();
jest.mock("../../../../models/AiKnowledgeChunk", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => chunkFindAll(...a), sequelize: { query: (...a: any[]) => query(...a) } }
}));
const documentFindByPk = jest.fn();
jest.mock("../../../../models/AiKnowledgeDocument", () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => documentFindByPk(...a), findAll: jest.fn(async () => []), update: jest.fn() }
}));
const agentFindByPk = jest.fn();
jest.mock("../../../../models/AiAgent", () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => agentFindByPk(...a) }
}));
const agentKey = jest.fn((..._a: any[]) => "k" as string | null);
jest.mock("../../keys", () => ({ agentKey: (...a: any[]) => agentKey(...a) }));
const embedTexts = jest.fn();
jest.mock("../embeddings", () => ({
  ...jest.requireActual("../embeddings"),
  embedTexts: (...a: any[]) => embedTexts(...a)
}));

// eslint-disable-next-line import/first
import { embedDocument } from "../EmbeddingService";

const makeDocument = () => {
  const doc: any = { id: 9, agentId: 3, status: "ready" };
  doc.update = jest.fn(async (values: any) => Object.assign(doc, values));
  return doc;
};
const agentWith = (embeddingModel: string | null) => ({ id: 3, provider: "openai", embeddingModel, apiKeyEncrypted: "x" });

describe("embedDocument", () => {
  it("stores the vectors and marks the document ready with the model", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }, { id: 2, content: "b" }]);
    embedTexts.mockResolvedValue([[0.1], [0.2]]);

    await embedDocument(9);

    expect(embedTexts).toHaveBeenCalledWith("openai", "k", "text-embedding-3-small", ["a", "b"], "document");
    const update = query.mock.calls.find(c => String(c[0]).includes("SET embedding = v.e::vector"));
    expect(update[1].replacements).toEqual({ ids: [1, 2], vectors: ["[0.1]", "[0.2]"] });
    expect(doc).toMatchObject({ embeddingStatus: "ready", embeddingModel: "text-embedding-3-small", embeddingError: null });
  });

  it("clears the vectors when the agent has no model", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith(null));

    await embedDocument(9);

    expect(embedTexts).not.toHaveBeenCalled();
    expect(query.mock.calls.some(c => String(c[0]).includes("SET embedding = NULL"))).toBe(true);
    expect(doc).toMatchObject({ embeddingStatus: "none", embeddingModel: null });
  });

  it("marks ready without calling the provider when there are no chunks", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([]);
    embedTexts.mockResolvedValue([]);

    await embedDocument(9);

    expect(doc).toMatchObject({ embeddingStatus: "ready", embeddingModel: "text-embedding-3-small" });
  });

  it("keeps keyword search and records a readable error when the key is missing", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    agentKey.mockReturnValueOnce(null);

    await embedDocument(9);

    expect(doc.status).toBe("ready");
    expect(doc.embeddingStatus).toBe("error");
    expect(doc.embeddingModel).toBeNull();
    expect(doc.embeddingError).toContain("sem chave de API");
  });

  it("records the provider error", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk.mockResolvedValue(agentWith("text-embedding-3-small"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }]);
    embedTexts.mockRejectedValue(new Error("429 You exceeded your current quota"));

    await embedDocument(9);

    expect(doc.embeddingStatus).toBe("error");
    expect(doc.embeddingError).toContain("429");
  });

  it("discards the result when the agent's model changed meanwhile", async () => {
    const doc = makeDocument();
    documentFindByPk.mockResolvedValue(doc);
    agentFindByPk
      .mockResolvedValueOnce(agentWith("text-embedding-3-small"))
      .mockResolvedValueOnce(agentWith("text-embedding-3-large"));
    chunkFindAll.mockResolvedValue([{ id: 1, content: "a" }]);
    embedTexts.mockResolvedValue([[0.1]]);

    await embedDocument(9);

    expect(query.mock.calls.some(c => String(c[0]).includes("SET embedding = v.e::vector"))).toBe(false);
    expect(doc.embeddingModel).toBeUndefined();
  });

  it("does nothing for a document that is not ready", async () => {
    documentFindByPk.mockResolvedValue({ ...makeDocument(), status: "processing" });
    await embedDocument(9);
    expect(agentFindByPk).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/EmbeddingService.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../EmbeddingService'`.

- [ ] **Step 3: Implementar `EmbeddingService.ts`**

```ts
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/EmbeddingService.spec.ts --coverage=false`
Expected: PASS (7 testes).

- [ ] **Step 5: Ligar à indexação** — em `KnowledgeService.ts`:

Importar: `import { embedDocument, resumeEmbeddings } from "./EmbeddingService";`

Acrescentar a `LIST_ATTRIBUTES`: `"embeddingModel", "embeddingStatus", "embeddingError"`.

Em `indexDocument`, depois do bloco `try { ... } catch { ... }` (fora dele, para um erro de embeddings não marcar o documento como `error`), acrescentar:

```ts
  await embedDocument(documentId).catch(err => logger.error(`Knowledge embeddings ${documentId}: ${err}`));
```

Em `resumeInterruptedIndexing`, no fim:

```ts
  setImmediate(() => {
    resumeEmbeddings().catch(err => logger.error(`Knowledge embeddings resume failed: ${err}`));
  });
```

- [ ] **Step 6: Conferir tipos e testes da pasta**

Run: `npx tsc --noEmit -p . && npx jest src/services/AiAgentServices --coverage=false`
Expected: sem erros de tipo; todos os testes PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/AiAgentServices/knowledge/EmbeddingService.ts src/services/AiAgentServices/knowledge/__tests__/EmbeddingService.spec.ts src/services/AiAgentServices/knowledge/KnowledgeService.ts
git commit -m "Base de conhecimento: vetores dos documentos com a chave do agente"
```

---

### Task 5: Busca híbrida e ferramenta do agente

**Files:**
- Modify: `whatsapp-api/src/services/AiAgentServices/knowledge/KnowledgeService.ts` (`KnowledgeHit`, `searchKnowledge`)
- Modify: `whatsapp-api/src/controllers/AiKnowledgeController.ts` (`search`)
- Modify: `whatsapp-api/src/services/AiAgentServices/generateReply.ts`
- Modify: `whatsapp-api/src/services/AiAgentServices/tools.ts` (`ToolContext`, ferramenta `buscar_base_conhecimento`)
- Test: `whatsapp-api/src/services/AiAgentServices/knowledge/__tests__/searchKnowledge.spec.ts`
- Test: `whatsapp-api/src/services/AiAgentServices/__tests__/tools.spec.ts`

**Interfaces:**
- Consumes: `fuseRankings` (Task 3), `embedTexts`, `toVectorLiteral` (Task 2), `agentKey`.
- Produces: `interface SearchAgent { id: number; companyId: number; provider: string; embeddingModel: string | null; apiKeyEncrypted?: string | null }`; `searchKnowledge(agent: SearchAgent, query: string, limit?: number): Promise<KnowledgeHit[]>`; `KnowledgeHit.chunkId: number`; `ToolContext.semanticKnowledge?: boolean`.

- [ ] **Step 1: Testes da busca**

```ts
const query = jest.fn();
jest.mock("../../../../models/AiKnowledgeChunk", () => ({
  __esModule: true,
  default: { sequelize: { query: (...a: any[]) => query(...a) } }
}));
jest.mock("../../../../models/AiKnowledgeDocument", () => ({ __esModule: true, default: {} }));
jest.mock("../../AgentService", () => ({ findAgent: jest.fn() }));
jest.mock("../EmbeddingService", () => ({ embedDocument: jest.fn(), resumeEmbeddings: jest.fn(), reembedAgentLater: jest.fn() }));
jest.mock("../../keys", () => ({ agentKey: () => "k" }));
const embedTexts = jest.fn();
jest.mock("../embeddings", () => ({
  ...jest.requireActual("../embeddings"),
  embedTexts: (...a: any[]) => embedTexts(...a)
}));

// eslint-disable-next-line import/first
import { searchKnowledge } from "../KnowledgeService";

const hit = (chunkId: number) => ({ chunkId, documentId: 1, title: "Doc", description: null, content: `c${chunkId}`, rank: 1 });
const agent = (embeddingModel: string | null) => ({ id: 3, companyId: 2, provider: "openai", embeddingModel, apiKeyEncrypted: "x" });
const isVectorQuery = (sql: string) => sql.includes("<=>");

describe("searchKnowledge", () => {
  it("uses keyword search only when the agent has no model", async () => {
    query.mockResolvedValue(Array.from({ length: 8 }, (_, i) => hit(i + 1)));
    const result = await searchKnowledge(agent(null), "frete");
    expect(embedTexts).not.toHaveBeenCalled();
    expect(result.map(h => h.chunkId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("fuses keyword and semantic results", async () => {
    query.mockImplementation(async (sql: string) => (isVectorQuery(sql) ? [hit(3), hit(1)] : [hit(1), hit(2)]));
    embedTexts.mockResolvedValue([[0.5, 0.5]]);
    const result = await searchKnowledge(agent("text-embedding-3-small"), "quanto é o frete?");
    expect(embedTexts).toHaveBeenCalledWith("openai", "k", "text-embedding-3-small", ["quanto é o frete?"], "query");
    const vectorCall = query.mock.calls.find(c => isVectorQuery(c[0]));
    expect(vectorCall[1].replacements).toMatchObject({ model: "text-embedding-3-small", vector: "[0.5,0.5]", agentId: 3, companyId: 2 });
    expect(result.map(h => h.chunkId)).toEqual([1, 3, 2]);
  });

  it("falls back to keyword search when the embedding call fails", async () => {
    query.mockResolvedValue([hit(7)]);
    embedTexts.mockRejectedValue(new Error("401 Incorrect API key"));
    const result = await searchKnowledge(agent("text-embedding-3-small"), "frete");
    expect(result.map(h => h.chunkId)).toEqual([7]);
    expect(query.mock.calls.some(c => isVectorQuery(c[0]))).toBe(false);
  });

  it("returns nothing for an empty question", async () => {
    expect(await searchKnowledge(agent("text-embedding-3-small"), "   ")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Teste da descrição da ferramenta** — acrescentar em `__tests__/tools.spec.ts` (no `describe` principal):

```ts
  it("describes the knowledge search by meaning when semantic search is on", () => {
    const search = jest.fn(async () => []);
    const byWords = buildToolSet({}, { queues: [], searchKnowledge: search });
    const byMeaning = buildToolSet({}, { queues: [], searchKnowledge: search, semanticKnowledge: true });
    const description = (set: any) => set.definitions.find((d: any) => d.name === "buscar_base_conhecimento").description;
    expect(description(byWords)).toContain("A busca é por palavras");
    expect(description(byMeaning)).not.toContain("A busca é por palavras");
    expect(description(byMeaning)).toContain("pelo sentido");
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/searchKnowledge.spec.ts src/services/AiAgentServices/__tests__/tools.spec.ts --coverage=false`
Expected: FAIL (assinatura antiga de `searchKnowledge`; `semanticKnowledge` inexistente).

- [ ] **Step 4: Busca híbrida em `KnowledgeService.ts`**

Importar: `import { agentKey } from "../keys";`, `import { embedTexts, toVectorLiteral } from "./embeddings";`, `import { fuseRankings } from "./hybrid";`.

Substituir `KnowledgeHit` e `searchKnowledge` inteiros por:

```ts
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
```

- [ ] **Step 5: Controller** — em `AiKnowledgeController.search`:

```ts
  return res.json(await searchKnowledge(agent, String(req.body?.query || "")));
```

- [ ] **Step 6: `generateReply.ts`** — trocar o bloco `searchKnowledge:` por:

```ts
    searchKnowledge: knowledge.searchable ? query => searchKnowledge(agent, query) : undefined,
    semanticKnowledge: !!agent.embeddingModel,
```

- [ ] **Step 7: `tools.ts`** — em `ToolContext`, depois de `searchKnowledge`:

```ts
  /** The knowledge search also matches by meaning (embeddings), not only words. */
  semanticKnowledge?: boolean;
```

e na definição de `buscar_base_conhecimento`, trocar o `description` por:

```ts
      description:
        "Busca trechos nos documentos da empresa (base de conhecimento). Use antes de responder sobre produtos, " +
        "preços, prazos, políticas ou procedimentos. " +
        (ctx.semanticKnowledge
          ? "A busca entende a pergunta pelo sentido; se não achar, tente de novo com outras palavras. "
          : "A busca é por palavras: se não achar, tente de novo com sinônimos ou termos mais gerais. ") +
        "Responda só com o que estiver nos trechos; se não houver, diga que não sabe.",
```

- [ ] **Step 8: Rodar os testes**

Run: `npx tsc --noEmit -p . && npx jest src/services/AiAgentServices --coverage=false`
Expected: sem erros; todos PASS (inclui `generateReply.spec.ts`, que mocka `searchKnowledge`).

- [ ] **Step 9: Commit**

```bash
git add src/services/AiAgentServices/knowledge/KnowledgeService.ts src/services/AiAgentServices/knowledge/__tests__/searchKnowledge.spec.ts src/controllers/AiKnowledgeController.ts src/services/AiAgentServices/generateReply.ts src/services/AiAgentServices/tools.ts src/services/AiAgentServices/__tests__/tools.spec.ts
git commit -m "Base de conhecimento: busca híbrida por palavras e significado"
```

---

### Task 6: Escolha do modelo (rota) e troca de provedor

**Files:**
- Modify: `whatsapp-api/src/services/AiAgentServices/knowledge/KnowledgeService.ts` (novas funções no fim)
- Modify: `whatsapp-api/src/controllers/AiKnowledgeController.ts`
- Modify: `whatsapp-api/src/routes/aiAgentRoutes.ts`
- Modify: `whatsapp-api/src/services/AiAgentServices/AgentService.ts` (`createAgent`, `updateAgent`)
- Test: `whatsapp-api/src/services/AiAgentServices/knowledge/__tests__/knowledgeSettings.spec.ts`

**Interfaces:**
- Consumes: `embeddingModelsFor`, `defaultEmbeddingModel`, `isEmbeddingModelFor`, `nextEmbeddingModel` (Task 2); `reembedAgentLater` (Task 4); `findAgent` (existente).
- Produces: `knowledgeSettings(agentId, companyId): Promise<KnowledgeSettings>`; `setEmbeddingModel(agentId, companyId, value: unknown): Promise<KnowledgeSettings>`; `interface KnowledgeSettings { provider: string; embeddingModel: string | null; options: { id: string; label: string }[] }`; rotas `GET`/`PUT /ai-agents/:agentId/knowledge-settings`; erro `ERR_AI_EMBEDDING_MODEL_INVALID`.

- [ ] **Step 1: Testes**

```ts
const findAgent = jest.fn();
jest.mock("../../AgentService", () => ({ findAgent: (...a: any[]) => findAgent(...a) }));
const reembedAgentLater = jest.fn();
jest.mock("../EmbeddingService", () => ({
  embedDocument: jest.fn(),
  resumeEmbeddings: jest.fn(),
  reembedAgentLater: (...a: any[]) => reembedAgentLater(...a)
}));
jest.mock("../../../../models/AiKnowledgeChunk", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../models/AiKnowledgeDocument", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import { setEmbeddingModel } from "../KnowledgeService";

const agentWith = (provider: string, embeddingModel: string | null) => {
  const agent: any = { id: 3, provider, embeddingModel };
  agent.update = jest.fn(async (values: any) => Object.assign(agent, values));
  return agent;
};

describe("setEmbeddingModel", () => {
  it("saves a new model and redoes the vectors", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    const settings = await setEmbeddingModel(3, 2, "text-embedding-3-large");
    expect(agent.update).toHaveBeenCalledWith({ embeddingModel: "text-embedding-3-large" });
    expect(reembedAgentLater).toHaveBeenCalledWith(3);
    expect(settings.embeddingModel).toBe("text-embedding-3-large");
    expect(settings.options.map(o => o.id)).toEqual(["text-embedding-3-small", "text-embedding-3-large"]);
  });

  it("turns it off with null or empty", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    await setEmbeddingModel(3, 2, "");
    expect(agent.embeddingModel).toBeNull();
    expect(reembedAgentLater).toHaveBeenCalledWith(3);
  });

  it("does nothing when the model is the same", async () => {
    const agent = agentWith("openai", "text-embedding-3-small");
    findAgent.mockResolvedValue(agent);
    await setEmbeddingModel(3, 2, "text-embedding-3-small");
    expect(agent.update).not.toHaveBeenCalled();
    expect(reembedAgentLater).not.toHaveBeenCalled();
  });

  it("refuses a model of another provider and any model for Claude", async () => {
    findAgent.mockResolvedValue(agentWith("gemini", null));
    await expect(setEmbeddingModel(3, 2, "text-embedding-3-small")).rejects.toThrow("ERR_AI_EMBEDDING_MODEL_INVALID");
    findAgent.mockResolvedValue(agentWith("anthropic", null));
    await expect(setEmbeddingModel(3, 2, "text-embedding-3-small")).rejects.toThrow("ERR_AI_EMBEDDING_MODEL_INVALID");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/knowledgeSettings.spec.ts --coverage=false`
Expected: FAIL — `setEmbeddingModel is not a function`.

- [ ] **Step 3: Funções em `KnowledgeService.ts`** — importar `reembedAgentLater` junto de `embedDocument, resumeEmbeddings` e `embeddingModelsFor, isEmbeddingModelFor` junto de `embedTexts, toVectorLiteral`; acrescentar no fim:

```ts
export interface KnowledgeSettings {
  provider: string;
  embeddingModel: string | null;
  options: { id: string; label: string }[];
}

const settingsOf = (agent: { provider: string; embeddingModel: string | null }): KnowledgeSettings => ({
  provider: agent.provider,
  embeddingModel: agent.embeddingModel || null,
  options: embeddingModelsFor(agent.provider)
});

export const knowledgeSettings = async (agentId: number | string, companyId: number) =>
  settingsOf(await findAgent(agentId, companyId));

/** Chooses the embedding model (null/"" = off); a change redoes every document's vectors. */
export const setEmbeddingModel = async (agentId: number | string, companyId: number, value: unknown) => {
  const agent = await findAgent(agentId, companyId);
  const model = value === null || value === undefined || value === "" ? null : value;
  if (model !== null && !isEmbeddingModelFor(agent.provider, model)) {
    throw new AppError("ERR_AI_EMBEDDING_MODEL_INVALID");
  }
  if ((agent.embeddingModel || null) !== model) {
    await agent.update({ embeddingModel: model });
    reembedAgentLater(agent.id);
  }
  return settingsOf(agent);
};
```

- [ ] **Step 4: Rodar os testes**

Run: `npx jest src/services/AiAgentServices/knowledge/__tests__/knowledgeSettings.spec.ts --coverage=false`
Expected: PASS (4 testes).

- [ ] **Step 5: Controller e rotas**

Em `AiKnowledgeController.ts`, importar `knowledgeSettings, setEmbeddingModel` e acrescentar:

```ts
export const settings = async (req: Request, res: Response): Promise<Response> =>
  res.json(await knowledgeSettings(req.params.agentId, req.user.companyId));

export const updateSettings = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await setEmbeddingModel(req.params.agentId, req.user.companyId, req.body?.embeddingModel));
};
```

Em `aiAgentRoutes.ts`, depois da rota `knowledge-search`:

```ts
aiAgentRoutes.get("/ai-agents/:agentId/knowledge-settings", isAuth, aiInPlan, AiKnowledgeController.settings);
aiAgentRoutes.put("/ai-agents/:agentId/knowledge-settings", isAuth, aiInPlan, AiKnowledgeController.updateSettings);
```

- [ ] **Step 6: `AgentService.ts`** — importar:

```ts
import { defaultEmbeddingModel, nextEmbeddingModel } from "./knowledge/embeddings";
import { reembedAgentLater } from "./knowledge/EmbeddingService";
```

Em `createAgent`, trocar a linha do `AiAgent.create` por:

```ts
  const agent = await AiAgent.create({
    ...values,
    ...key,
    embeddingModel: defaultEmbeddingModel(values.provider as string),
    companyId
  } as any);
```

Em `updateAgent`, trocar `await agent.update({ ...values, ...key });` por:

```ts
  // A provider without the current embedding model moves to its default
  // (or off, for Claude) and the knowledge base vectors are redone.
  const embeddingModel = provider === agent.provider ? agent.embeddingModel || null : nextEmbeddingModel(agent.embeddingModel || null, provider);
  const embeddingChanged = embeddingModel !== (agent.embeddingModel || null);
  await agent.update({ ...values, ...key, ...(embeddingChanged ? { embeddingModel } : {}) });
  if (embeddingChanged) reembedAgentLater(agent.id);
```

- [ ] **Step 7: Tipos e suíte**

Run: `npx tsc --noEmit -p . && npx jest src/services/AiAgentServices --coverage=false`
Expected: sem erros; todos PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/AiAgentServices/knowledge/KnowledgeService.ts src/services/AiAgentServices/knowledge/__tests__/knowledgeSettings.spec.ts src/controllers/AiKnowledgeController.ts src/routes/aiAgentRoutes.ts src/services/AiAgentServices/AgentService.ts
git commit -m "Base de conhecimento: escolha do modelo de embedding"
```

---

### Task 7: Tela — seletor, aviso, selos e editor

**Files:**
- Create: `whatsapp-app/src/pages/AiAgents/knowledgeEmbedding.js`
- Test: `whatsapp-app/src/pages/AiAgents/knowledgeEmbedding.test.js`
- Modify: `whatsapp-app/src/pages/AiAgents/KnowledgeBase.js`
- Modify: `whatsapp-app/src/pages/AiAgents/Editor.js`
- Modify: `whatsapp-app/src/translate/languages/pt.js` (junto de `ERR_AI_KNOWLEDGE_*`)

**Interfaces:**
- Consumes: `GET/PUT /ai-agents/:agentId/knowledge-settings` → `{ provider, embeddingModel, options: [{ id, label }] }`; documentos com `embeddingModel`, `embeddingStatus`, `embeddingError`.
- Produces: `embeddingBadge(doc, agentModel) => { label, tone, title? } | null`; `embeddingBusy(documents) => boolean`.

- [ ] **Step 1: Teste do selo**

```js
import { embeddingBadge, embeddingBusy } from "./knowledgeEmbedding";

const doc = (values) => ({ status: "ready", embeddingStatus: "none", embeddingModel: null, embeddingError: null, ...values });

describe("embeddingBadge", () => {
  it("shows nothing when semantic search is off or the document is not ready", () => {
    expect(embeddingBadge(doc(), null)).toBeNull();
    expect(embeddingBadge(doc({ status: "processing" }), "text-embedding-3-small")).toBeNull();
  });

  it("shows meaning when the vectors match the agent's model", () => {
    expect(embeddingBadge(doc({ embeddingStatus: "ready", embeddingModel: "m" }), "m")).toEqual({ label: "Significado", tone: "ok" });
  });

  it("shows words only for vectors of another model or none", () => {
    expect(embeddingBadge(doc({ embeddingStatus: "ready", embeddingModel: "old" }), "m").label).toBe("Só palavras");
    expect(embeddingBadge(doc(), "m").label).toBe("Só palavras");
  });

  it("shows progress and errors", () => {
    expect(embeddingBadge(doc({ embeddingStatus: "processing" }), "m").label).toBe("Gerando significado…");
    expect(embeddingBadge(doc({ embeddingStatus: "error", embeddingError: "falhou" }), "m")).toEqual({ label: "Só palavras", tone: "error", title: "falhou" });
  });
});

describe("embeddingBusy", () => {
  it("is true while some document is being embedded", () => {
    expect(embeddingBusy([doc(), doc({ embeddingStatus: "processing" })])).toBe(true);
    expect(embeddingBusy([doc()])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `whatsapp-app`): `CI=true npx react-scripts test --watchAll=false src/pages/AiAgents/knowledgeEmbedding.test.js`
Expected: FAIL — `Cannot find module './knowledgeEmbedding'`.

- [ ] **Step 3: Implementar `knowledgeEmbedding.js`**

```js
// Semantic-search badge of a knowledge document (see the API's EmbeddingService).
export const embeddingBadge = (doc, agentModel) => {
  if (doc.status !== "ready") return null;
  if (doc.embeddingStatus === "processing") return { label: "Gerando significado…", tone: "neutral" };
  if (doc.embeddingStatus === "error") return { label: "Só palavras", tone: "error", title: doc.embeddingError };
  if (!agentModel) return null;
  if (doc.embeddingStatus === "ready" && doc.embeddingModel === agentModel) return { label: "Significado", tone: "ok" };
  return { label: "Só palavras", tone: "neutral" };
};

export const embeddingBusy = (documents) => documents.some((d) => d.embeddingStatus === "processing");
```

- [ ] **Step 4: Rodar o teste**

Run: `CI=true npx react-scripts test --watchAll=false src/pages/AiAgents/knowledgeEmbedding.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: `KnowledgeBase.js`**

Imports: acrescentar `MenuItem` à lista do `@material-ui/core` e `import { embeddingBadge, embeddingBusy } from "./knowledgeEmbedding";`.

Estilos (dentro do objeto de `useStyles`):

```js
    semantic: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 },
    semanticSelect: { minWidth: 300 },
```

Estado (depois de `const fileRef = useRef(null);`):

```js
  const [settings, setSettings] = useState(null); // { provider, embeddingModel, options }
  const [pendingModel, setPendingModel] = useState(undefined); // model awaiting confirmation
```

Carregar junto dos documentos — dentro de `load`, depois de `setDocuments(data);`:

```js
      const { data: knowledgeSettings } = await api.get(`/ai-agents/${agentId}/knowledge-settings`);
      setSettings(knowledgeSettings);
```

Polling — trocar a linha `const busy = ...` por:

```js
  const busy = documents.some((d) => d.status === "pending" || d.status === "processing") || embeddingBusy(documents);
```

Funções (depois de `remove`):

```js
  const saveModel = async (embeddingModel) => {
    try {
      const { data } = await api.put(`/ai-agents/${agentId}/knowledge-settings`, { embeddingModel });
      setSettings(data);
      await load();
    } catch (err) {
      toastError(err);
    }
    setPendingModel(undefined);
  };

  const chooseModel = (value) => {
    const embeddingModel = value || null;
    if (embeddingModel === (settings?.embeddingModel || null)) return;
    if (documents.length) setPendingModel(embeddingModel);
    else saveModel(embeddingModel);
  };
```

JSX — logo depois do `<TextDocumentDialog ... />`:

```jsx
      <ConfirmationModal
        title="Trocar a busca por significado?"
        open={pendingModel !== undefined}
        onClose={() => setPendingModel(undefined)}
        onConfirm={() => saveModel(pendingModel)}
      >
        {pendingModel
          ? "Os documentos serão reprocessados com o novo modelo, usando a chave do agente. Enquanto isso, a busca funciona só por palavras."
          : "A busca volta a ser só por palavras e os vetores dos documentos são apagados."}
      </ConfirmationModal>
```

e logo depois do `</div>` que fecha `classes.head`:

```jsx
      {settings && (
        <div className={classes.semantic}>
          <TextField
            select
            size="small"
            variant="outlined"
            label="Busca por significado"
            className={classes.semanticSelect}
            value={settings.embeddingModel || ""}
            onChange={(e) => chooseModel(e.target.value)}
            disabled={!settings.options.length}
            helperText={
              settings.options.length
                ? "Encontra trechos com outras palavras de mesmo sentido. Usa a chave do agente."
                : "Indisponível para Claude — a busca é feita por palavras."
            }
          >
            <MenuItem value="">Desligado (só palavras)</MenuItem>
            {settings.options.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </div>
      )}
```

Na lista, dentro do `documents.map`, depois de `const status = ...`:

```js
            const semantic = embeddingBadge(d, settings?.embeddingModel || null);
```

e depois do `<span>` do selo de status:

```jsx
                    {semantic && (
                      <Tooltip title={semantic.title || ""} disableHoverListener={!semantic.title}>
                        <span className={clsx(classes.pill, classes[`tone_${semantic.tone}`])}>{semantic.label}</span>
                      </Tooltip>
                    )}
```

Botão "Processar de novo": trocar a condição `d.status === "error" &&` por `(d.status === "error" || d.embeddingStatus === "error") &&`.

- [ ] **Step 6: `Editor.js` — aviso ao trocar provedor**

Estado (perto de `const [saving, setSaving] = useState(false);`):

```js
  const [confirmProvider, setConfirmProvider] = useState(false);
```

No início de `save`, mudar a assinatura e acrescentar a checagem depois das validações de nome e modelo:

```js
  const save = async (confirmed = false) => {
```

```js
    // Another provider redoes (or turns off) the knowledge base's search by meaning.
    if (!isNew && agent.provider !== savedProvider && !confirmed) {
      setConfirmProvider(true);
      return;
    }
```

Botão salvar (linha ~815): `onClick={save}` → `onClick={() => save()}` (o evento de clique não pode chegar como `confirmed`).

Modal (junto dos outros elementos de topo do JSX retornado; importar `ConfirmationModal` de `../../components/ConfirmationModal` se ainda não estiver importado):

```jsx
      <ConfirmationModal
        title="Trocar o provedor?"
        open={confirmProvider}
        onClose={() => setConfirmProvider(false)}
        onConfirm={() => {
          setConfirmProvider(false);
          save(true);
        }}
      >
        A busca por significado da base de conhecimento passa para um modelo do novo provedor (ou fica só por palavras,
        no caso do Claude) e os documentos são reprocessados com a chave do agente.
      </ConfirmationModal>
```

- [ ] **Step 7: Tradução** — em `pt.js`, depois de `ERR_AI_KNOWLEDGE_NOT_FOUND`:

```js
      ERR_AI_EMBEDDING_MODEL_INVALID: "Modelo de busca por significado indisponível para o provedor deste agente.",
```

- [ ] **Step 8: Build do app**

Run: `CI=true npx react-scripts test --watchAll=false src/pages/AiAgents && npm run build`
Expected: testes PASS; build sem erros (warnings de lint existentes podem aparecer, mas nenhum novo nos arquivos tocados).

- [ ] **Step 9: Commit**

```bash
git add src/pages/AiAgents/knowledgeEmbedding.js src/pages/AiAgents/knowledgeEmbedding.test.js src/pages/AiAgents/KnowledgeBase.js src/pages/AiAgents/Editor.js src/translate/languages/pt.js
git commit -m "Base de conhecimento: seletor da busca por significado"
```

---

### Task 8: Validação no HM

**Files:** nenhum (só verificação; corrigir o que aparecer nas tasks donas e commitar lá).

- [ ] **Step 1:** Publicar no HM (fluxo da memória weconex-hm-deploy: build + migrate + restart da api; build do app). Conferir log da api sem erro ao subir (`resumeEmbeddings`).
- [ ] **Step 2:** No painel do HM, agente OpenAI com chave real → aba Base de conhecimento → seletor em `text-embedding-3-small`. Criar documento de texto: "A taxa de entrega para Contagem é R$ 15 e o prazo é de 2 dias úteis." Esperar o selo **Significado**.
- [ ] **Step 3:** "Testar busca" com "quanto é o frete?" → o trecho aparece. Com o seletor em "Desligado", a mesma pergunta não acha (confirma que o ganho veio dos vetores) e o selo some.
- [ ] **Step 4:** Trocar para `text-embedding-3-large` → aviso aparece; após confirmar, selos passam por **Gerando significado…** e voltam a **Significado**.
- [ ] **Step 5:** Banco: `SELECT "embeddingModel","embeddingStatus" FROM "AiKnowledgeDocuments" WHERE "agentId"=<id>;` e `SELECT count(*) FROM "AiKnowledgeChunks" WHERE "agentId"=<id> AND embedding IS NOT NULL;` coerentes com a tela.
- [ ] **Step 6:** Console de teste do agente: perguntar "quanto é o frete pra Contagem?" → o agente chama `buscar_base_conhecimento` e responde R$ 15.
- [ ] **Step 7:** Chave inválida simulada: num agente de teste, trocar o modelo com chave sem crédito/errada → selo **Só palavras** com tooltip do erro; busca por palavras segue funcionando.
- [ ] **Step 8:** Agente Claude: seletor desativado com o texto de indisponível.
- [ ] **Step 9:** Screenshot da aba com os selos para o usuário. Não dar push na `main` sem o usuário pedir.
