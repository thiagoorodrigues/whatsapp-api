# Busca por significado na base de conhecimento — design

Data: 2026-10-09

## Objetivo

O agente de IA achar a resposta na base de conhecimento mesmo quando o cliente
usa palavras diferentes das do documento ("quanto é o frete?" → trecho que fala
em "taxa de entrega"). Hoje a busca é só por palavras (full-text do Postgres,
português, sem acento); ela continua existindo e passa a ser combinada com uma
busca por vetores (embeddings).

Sucesso: perguntas com sinônimos encontram o trecho certo, e nenhum caso que
funciona hoje piora (a busca por palavras segue como base e como fallback).

## Decisões

- Os vetores são gerados com a **chave do próprio agente** (custo do cliente).
- O **modelo de embedding é escolhido** pelo usuário, entre os do provedor do
  agente, ou "Desligado".
- **Trocar o modelo mostra um aviso** e reprocessa os vetores de todos os
  documentos do agente em segundo plano.
- Agentes **Anthropic** não têm modelo de embedding: ficam só com a busca por
  palavras (seletor desativado com explicação).
- Agentes **novos** OpenAI/Gemini nascem com o modelo padrão do provedor.
  Agentes **existentes** ficam desligados até alguém escolher.

## Fora do escopo

- Chave Voyage (ou outra) para agentes Claude.
- Chave de embeddings da plataforma.
- Mudar o tamanho dos trechos (segue 1.200 caracteres com 200 de sobreposição).

## Modelos

| Provedor | Modelo | Observação |
|---|---|---|
| openai | `text-embedding-3-small` (padrão) | nativo 1536 |
| openai | `text-embedding-3-large` | pedido com `dimensions: 1536` |
| gemini | `gemini-embedding-001` (padrão) | `outputDimensionality: 1536`, vetor normalizado na API (dimensão reduzida não vem normalizada); `taskType` `RETRIEVAL_DOCUMENT` para trechos e `RETRIEVAL_QUERY` para a pergunta |
| anthropic | — | sem embeddings |

Todos os vetores têm **1536 dimensões**, então uma coluna só serve para todos.
A lista fica numa constante na API (`EMBEDDING_MODELS`) e é exposta para a tela.

## Banco (uma migration)

- `AiAgents.embeddingModel` `STRING NULL` — modelo escolhido; `NULL` = desligado.
- `AiKnowledgeDocuments.embeddingModel` `STRING NULL` — modelo que gerou os
  vetores atuais do documento.
- `AiKnowledgeDocuments.embeddingStatus` `STRING NOT NULL DEFAULT 'none'` —
  `none | processing | ready | error`.
- `AiKnowledgeDocuments.embeddingError` `TEXT NULL`.
- `AiKnowledgeChunks.embedding` `vector(1536) NULL`.

Sem índice HNSW: a busca filtra por `agentId` (índice btree já existente) e
calcula a distância exata só nos trechos daquele agente — alguns milhares no
máximo, poucos milissegundos. Um índice aproximado global devolveria os vizinhos
de todas as empresas e filtraria depois, perdendo resultados de agentes
pequenos. Se algum agente passar de ~50 mil trechos, revisitar (pgvector 0.8.6
tem `iterative_scan`).

## Provedores

`AiProvider` ganha um método opcional:

```ts
embed?(req: { apiKey: string; model: string; texts: string[]; kind: "document" | "query" }): Promise<number[][]>;
```

Implementado em `openai.ts` e `gemini.ts`; `anthropic.ts` não implementa.
Lotes de até 100 textos por chamada (o chamador divide).

## Indexação

`indexDocument` continua dividindo e gravando os trechos e marca o documento
`ready` como hoje (busca por palavras disponível na hora). Em seguida, se o
agente tem `embeddingModel`, chama `embedDocument(documentId)`:

1. `embeddingStatus = processing`, `embeddingError = null`.
2. Gera os vetores em lotes de 100 com a chave do agente e grava em cada trecho.
3. Sucesso: `embeddingStatus = ready`, `embeddingModel = <modelo>`.
4. Falha (chave inválida, sem crédito, timeout): `embeddingStatus = error`,
   `embeddingError` com a mensagem curta; os vetores antigos do documento são
   apagados (`embedding = NULL`, `embeddingModel = NULL`). O documento segue
   `ready` para a busca por palavras.

Agente sem modelo: `embeddingStatus = none`, vetores `NULL`.

`resumeInterruptedIndexing` também retoma documentos com
`embeddingStatus = processing`.

## Troca de modelo

Nova rota `PUT /ai-agents/:agentId/knowledge-settings` com `{ embeddingModel }`
(valida que o modelo pertence ao provedor do agente, ou `null`). Ao mudar:

- grava `AiAgents.embeddingModel`;
- modelo novo: `embedDocument` em segundo plano para cada documento ativo do
  agente, um por vez;
- desligado: apaga os vetores dos documentos do agente e marca `none`.

Troca de **provedor** no editor do agente (rota de atualização já existente):
se o `embeddingModel` atual não pertence ao novo provedor, a API troca para o
padrão do novo provedor (ou `NULL` no Anthropic) e dispara o mesmo
reprocessamento. Trocar só a chave, mantendo provedor e modelo, não reprocessa.

Enquanto reprocessa, a busca vetorial ignora documentos cujo
`embeddingModel` difere do modelo do agente — eles entram só pela busca por
palavras. Não é preciso apagar nada antes.

## Busca híbrida

`searchKnowledge(agent, query)`:

1. Busca por palavras (SQL atual), até 20 candidatos.
2. Se o agente tem `embeddingModel`: vetoriza a pergunta (`kind: "query"`) e
   busca os 20 trechos mais próximos (`embedding <=> :vetor`, distância de
   cosseno) entre os trechos do agente cujo documento está ativo, `ready` e com
   `embeddingModel` igual ao do agente.
3. Junta as duas listas por **RRF** (`score = Σ 1 / (60 + posição)`) e devolve
   os 5 melhores.
4. Falha ao vetorizar a pergunta: loga e usa só a lista por palavras.

A função de fusão (RRF) fica isolada e pura, para teste unitário.

A descrição da ferramenta `buscar_base_conhecimento` muda conforme o modo: com
busca por significado ativa, sai o trecho "a busca é por palavras"; o pedido
para tentar de novo com outros termos permanece.

## Tela (whatsapp-app)

Aba **Base de conhecimento** do editor do agente:

- Seletor **"Busca por significado"** no topo: opções do provedor do agente +
  "Desligado (só palavras)". Agente Anthropic: seletor desativado com o texto
  "Indisponível para Claude — a busca é feita por palavras."
- Ao trocar a opção (havendo documentos), diálogo de confirmação: "Os documentos
  serão reprocessados com o novo modelo, usando a chave do agente. Enquanto
  isso, a busca funciona só por palavras." Confirmar salva na hora pela rota
  `knowledge-settings`.
- Cada documento mostra um selo: **Significado** (`ready` e modelo igual ao do
  agente), **Gerando…** (`processing`), **Só palavras** (`none` ou modelo
  diferente) ou **Erro** com a mensagem no tooltip. A lista é atualizada
  enquanto houver documento `processing`, como já é feito hoje.

Editor do agente, ao salvar com **provedor trocado** e havendo documentos com
vetores: aviso no mesmo texto antes de salvar.

## Testes

- Unitário: fusão RRF (ordem, empates, listas vazias, trecho nas duas listas).
- Unitário: `searchKnowledge` cai para palavras quando `embed` lança erro.
- Unitário: troca de modelo dispara reprocessamento; troca só de chave não.
- Unitário: validação do modelo contra o provedor.
- HM: agente OpenAI com chave real, documento com "taxa de entrega", pergunta
  "quanto é o frete?" acha o trecho; trocar para `-3-large` reprocessa e mostra
  os selos; desligar volta para só palavras.
