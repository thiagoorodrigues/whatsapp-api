# CRM etapa 5 — Criação automática por regra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin cadastra regras (funil + coluna, filtradas por conexão e/ou fila) e o sistema cria sozinho um negócio para o contato que manda mensagem ou entra numa fila, se ele ainda não tiver negócio aberto naquele funil.

**Architecture:** No backend, três peças novas em `src/services/CrmServices/`: `ruleCache.ts` (regras ativas por empresa em memória por 60 s, invalidado ao salvar regra ou mudar funil/coluna), `FunnelRuleService.ts` (CRUD com validação, só admin) e `ApplyFunnelRulesService.ts` (casa as regras com o ticket e cria o negócio sob o mesmo lock por contato+funil que o agente de IA já usa, movido para `contactLock.ts`). O serviço é chamado sem `await` em `ProcessInboundMessage` (mensagem recebida, fora de grupo) e em `UpdateTicketService` (fila mudou para um valor não nulo); nunca lança erro. No app, a aba "Criação automática" em `/funil/configuracoes` (`Rules.js`), com as regras puras em `rules.js`.

**Tech Stack:** Node + TypeScript, Sequelize (sequelize-typescript), Postgres (`pg_advisory_xact_lock`), Jest 27 + ts-jest; React 17, Material-UI 4, react-scripts test.

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md`, nas seções "Criação automática", "API" (`GET/POST/PUT /crm/rules[/:id]`), "Telas → Configurações do CRM" (aba Criação automática) e no passo 5 da "Ordem de entrega".

## Global Constraints

- A tabela `FunnelRules` e o model `FunnelRule` já existem (migration `20260930160000-create-crm.ts`): `companyId, funnelId, stageId, whatsappId (nulo), queueId (nulo), active (padrão true)`. **Não criar migration.**
- Uma regra casa com o ticket quando `whatsappId` e `queueId` batem com os do ticket; campo nulo na regra não filtra.
- Cria o negócio na coluna da regra **somente se o contato não tiver negócio `open` naquele funil**. Responsável = `ticket.userId` (pode ser nulo). `DealEvent` do tipo `created` com `userId` nulo.
- Pontos de chamada: (1) `ProcessInboundMessage`, depois de `FindOrCreateTicketService`, só com `!inbound.fromMe` e ticket que não é grupo; (2) `UpdateTicketService`, quando `queueId` muda para um valor não nulo.
- As regras ativas ficam em cache em memória por 60 s, invalidado ao salvar regra. Falha na regra vai para o log e não interrompe o processamento da mensagem.
- Rotas com `isAuth` e `requirePlanFeature("useCrm")`; todas as rotas de regra exigem admin (`ERR_NO_PERMISSION`, 403). Empresa sem `useCrm` no plano não cria negócio por regra.
- Socket: `company-${companyId}-deal` só com ids (`emitDeal`), e `company-${companyId}-funnel` para mudanças de configuração (`emitFunnel`).
- Regra nova é desligada por padrão no sentido do spec: não existe nenhuma regra até o admin criar uma.
- Erro novo: `ERR_CRM_RULE_INVALID` (400), para funil, coluna, conexão ou fila que não existe, é de outra empresa, está arquivado ou não é coluna aberta.
- Fora do spec, mas incluído: `DELETE /crm/rules/:id`, porque regra não tem histórico e a tela precisa remover regra criada por engano.
- Textos de tela em português; comentários de código em inglês; commits em português terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sem push**, porque push na `main` publica em produção.
- Testes do backend: `cd whatsapp-api && npx jest <caminho>` (o script `npm test` só prefixa `NODE_ENV=test`). Testes do app: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false <caminho>`.

## Review Focus

1. **Duas mensagens seguidas de um contato novo** (ou a mensagem e a troca de fila do chatbot ao mesmo tempo) → um só negócio. O lock `pg_advisory_xact_lock` por contato+funil e a checagem de negócio aberto dentro da transação garantem isso. Teste em `ApplyFunnelRulesService.spec.ts` ("checks for an open deal inside the lock").
2. **Duas regras do mesmo funil casando com o mesmo ticket** (uma por conexão, outra por fila) → um só negócio, na coluna da primeira regra (menor id). Teste "one deal per funnel".
3. **Regra salva e mensagem logo em seguida** → a mensagem já usa a regra nova: salvar invalida o cache, e uma leitura que estava em andamento durante a invalidação não grava o resultado velho. Teste em `ruleCache.spec.ts` ("drops a load that raced an invalidation").
4. **Funil ou coluna da regra arquivados depois** → a regra para de criar negócio sem erro (o cache só traz regras cujo funil está ativo e cuja coluna está aberta e não arquivada, e `emitFunnel` invalida o cache). A tela mostra o aviso "O funil desta regra está arquivado." Testes em `ruleCache.spec.ts` (filtro do include) e em `rules.test.js` (`ruleProblem`). Desligar essa regra continua possível; religar sem corrigir o alvo dá `ERR_CRM_RULE_INVALID`.
5. **Conexão ou fila de outra empresa no corpo da requisição** → `ERR_CRM_RULE_INVALID`, nada é salvo. Teste em `FunnelRuleService.spec.ts`.

Comportamento que vem do spec e convém o usuário confirmar ao revisar: um contato cujo negócio foi ganho ou perdido ganha um negócio **novo** na próxima mensagem, se uma regra casar, porque ele não tem mais negócio `open` naquele funil.

---

### Task 1: Lock por contato+funil compartilhado

O agente de IA já serializa a criação por contato+funil (`lockContactFunnel` e `openDealOf`, privados em `AgentDealService.ts`). A regra precisa do mesmo lock, senão um negócio criado pelo agente e outro pela regra podem nascer juntos.

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/contactLock.ts`
- Create: `whatsapp-api/src/services/CrmServices/__tests__/contactLock.spec.ts`
- Modify: `whatsapp-api/src/services/CrmServices/AgentDealService.ts` (remover `openDealOf` e `lockContactFunnel`, importar do módulo novo)

**Interfaces:**
- Produces: `lockContactFunnel(companyId: number, contactId: number, funnelId: number, transaction: any): Promise<unknown>` e `findOpenDeal(companyId: number, funnelId: number, contactId: number, transaction?: any): Promise<Deal | null>`.

- [ ] **Step 1: Escrever o teste que falha**

`whatsapp-api/src/services/CrmServices/__tests__/contactLock.spec.ts`:

```ts
import Deal from "../../../models/Deal";
import { lockContactFunnel, findOpenDeal } from "../contactLock";

jest.mock("../../../models/Deal", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), sequelize: { query: jest.fn() } }
}));

describe("lockContactFunnel", () => {
  it("takes a transaction lock keyed by company and contact+funnel", async () => {
    const transaction = { id: "t" };
    await lockContactFunnel(4, 77, 5, transaction);
    expect(Deal.sequelize!.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(:a, :b)", {
      replacements: { a: 4, b: (77 * 1000003 + 5) % 2147483647 },
      transaction
    });
  });
});

describe("findOpenDeal", () => {
  it("locks the row when inside a transaction", async () => {
    const transaction = { id: "t" };
    await findOpenDeal(4, 5, 77, transaction);
    expect(Deal.findOne).toHaveBeenLastCalledWith({
      where: { companyId: 4, funnelId: 5, contactId: 77, status: "open" },
      order: [["updatedAt", "DESC"]],
      transaction,
      lock: true
    });
  });
  it("reads without a lock outside a transaction", async () => {
    await findOpenDeal(4, 5, 77);
    expect(Deal.findOne).toHaveBeenLastCalledWith({
      where: { companyId: 4, funnelId: 5, contactId: 77, status: "open" },
      order: [["updatedAt", "DESC"]]
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/contactLock.spec.ts`
Expected: FAIL com "Cannot find module '../contactLock'".

- [ ] **Step 3: Criar o módulo**

`whatsapp-api/src/services/CrmServices/contactLock.ts`:

```ts
import Deal from "../../models/Deal";

// One deal registration at a time per contact and funnel, across tickets,
// processes and callers (AI agent, automatic rules), so two quick messages
// cannot create two deals.
export const lockContactFunnel = (companyId: number, contactId: number, funnelId: number, transaction: any) =>
  Deal.sequelize!.query("SELECT pg_advisory_xact_lock(:a, :b)", {
    replacements: { a: companyId, b: (contactId * 1000003 + funnelId) % 2147483647 },
    transaction
  });

export const findOpenDeal = (companyId: number, funnelId: number, contactId: number, transaction?: any) =>
  Deal.findOne({
    where: { companyId, funnelId, contactId, status: "open" },
    order: [["updatedAt", "DESC"]],
    ...(transaction ? { transaction, lock: true } : {})
  });
```

- [ ] **Step 4: Usar o módulo no agente**

Em `AgentDealService.ts`, apagar as funções `openDealOf` e `lockContactFunnel` (com o comentário "One registration at a time...") e acrescentar aos imports:

```ts
import { findOpenDeal, lockContactFunnel } from "./contactLock";
```

Trocar as duas chamadas `openDealOf(` por `findOpenDeal(` (uma em `registerContactDeal`, com `transaction`, e outra em `qualifyContactDeal`, sem). A ordem dos argumentos é a mesma: `(companyId, funnelId, contactId, transaction?)`.

- [ ] **Step 5: Rodar os testes do CRM**

Run: `cd whatsapp-api && npx jest src/services/CrmServices && npx tsc --noEmit -p .`
Expected: todos passam, incluindo `AgentDealService.spec.ts`, que continua usando o mock `Deal.sequelize.query`. O tsc não deve mostrar erros.

- [ ] **Step 6: Commit**

```bash
cd whatsapp-api
git add src/services/CrmServices/contactLock.ts src/services/CrmServices/__tests__/contactLock.spec.ts src/services/CrmServices/AgentDealService.ts
git commit -m "Separa o lock por contato e funil para reutilizar nas regras do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cache das regras ativas

**Files:**
- Modify: `whatsapp-api/src/models/FunnelRule.ts` (associação `stage`)
- Create: `whatsapp-api/src/services/CrmServices/ruleCache.ts`
- Create: `whatsapp-api/src/services/CrmServices/__tests__/ruleCache.spec.ts`
- Modify: `whatsapp-api/src/services/CrmServices/FunnelService.ts` (`emitFunnel` invalida o cache)

**Interfaces:**
- Produces: `interface ActiveRule { id: number; funnelId: number; stageId: number; whatsappId: number | null; queueId: number | null }`, `RULE_CACHE_MS = 60000`, `activeRules(companyId: number, now?: number): Promise<ActiveRule[]>`, `invalidateRules(companyId: number): void`.

- [ ] **Step 1: Associar a coluna no model**

Em `whatsapp-api/src/models/FunnelRule.ts`, logo depois de `stageId: number;`:

```ts
  @BelongsTo(() => FunnelStage)
  stage: FunnelStage;
```

E trocar o comentário da classe por:

```ts
// Creates deals automatically when a contact writes in or enters a queue.
```

- [ ] **Step 2: Escrever o teste que falha**

`whatsapp-api/src/services/CrmServices/__tests__/ruleCache.spec.ts`:

```ts
import FunnelRule from "../../../models/FunnelRule";
import { hasPlanFeature } from "../../../helpers/planFeature";
import { activeRules, invalidateRules, RULE_CACHE_MS } from "../ruleCache";

jest.mock("../../../helpers/planFeature", () => ({ hasPlanFeature: jest.fn() }));
jest.mock("../../../models/FunnelRule", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: {} }));

const row = { id: 1, funnelId: 5, stageId: 25, whatsappId: 2, queueId: null };

beforeEach(() => {
  jest.clearAllMocks();
  invalidateRules(4);
  (hasPlanFeature as jest.Mock).mockResolvedValue(true);
  (FunnelRule.findAll as jest.Mock).mockResolvedValue([row]);
});

describe("activeRules", () => {
  it("loads active rules whose funnel is active and stage is open", async () => {
    expect(await activeRules(4, 0)).toEqual([row]);
    const query = (FunnelRule.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where).toEqual({ companyId: 4, active: true });
    expect(query.include.map((i: any) => [i.as, i.where, i.required])).toEqual([
      ["funnel", { archived: false }, true],
      ["stage", { kind: "open", archived: false }, true]
    ]);
  });
  it("serves from memory for 60 seconds", async () => {
    await activeRules(4, 0);
    await activeRules(4, RULE_CACHE_MS - 1);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(1);
    await activeRules(4, RULE_CACHE_MS);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(2);
  });
  it("reloads right after an invalidation", async () => {
    await activeRules(4, 0);
    invalidateRules(4);
    await activeRules(4, 1);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(2);
  });
  it("returns nothing, without querying rules, when the plan has no CRM", async () => {
    (hasPlanFeature as jest.Mock).mockResolvedValue(false);
    expect(await activeRules(4, 0)).toEqual([]);
    expect(FunnelRule.findAll).not.toHaveBeenCalled();
  });
  it("drops a load that raced an invalidation", async () => {
    let release: (rows: any[]) => void = () => undefined;
    (FunnelRule.findAll as jest.Mock).mockReturnValueOnce(new Promise(r => { release = r; }));
    const stale = activeRules(4, 0);
    // Let the plan check resolve so findAll is the pending call.
    await new Promise(r => setImmediate(r));
    invalidateRules(4);
    release([{ ...row, id: 99 }]);
    expect((await stale).map(r => r.id)).toEqual([99]);
    (FunnelRule.findAll as jest.Mock).mockResolvedValueOnce([row]);
    expect((await activeRules(4, 1)).map(r => r.id)).toEqual([1]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/ruleCache.spec.ts`
Expected: FAIL com "Cannot find module '../ruleCache'".

- [ ] **Step 4: Implementar**

`whatsapp-api/src/services/CrmServices/ruleCache.ts`:

```ts
import { hasPlanFeature } from "../../helpers/planFeature";
import Funnel from "../../models/Funnel";
import FunnelRule from "../../models/FunnelRule";
import FunnelStage from "../../models/FunnelStage";

export interface ActiveRule {
  id: number;
  funnelId: number;
  stageId: number;
  whatsappId: number | null;
  queueId: number | null;
}

export const RULE_CACHE_MS = 60 * 1000;

// Every inbound message asks for the company's rules, so they live in memory.
const cache = new Map<number, { at: number; rules: ActiveRule[] }>();
// Bumped on invalidation so a load that started before it is not kept.
const versions = new Map<number, number>();

export const invalidateRules = (companyId: number): void => {
  cache.delete(companyId);
  versions.set(companyId, (versions.get(companyId) || 0) + 1);
};

const load = async (companyId: number): Promise<ActiveRule[]> => {
  if (!(await hasPlanFeature(companyId, "useCrm"))) return [];
  const rows = await FunnelRule.findAll({
    where: { companyId, active: true },
    attributes: ["id", "funnelId", "stageId", "whatsappId", "queueId"],
    include: [
      { model: Funnel, as: "funnel", where: { archived: false }, required: true, attributes: [] },
      { model: FunnelStage, as: "stage", where: { kind: "open", archived: false }, required: true, attributes: [] }
    ],
    order: [["id", "ASC"]]
  });
  return rows.map(r => ({
    id: r.id,
    funnelId: r.funnelId,
    stageId: r.stageId,
    whatsappId: r.whatsappId ?? null,
    queueId: r.queueId ?? null
  }));
};

// Active rules whose funnel and stage can still take deals.
export const activeRules = async (companyId: number, now: number = Date.now()): Promise<ActiveRule[]> => {
  const hit = cache.get(companyId);
  if (hit && now - hit.at < RULE_CACHE_MS) return hit.rules;
  const version = versions.get(companyId) || 0;
  const rules = await load(companyId);
  if ((versions.get(companyId) || 0) === version) cache.set(companyId, { at: now, rules });
  return rules;
};
```

- [ ] **Step 5: Invalidar quando o funil ou a coluna mudam**

Em `FunnelService.ts`, importar `import { invalidateRules } from "./ruleCache";` e trocar `emitFunnel` por:

```ts
export const emitFunnel = (companyId: number, funnelId: number): void => {
  // Archiving a funnel or a stage changes which rules can still fire.
  invalidateRules(companyId);
  getIO().emit(`company-${companyId}-funnel`, { action: "update", funnelId });
};
```

(Manter o corpo atual do `emit` igual. Só a linha `invalidateRules` é nova.)

- [ ] **Step 6: Rodar os testes**

Run: `cd whatsapp-api && npx jest src/services/CrmServices && npx tsc --noEmit -p .`
Expected: PASS. Se `FunnelService.spec.ts` reclamar do import novo, acrescente `jest.mock("../ruleCache", () => ({ invalidateRules: jest.fn() }));` no topo dele.

- [ ] **Step 7: Commit**

```bash
cd whatsapp-api
git add src/models/FunnelRule.ts src/services/CrmServices/ruleCache.ts src/services/CrmServices/__tests__/ruleCache.spec.ts src/services/CrmServices/FunnelService.ts src/services/CrmServices/__tests__/FunnelService.spec.ts
git commit -m "Guarda em memória as regras ativas do CRM por 60 segundos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cadastro de regras (serviço, rotas e controller)

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/FunnelRuleService.ts`
- Create: `whatsapp-api/src/services/CrmServices/__tests__/FunnelRuleService.spec.ts`
- Modify: `whatsapp-api/src/controllers/CrmController.ts`
- Modify: `whatsapp-api/src/routes/crmRoutes.ts`

**Interfaces:**
- Consumes: `emitFunnel(companyId, funnelId)` de `FunnelService.ts`, que já invalida o cache (Task 2).
- Produces: `listRules(companyId): Promise<FunnelRule[]>`, `createRule(companyId, data: RuleInput): Promise<FunnelRule>`, `updateRule(companyId, id, data: RuleInput): Promise<FunnelRule>`, `deleteRule(companyId, id): Promise<void>`. Rotas `GET /crm/rules`, `POST /crm/rules` (201), `PUT /crm/rules/:id` e `DELETE /crm/rules/:id` (204). O corpo é `{ funnelId, stageId, whatsappId?, queueId?, active? }`, e a resposta é a linha da regra com esses campos mais `id`. `ERR_CRM_RULE_INVALID` (400) e `ERR_CRM_NOT_FOUND` (404).

- [ ] **Step 1: Escrever o teste que falha**

`whatsapp-api/src/services/CrmServices/__tests__/FunnelRuleService.spec.ts`:

```ts
import FunnelRule from "../../../models/FunnelRule";
import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Whatsapp from "../../../models/Whatsapp";
import Queue from "../../../models/Queue";
import { emitFunnel } from "../FunnelService";
import { createRule, updateRule, deleteRule } from "../FunnelRuleService";

jest.mock("../FunnelService", () => ({ emitFunnel: jest.fn() }));
jest.mock("../../../models/FunnelRule", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

const targetsOk = () => {
  (Funnel.findOne as jest.Mock).mockResolvedValue({ id: 5 });
  (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 25 });
  (Whatsapp.findOne as jest.Mock).mockResolvedValue({ id: 2 });
  (Queue.findOne as jest.Mock).mockResolvedValue({ id: 3 });
};

beforeEach(() => {
  jest.clearAllMocks();
  targetsOk();
  (FunnelRule.create as jest.Mock).mockImplementation(async (data: any) => ({ id: 1, ...data }));
});

describe("createRule", () => {
  it("saves a rule for this company's open stage and announces it", async () => {
    const rule = await createRule(4, { funnelId: 5, stageId: 25, whatsappId: 2, queueId: "" as any });
    expect(FunnelRule.create).toHaveBeenCalledWith({
      companyId: 4, funnelId: 5, stageId: 25, whatsappId: 2, queueId: null, active: true
    });
    expect(FunnelStage.findOne).toHaveBeenCalledWith({
      where: { id: 25, funnelId: 5, companyId: 4, kind: "open", archived: false }
    });
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
    expect(rule.id).toBe(1);
  });
  it("refuses a connection from another company", async () => {
    (Whatsapp.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { funnelId: 5, stageId: 25, whatsappId: 99 })).rejects.toMatchObject({
      message: "ERR_CRM_RULE_INVALID", statusCode: 400
    });
    expect(Whatsapp.findOne).toHaveBeenCalledWith({ where: { id: 99, companyId: 4 } });
    expect(FunnelRule.create).not.toHaveBeenCalled();
  });
  it("refuses an archived funnel, a won/lost stage or a missing stage", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { funnelId: 5, stageId: 26 })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
    await expect(createRule(4, { funnelId: 5 } as any)).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
    await expect(createRule(4, { funnelId: 5, stageId: -1 })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
  });
});

describe("updateRule", () => {
  const saved = (data: any) => ({ id: 1, companyId: 4, funnelId: 5, stageId: 25, whatsappId: null, queueId: null, active: true, ...data, update: jest.fn(async function (this: any, patch: any) { return { ...this, ...patch }; }) });

  it("lets the admin turn off a rule whose funnel was archived", async () => {
    const rule = saved({});
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(rule);
    (Funnel.findOne as jest.Mock).mockResolvedValue(null);
    await updateRule(4, 1, { active: false });
    expect(rule.update).toHaveBeenCalledWith({ active: false });
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
  });
  it("validates the targets when the rule stays or turns active", async () => {
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(saved({ active: false }));
    (Funnel.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 1, { active: true })).rejects.toMatchObject({ message: "ERR_CRM_RULE_INVALID" });
  });
  it("only finds this company's rules", async () => {
    (FunnelRule.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 1, { active: false })).rejects.toMatchObject({ statusCode: 404 });
    expect(FunnelRule.findOne).toHaveBeenCalledWith({ where: { id: 1, companyId: 4 } });
  });
});

describe("deleteRule", () => {
  it("removes the rule and announces it", async () => {
    const destroy = jest.fn();
    (FunnelRule.findOne as jest.Mock).mockResolvedValue({ id: 1, funnelId: 5, destroy });
    await deleteRule(4, 1);
    expect(destroy).toHaveBeenCalled();
    expect(emitFunnel).toHaveBeenCalledWith(4, 5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/FunnelRuleService.spec.ts`
Expected: FAIL com "Cannot find module '../FunnelRuleService'".

- [ ] **Step 3: Implementar o serviço**

`whatsapp-api/src/services/CrmServices/FunnelRuleService.ts`:

```ts
import AppError from "../../errors/AppError";
import Funnel from "../../models/Funnel";
import FunnelRule from "../../models/FunnelRule";
import FunnelStage from "../../models/FunnelStage";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import { emitFunnel } from "./FunnelService";

export interface RuleInput {
  funnelId?: number;
  stageId?: number;
  whatsappId?: number | null;
  queueId?: number | null;
  active?: boolean;
}

interface RuleTargets {
  funnelId: number;
  stageId: number;
  whatsappId: number | null;
  queueId: number | null;
}

const invalid = () => new AppError("ERR_CRM_RULE_INVALID", 400);

const requiredId = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalid();
  return n;
};

// Empty select values arrive as "" or null and mean "any".
const optionalId = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : requiredId(value);

// Funnel and stage must still take deals; connection and queue must be ours.
const assertTargets = async (companyId: number, r: RuleTargets): Promise<void> => {
  const [funnel, stage, whatsapp, queue] = await Promise.all([
    Funnel.findOne({ where: { id: r.funnelId, companyId, archived: false } }),
    FunnelStage.findOne({ where: { id: r.stageId, funnelId: r.funnelId, companyId, kind: "open", archived: false } }),
    r.whatsappId ? Whatsapp.findOne({ where: { id: r.whatsappId, companyId } }) : true,
    r.queueId ? Queue.findOne({ where: { id: r.queueId, companyId } }) : true
  ]);
  if (!funnel || !stage || !whatsapp || !queue) throw invalid();
};

export const listRules = (companyId: number): Promise<FunnelRule[]> =>
  FunnelRule.findAll({ where: { companyId }, order: [["id", "ASC"]] });

export const createRule = async (companyId: number, data: RuleInput): Promise<FunnelRule> => {
  const targets: RuleTargets = {
    funnelId: requiredId(data.funnelId),
    stageId: requiredId(data.stageId),
    whatsappId: optionalId(data.whatsappId),
    queueId: optionalId(data.queueId)
  };
  await assertTargets(companyId, targets);
  const rule = await FunnelRule.create({ companyId, ...targets, active: data.active !== false } as any);
  emitFunnel(companyId, rule.funnelId);
  return rule;
};

const findRule = async (companyId: number, id: number): Promise<FunnelRule> => {
  const rule = await FunnelRule.findOne({ where: { id, companyId } });
  if (!rule) throw new AppError("ERR_CRM_NOT_FOUND", 404);
  return rule;
};

export const updateRule = async (companyId: number, id: number, data: RuleInput): Promise<FunnelRule> => {
  const rule = await findRule(companyId, id);
  const patch: Partial<RuleTargets> & { active?: boolean } = {};
  if (data.funnelId !== undefined) patch.funnelId = requiredId(data.funnelId);
  if (data.stageId !== undefined) patch.stageId = requiredId(data.stageId);
  if (data.whatsappId !== undefined) patch.whatsappId = optionalId(data.whatsappId);
  if (data.queueId !== undefined) patch.queueId = optionalId(data.queueId);
  if (data.active !== undefined) patch.active = !!data.active;
  const next = {
    funnelId: patch.funnelId ?? rule.funnelId,
    stageId: patch.stageId ?? rule.stageId,
    whatsappId: patch.whatsappId !== undefined ? patch.whatsappId : rule.whatsappId,
    queueId: patch.queueId !== undefined ? patch.queueId : rule.queueId
  };
  // Turning a rule off must work even after its funnel was archived.
  if (patch.active ?? rule.active) await assertTargets(companyId, next);
  const saved = await rule.update(patch);
  emitFunnel(companyId, next.funnelId);
  return saved;
};

export const deleteRule = async (companyId: number, id: number): Promise<void> => {
  const rule = await findRule(companyId, id);
  await rule.destroy();
  emitFunnel(companyId, rule.funnelId);
};
```

- [ ] **Step 4: Rodar o teste do serviço**

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/FunnelRuleService.spec.ts`
Expected: PASS.

- [ ] **Step 5: Controller e rotas**

Em `CrmController.ts`, acrescentar o import e os handlers no fim:

```ts
import { listRules, createRule, updateRule, deleteRule } from "../services/CrmServices/FunnelRuleService";
```

```ts
export const listRulesHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await listRules(req.user.companyId));
};

export const createRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.status(201).json(await createRule(req.user.companyId, req.body));
};

export const updateRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateRule(req.user.companyId, num(req.params.id), req.body));
};

export const deleteRuleHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  await deleteRule(req.user.companyId, num(req.params.id));
  return res.status(204).send();
};
```

Em `crmRoutes.ts`, antes de `export default crmRoutes;`:

```ts
crmRoutes.get("/crm/rules", isAuth, crmInPlan, CrmController.listRulesHandler);
crmRoutes.post("/crm/rules", isAuth, crmInPlan, CrmController.createRuleHandler);
crmRoutes.put("/crm/rules/:id", isAuth, crmInPlan, CrmController.updateRuleHandler);
crmRoutes.delete("/crm/rules/:id", isAuth, crmInPlan, CrmController.deleteRuleHandler);
```

- [ ] **Step 6: Rodar tudo e checar tipos**

Run: `cd whatsapp-api && npx jest src/services/CrmServices && npx tsc --noEmit -p .`
Expected: PASS, sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
cd whatsapp-api
git add src/services/CrmServices/FunnelRuleService.ts src/services/CrmServices/__tests__/FunnelRuleService.spec.ts src/controllers/CrmController.ts src/routes/crmRoutes.ts
git commit -m "Adiciona a API das regras de criação automática do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Aplicar as regras ao ticket

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/ApplyFunnelRulesService.ts`
- Create: `whatsapp-api/src/services/CrmServices/__tests__/ApplyFunnelRulesService.spec.ts`

**Interfaces:**
- Consumes: `activeRules(companyId)` e `ActiveRule` (Task 2); `lockContactFunnel` e `findOpenDeal` (Task 1); `topPosition`, `loadCard` e `emitDeal` de `DealService.ts`.
- Produces: `matchesRule(rule: ActiveRule, ticket: { whatsappId: number | null; queueId: number | null }): boolean`, `queueEntered(oldQueueId: number | null | undefined, newQueueId: number | null | undefined): boolean` e `default ApplyFunnelRulesService(ticket: RuleTicket): Promise<number[]>`, que devolve os ids dos negócios criados e nunca rejeita.

- [ ] **Step 1: Escrever o teste que falha**

`whatsapp-api/src/services/CrmServices/__tests__/ApplyFunnelRulesService.spec.ts`:

```ts
import Deal from "../../../models/Deal";
import DealEvent from "../../../models/DealEvent";
import Contact from "../../../models/Contact";
import { activeRules } from "../ruleCache";
import { findOpenDeal, lockContactFunnel } from "../contactLock";
import { emitDeal } from "../DealService";
import ApplyFunnelRulesService, { matchesRule, queueEntered } from "../ApplyFunnelRulesService";

jest.mock("../ruleCache", () => ({ activeRules: jest.fn() }));
jest.mock("../contactLock", () => ({ findOpenDeal: jest.fn(), lockContactFunnel: jest.fn() }));
jest.mock("../DealService", () => ({
  topPosition: jest.fn().mockResolvedValue(-1024),
  loadCard: jest.fn(async (_c: number, id: number) => ({ id, funnelId: 5, stageId: 25 })),
  emitDeal: jest.fn()
}));
jest.mock("../../../models/Deal", () => ({
  __esModule: true,
  default: { create: jest.fn(), sequelize: { transaction: (fn: any) => fn({ id: "t" }) } }
}));
jest.mock("../../../models/DealEvent", () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../utils/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

const rule = (data: any = {}) => ({ id: 1, funnelId: 5, stageId: 25, whatsappId: null, queueId: null, ...data });
const ticket = { id: 9, companyId: 4, contactId: 77, whatsappId: 2, queueId: 3, userId: 12, isGroup: false };

beforeEach(() => {
  jest.clearAllMocks();
  (activeRules as jest.Mock).mockResolvedValue([rule()]);
  (findOpenDeal as jest.Mock).mockResolvedValue(null);
  (Contact.findOne as jest.Mock).mockResolvedValue({ id: 77, name: "Maria", number: "5511999990000" });
  let next = 100;
  (Deal.create as jest.Mock).mockImplementation(async () => ({ id: next++ }));
});

describe("matchesRule", () => {
  it("treats empty rule fields as 'any'", () => {
    expect(matchesRule(rule(), { whatsappId: 2, queueId: null })).toBe(true);
    expect(matchesRule(rule({ whatsappId: 2 }), { whatsappId: 2, queueId: null })).toBe(true);
    expect(matchesRule(rule({ whatsappId: 2 }), { whatsappId: 6, queueId: null })).toBe(false);
    expect(matchesRule(rule({ whatsappId: 2, queueId: 3 }), { whatsappId: 2, queueId: null })).toBe(false);
    expect(matchesRule(rule({ whatsappId: 2, queueId: 3 }), { whatsappId: 2, queueId: 3 })).toBe(true);
  });
});

describe("queueEntered", () => {
  it("is true only when the ticket lands on a new, non-empty queue", () => {
    expect(queueEntered(null, 3)).toBe(true);
    expect(queueEntered(2, 3)).toBe(true);
    expect(queueEntered(3, 3)).toBe(false);
    expect(queueEntered(3, null)).toBe(false);
    expect(queueEntered(undefined, undefined)).toBe(false);
  });
});

describe("ApplyFunnelRulesService", () => {
  it("creates the deal on the rule's stage, owned by the ticket's user", async () => {
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100]);
    expect(Deal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4, funnelId: 5, stageId: 25, contactId: 77, userId: 12,
        title: "Maria", value: 0, status: "open", position: -1024
      }),
      { transaction: { id: "t" } }
    );
    expect(DealEvent.create).toHaveBeenCalledWith(
      { companyId: 4, dealId: 100, userId: null, type: "created", toValue: "25" },
      { transaction: { id: "t" } }
    );
    expect(emitDeal).toHaveBeenCalledWith(4, "create", { id: 100, funnelId: 5, stageId: 25 });
  });
  it("checks for an open deal inside the lock and skips when there is one", async () => {
    (findOpenDeal as jest.Mock).mockResolvedValue({ id: 50 });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([]);
    expect(lockContactFunnel).toHaveBeenCalledWith(4, 77, 5, { id: "t" });
    expect(findOpenDeal).toHaveBeenCalledWith(4, 5, 77, { id: "t" });
    expect(Deal.create).not.toHaveBeenCalled();
  });
  it("creates one deal per funnel when two of its rules match", async () => {
    (activeRules as jest.Mock).mockResolvedValue([rule({ id: 1, whatsappId: 2 }), rule({ id: 2, stageId: 26, queueId: 3 }), rule({ id: 3, funnelId: 6, stageId: 30 })]);
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100, 101]);
    expect((Deal.create as jest.Mock).mock.calls.map(c => [c[0].funnelId, c[0].stageId])).toEqual([[5, 25], [6, 30]]);
  });
  it("leaves the owner empty when nobody holds the ticket", async () => {
    await ApplyFunnelRulesService({ ...ticket, userId: null });
    expect((Deal.create as jest.Mock).mock.calls[0][0].userId).toBeNull();
  });
  it("ignores groups and rules that do not match", async () => {
    expect(await ApplyFunnelRulesService({ ...ticket, isGroup: true })).toEqual([]);
    (activeRules as jest.Mock).mockResolvedValue([rule({ queueId: 8 })]);
    expect(await ApplyFunnelRulesService(ticket)).toEqual([]);
    expect(Deal.create).not.toHaveBeenCalled();
  });
  it("keeps going after one rule fails and never throws", async () => {
    (activeRules as jest.Mock).mockResolvedValue([rule(), rule({ id: 2, funnelId: 6, stageId: 30 })]);
    (Deal.create as jest.Mock).mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ id: 101 });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([101]);
    (activeRules as jest.Mock).mockRejectedValue(new Error("cache down"));
    await expect(ApplyFunnelRulesService(ticket)).resolves.toEqual([]);
  });
  it("still reports the deal when the board broadcast fails", async () => {
    (emitDeal as jest.Mock).mockImplementationOnce(() => { throw new Error("socket"); });
    expect(await ApplyFunnelRulesService(ticket)).toEqual([100]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/ApplyFunnelRulesService.spec.ts`
Expected: FAIL com "Cannot find module '../ApplyFunnelRulesService'".

- [ ] **Step 3: Implementar**

`whatsapp-api/src/services/CrmServices/ApplyFunnelRulesService.ts`:

```ts
import Contact from "../../models/Contact";
import Deal from "../../models/Deal";
import DealEvent from "../../models/DealEvent";
import { logger } from "../../utils/logger";
import { findOpenDeal, lockContactFunnel } from "./contactLock";
import { emitDeal, loadCard, topPosition } from "./DealService";
import { ActiveRule, activeRules } from "./ruleCache";

export interface RuleTicket {
  id: number;
  companyId: number;
  contactId: number;
  whatsappId: number | null;
  queueId: number | null;
  userId: number | null;
  isGroup: boolean;
}

// An empty field on the rule means "any".
export const matchesRule = (rule: ActiveRule, t: { whatsappId: number | null; queueId: number | null }): boolean =>
  (rule.whatsappId === null || rule.whatsappId === t.whatsappId) &&
  (rule.queueId === null || rule.queueId === t.queueId);

export const queueEntered = (oldQueueId: number | null | undefined, newQueueId: number | null | undefined): boolean =>
  !!newQueueId && newQueueId !== oldQueueId;

// Creates the deal unless the contact already has an open one in the funnel.
const createFromRule = (ticket: RuleTicket, rule: ActiveRule): Promise<number | null> =>
  Deal.sequelize!.transaction(async transaction => {
    const { companyId, contactId } = ticket;
    await lockContactFunnel(companyId, contactId, rule.funnelId, transaction);
    if (await findOpenDeal(companyId, rule.funnelId, contactId, transaction)) return null;
    const contact = await Contact.findOne({ where: { id: contactId, companyId }, attributes: ["id", "name", "number"], transaction });
    if (!contact) return null;
    const deal = await Deal.create(
      {
        companyId,
        funnelId: rule.funnelId,
        stageId: rule.stageId,
        contactId,
        userId: ticket.userId ?? null,
        title: contact.name || contact.number,
        value: 0,
        source: null,
        notes: null,
        status: "open",
        position: await topPosition(companyId, rule.stageId, transaction),
        stageEnteredAt: new Date()
      } as any,
      { transaction }
    );
    await DealEvent.create(
      { companyId, dealId: deal.id, userId: null, type: "created", toValue: String(rule.stageId) } as any,
      { transaction }
    );
    return deal.id;
  });

// Runs the company's automatic rules for a ticket. Never throws: a broken
// rule must not stop the message that triggered it.
const ApplyFunnelRulesService = async (ticket: RuleTicket): Promise<number[]> => {
  if (!ticket || ticket.isGroup) return [];
  const created: number[] = [];
  try {
    const rules = (await activeRules(ticket.companyId)).filter(r => matchesRule(r, ticket));
    // Rules come ordered by id; the first one wins for its funnel.
    const funnels = new Set<number>();
    for (const rule of rules) {
      if (funnels.has(rule.funnelId)) continue;
      funnels.add(rule.funnelId);
      try {
        const dealId = await createFromRule(ticket, rule);
        if (dealId) created.push(dealId);
      } catch (err) {
        logger.error(`CRM rule ${rule.id}: could not create deal for ticket ${ticket.id}: ${err}`);
      }
    }
  } catch (err) {
    logger.error(`CRM rules: could not apply to ticket ${ticket.id}: ${err}`);
  }
  for (const dealId of created) {
    try {
      emitDeal(ticket.companyId, "create", await loadCard(ticket.companyId, dealId));
    } catch (err) {
      logger.warn(`CRM rules: deal ${dealId} saved but not broadcast: ${err}`);
    }
  }
  return created;
};

export default ApplyFunnelRulesService;
```

- [ ] **Step 4: Rodar os testes**

Run: `cd whatsapp-api && npx jest src/services/CrmServices && npx tsc --noEmit -p .`
Expected: PASS, sem erros de tipo. Se `contact.number` não existir no tipo `Contact`, confirme o nome da coluna em `src/models/Contact.ts` antes de mudar o teste.

- [ ] **Step 5: Commit**

```bash
cd whatsapp-api
git add src/services/CrmServices/ApplyFunnelRulesService.ts src/services/CrmServices/__tests__/ApplyFunnelRulesService.spec.ts
git commit -m "Cria negócios pelas regras automáticas do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ligar as regras à mensagem recebida e à troca de fila

**Files:**
- Modify: `whatsapp-api/src/services/InboundServices/ProcessInboundMessage.ts` (logo depois de `const ticket = await FindOrCreateTicketService(...)`, por volta da linha 267)
- Modify: `whatsapp-api/src/services/TicketServices/UpdateTicketService.ts` (logo depois de `await ticket.reload();`, por volta da linha 362)
- Create: `whatsapp-api/scripts/crm-rules-smoke.sh`

**Interfaces:**
- Consumes: `ApplyFunnelRulesService` (default) e `queueEntered` (Task 4).

As chamadas usam `void`, sem `await`. A mensagem segue enquanto a regra roda, e o lock da Task 1 impede que a chamada da mensagem e a da troca de fila, quando chegam juntas, criem dois negócios. `isGroup` já é checado dentro do serviço.

- [ ] **Step 1: Mensagem recebida**

Em `ProcessInboundMessage.ts`, acrescentar o import:

```ts
import ApplyFunnelRulesService from "../CrmServices/ApplyFunnelRulesService";
```

E logo depois do bloco `const ticket = await FindOrCreateTicketService(...);`:

```ts
    // CRM rules run alongside the message; the service logs its own failures.
    if (!inbound.fromMe && !isGroup) void ApplyFunnelRulesService(ticket as any);
```

- [ ] **Step 2: Troca de fila**

Em `UpdateTicketService.ts`, acrescentar o import:

```ts
import ApplyFunnelRulesService, { queueEntered } from "../CrmServices/ApplyFunnelRulesService";
```

E logo depois de `await ticket.reload();`:

```ts
    if (queueEntered(oldQueueId, ticket.queueId)) void ApplyFunnelRulesService(ticket as any);
```

As transferências do fluxo (`RunFlowService`), do agente de IA (`RunAiAgentService`), do Typebot e do atendente passam todas por `UpdateTicketService`, então este ponto cobre todas.

- [ ] **Step 3: Checar tipos e rodar a suíte inteira**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && npx jest`
Expected: sem erros de tipo e a suíte inteira passando, como estava antes da etapa.

- [ ] **Step 4: Script de smoke no HM**

`whatsapp-api/scripts/crm-rules-smoke.sh`:

```bash
#!/usr/bin/env bash
# Automatic CRM rules against a running backend. Needs an admin token, a
# non-group ticket and a queue of the same company. Usage:
#   TOKEN=<jwt> API=http://localhost:3001 TICKET_ID=<id> QUEUE_ID=<id> scripts/crm-rules-smoke.sh
set -euo pipefail
API=${API:-http://localhost:3001}
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
call() { curl -s -o /tmp/crm-rules.json -w "%{http_code}" -X "$1" "${H[@]}" "$API$2" ${3:+-d "$3"}; }
expect() { local got; got=$(call "$1" "$2" "${4:-}"); if [ "$got" != "$3" ]; then echo "FAIL $1 $2 -> $got (esperado $3)"; cat /tmp/crm-rules.json; exit 1; fi; echo "ok   $1 $2 -> $got"; }
jqv() { node -e "const d=require('/tmp/crm-rules.json');console.log($1)"; }

expect GET /crm/funnels 200
FUNNEL=$(jqv 'd.find(f=>!f.archived).id')
STAGE=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='open'&&!s.archived).id")
WON=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='won').id")
LOST=$(jqv "d.find(f=>f.id===$FUNNEL).stages.find(s=>s.kind==='lost').id")
expect GET /crm/loss-reasons 200
REASON=$(jqv 'd.find(r=>r.active).id')
expect POST /crm/rules 400 "{\"funnelId\":$FUNNEL,\"stageId\":$WON}"
expect POST /crm/rules 400 "{\"funnelId\":$FUNNEL,\"stageId\":$STAGE,\"queueId\":999999}"
expect POST /crm/rules 201 "{\"funnelId\":$FUNNEL,\"stageId\":$STAGE,\"queueId\":$QUEUE_ID}"
RULE=$(jqv 'd.id')
expect GET /crm/rules 200

expect GET /tickets/$TICKET_ID 200
CONTACT=$(jqv 'd.contactId')
# Leave the queue and close the contact's open deals in this funnel, then enter the queue.
expect PUT /tickets/$TICKET_ID 200 '{"queueId":null}'
expect GET /crm/contacts/$CONTACT/deals 200
for id in $(jqv "d.filter(x=>x.funnelId===$FUNNEL).map(x=>x.id).join(' ')"); do
  expect PUT /crm/deals/$id/move 200 "{\"stageId\":$LOST,\"lossReasonId\":$REASON}"
done
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$QUEUE_ID}"
sleep 2
expect GET /crm/contacts/$CONTACT/deals 200
COUNT=$(jqv "d.filter(x=>x.funnelId===$FUNNEL).length")
if [ "$COUNT" != "1" ]; then echo "FAIL esperado 1 negócio aberto no funil $FUNNEL, veio $COUNT"; exit 1; fi
echo "ok   regra criou o negócio ao entrar na fila"
# Entering the same queue again must not create a second deal.
expect PUT /tickets/$TICKET_ID 200 '{"queueId":null}'
expect PUT /tickets/$TICKET_ID 200 "{\"queueId\":$QUEUE_ID}"
sleep 2
expect GET /crm/contacts/$CONTACT/deals 200
COUNT=$(jqv "d.filter(x=>x.funnelId===$FUNNEL).length")
if [ "$COUNT" != "1" ]; then echo "FAIL segundo negócio criado ($COUNT)"; exit 1; fi
echo "ok   sem negócio duplicado"
expect PUT /crm/rules/$RULE 200 '{"active":false}'
expect DELETE /crm/rules/$RULE 204
echo "smoke das regras ok"
```

Antes de rodar, confira o formato de `PUT /tickets/:id` em `src/controllers/TicketController.ts`. Se o corpo esperado for diferente de `{ queueId }`, ajuste o script e não o serviço. O script move para Perdido os negócios abertos do contato no funil escolhido, e a troca de fila pode mandar a mensagem automática de transferência para o contato. Rode só no HM, com um contato de teste.

- [ ] **Step 5: Rodar no HM**

No HM (Docker deste notebook): rebuild e restart do container da api do HM, depois:

```bash
cd whatsapp-api && chmod +x scripts/crm-rules-smoke.sh && TOKEN=<jwt admin do HM> API=http://localhost:3001 TICKET_ID=<ticket de teste> QUEUE_ID=<fila> scripts/crm-rules-smoke.sh
```

Expected: termina com "smoke das regras ok". No log da api não aparece "CRM rules: could not apply".

- [ ] **Step 6: Commit**

```bash
cd whatsapp-api
git add src/services/InboundServices/ProcessInboundMessage.ts src/services/TicketServices/UpdateTicketService.ts scripts/crm-rules-smoke.sh
git commit -m "Aplica as regras do CRM na mensagem recebida e na troca de fila

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Regras puras da tela

**Files:**
- Create: `whatsapp-app/src/pages/FunnelSettings/rules.js`
- Create: `whatsapp-app/src/pages/FunnelSettings/rules.test.js`

**Interfaces:**
- Consumes: o formato de `GET /crm/funnels?includeArchived=true` (funil com `archived` e `stages[]` com `kind`, `archived` e `position`).
- Produces: `activeFunnels(funnels)`, `ruleStages(funnels, funnelId)` (colunas abertas e não arquivadas, em ordem), `ruleProblem(rule, funnels): string | null`, `ruleScope(rule, whatsApps, queues): string`, `isBroad(rule): boolean` e `stageLabel(rule, funnels): string`.

- [ ] **Step 1: Escrever o teste que falha**

`whatsapp-app/src/pages/FunnelSettings/rules.test.js`:

```js
import { activeFunnels, ruleStages, ruleProblem, ruleScope, isBroad, stageLabel } from "./rules";

const funnels = [
  {
    id: 5, name: "Vendas", archived: false,
    stages: [
      { id: 26, name: "Proposta", kind: "open", position: 2048, archived: false },
      { id: 25, name: "Novo", kind: "open", position: 1024, archived: false },
      { id: 27, name: "Velha", kind: "open", position: 3072, archived: true },
      { id: 28, name: "Ganho", kind: "won", position: 0, archived: false },
    ],
  },
  { id: 6, name: "Antigo", archived: true, stages: [{ id: 30, name: "Novo", kind: "open", position: 1024, archived: false }] },
];
const whatsApps = [{ id: 2, name: "Comercial" }];
const queues = [{ id: 3, name: "Vendas" }];

describe("activeFunnels / ruleStages", () => {
  it("offers only active funnels and their open, non-archived stages in order", () => {
    expect(activeFunnels(funnels).map((f) => f.id)).toEqual([5]);
    expect(ruleStages(funnels, 5).map((s) => s.id)).toEqual([25, 26]);
    expect(ruleStages(funnels, 99)).toEqual([]);
  });
});

describe("ruleProblem", () => {
  it("explains why a saved rule stopped creating deals", () => {
    expect(ruleProblem({ funnelId: 5, stageId: 25 }, funnels)).toBeNull();
    expect(ruleProblem({ funnelId: 6, stageId: 30 }, funnels)).toBe("O funil desta regra está arquivado.");
    expect(ruleProblem({ funnelId: 7, stageId: 1 }, funnels)).toBe("O funil desta regra foi removido.");
    expect(ruleProblem({ funnelId: 5, stageId: 27 }, funnels)).toBe("A coluna desta regra foi arquivada.");
  });
});

describe("ruleScope / isBroad / stageLabel", () => {
  it("describes which conversations the rule watches", () => {
    expect(ruleScope({ whatsappId: 2, queueId: null }, whatsApps, queues)).toBe("Conexão Comercial · qualquer fila");
    expect(ruleScope({ whatsappId: null, queueId: 3 }, whatsApps, queues)).toBe("Qualquer conexão · fila Vendas");
    expect(ruleScope({ whatsappId: 9, queueId: null }, whatsApps, queues)).toBe("Conexão removida · qualquer fila");
  });
  it("flags rules that catch every contact", () => {
    expect(isBroad({ whatsappId: null, queueId: null })).toBe(true);
    expect(isBroad({ whatsappId: "", queueId: "" })).toBe(true);
    expect(isBroad({ whatsappId: 2, queueId: null })).toBe(false);
  });
  it("names the target as funnel › stage", () => {
    expect(stageLabel({ funnelId: 5, stageId: 25 }, funnels)).toBe("Vendas › Novo");
    expect(stageLabel({ funnelId: 7, stageId: 1 }, funnels)).toBe("Funil removido");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FunnelSettings/rules`
Expected: FAIL com "Cannot find module './rules'".

- [ ] **Step 3: Implementar**

`whatsapp-app/src/pages/FunnelSettings/rules.js`:

```js
const byPosition = (a, b) => a.position - b.position || a.id - b.id;

export const activeFunnels = (funnels) => funnels.filter((f) => !f.archived);

// Stages a rule can drop new deals into.
export const ruleStages = (funnels, funnelId) => {
  const funnel = funnels.find((f) => f.id === funnelId);
  return funnel ? funnel.stages.filter((s) => s.kind === "open" && !s.archived).sort(byPosition) : [];
};

// Why a saved rule is not creating deals, or null when it is fine.
export const ruleProblem = (rule, funnels) => {
  const funnel = funnels.find((f) => f.id === rule.funnelId);
  if (!funnel) return "O funil desta regra foi removido.";
  if (funnel.archived) return "O funil desta regra está arquivado.";
  const stage = funnel.stages.find((s) => s.id === rule.stageId);
  if (!stage || stage.archived) return "A coluna desta regra foi arquivada.";
  return null;
};

const nameOf = (list, id, missing) => (list.find((x) => x.id === id) || { name: missing }).name;

export const ruleScope = (rule, whatsApps, queues) => {
  const connection = rule.whatsappId ? `Conexão ${nameOf(whatsApps, rule.whatsappId, "removida")}` : "Qualquer conexão";
  const queue = rule.queueId ? `fila ${nameOf(queues, rule.queueId, "removida")}` : "qualquer fila";
  return `${connection} · ${queue}`;
};

export const isBroad = (rule) => !rule.whatsappId && !rule.queueId;

export const stageLabel = (rule, funnels) => {
  const funnel = funnels.find((f) => f.id === rule.funnelId);
  if (!funnel) return "Funil removido";
  const stage = funnel.stages.find((s) => s.id === rule.stageId);
  return `${funnel.name} › ${stage ? stage.name : "coluna removida"}`;
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FunnelSettings`
Expected: PASS (`rules.test.js`, `order.test.js` e `ColorInput.test.js`).

- [ ] **Step 5: Commit**

```bash
cd whatsapp-app
git add src/pages/FunnelSettings/rules.js src/pages/FunnelSettings/rules.test.js
git commit -m "Adiciona as regras da tela de criação automática do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Aba "Criação automática"

**Files:**
- Create: `whatsapp-app/src/pages/FunnelSettings/Rules.js`
- Modify: `whatsapp-app/src/pages/FunnelSettings/index.js` (terceira aba)
- Modify: `whatsapp-app/src/translate/languages/pt.js` (junto aos outros `ERR_CRM_*`, por volta da linha 964)

**Interfaces:**
- Consumes: `/crm/rules` (Task 3), `GET /crm/funnels?includeArchived=true`, `GET /queue`, o hook `useWhatsApps` (`src/hooks/useWhatsApps`, que devolve `{ whatsApps, loading }`), `rules.js` (Task 6), `ConfirmationModal`, `socketConnection` e `createLatest` (como em `Funnels.js`).

Comportamento da aba:
- Texto no topo: "Quando uma conversa casa com a regra e o contato não tem negócio aberto no funil, um negócio é criado na coluna escolhida. O responsável é o atendente do ticket, se houver."
- Cada regra aparece numa linha com "Funil › Coluna" (`stageLabel`), o escopo (`ruleScope`), o aviso de `ruleProblem` (em `t.warningSoft`), um Switch "ativa" que salva na hora e um botão "Remover" com confirmação.
- O formulário "Nova regra" tem quatro selects: Funil (`activeFunnels`), Coluna (`ruleStages`, reiniciada ao trocar de funil), Conexão ("Qualquer conexão" + `whatsApps`) e Fila ("Qualquer fila" + filas). O botão "Adicionar regra" fica desabilitado sem funil e coluna.
- Com conexão e fila vazias (`isBroad`), aparece o aviso: "Esta regra vale para todo contato que mandar mensagem e não tiver negócio aberto neste funil."
- A aba recarrega ao receber `company-${companyId}-funnel`, protegida por `createLatest`, como em `Funnels.js`.

- [ ] **Step 1: Criar o componente**

`whatsapp-app/src/pages/FunnelSettings/Rules.js`:

```js
import React, { useCallback, useEffect, useRef, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";
import Switch from "@material-ui/core/Switch";
import Button from "@material-ui/core/Button";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import ConfirmationModal from "../../components/ConfirmationModal";
import useWhatsApps from "../../hooks/useWhatsApps";
import { socketConnection } from "../../services/socket";
import { createLatest } from "../Funnel/latest";
import { activeFunnels, ruleStages, ruleProblem, ruleScope, isBroad, stageLabel } from "./rules";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    hint: { fontSize: 13, color: t.textSecondary, margin: "0 0 16px", maxWidth: 640 },
    list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 },
    row: {
      display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
      border: `1px solid ${t.border}`, borderRadius: theme.radii.control,
    },
    text: { flex: 1, minWidth: 0 },
    target: { fontWeight: 600, color: t.textPrimary },
    scope: { fontSize: 13, color: t.textSecondary },
    warning: { fontSize: 13, color: t.warningText, background: t.warningSoft, padding: "8px 12px", borderRadius: 8, marginTop: 4 },
    empty: { fontSize: 14, color: t.textTertiary },
    form: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24, maxWidth: 720, alignItems: "center" },
    select: { minWidth: 160, flex: 1 },
    label: { width: "100%", margin: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: t.textTertiary },
  };
});

const EMPTY = { funnelId: "", stageId: "", whatsappId: "", queueId: "" };

const Rules = () => {
  const classes = useStyles();
  const { whatsApps } = useWhatsApps();
  const [rules, setRules] = useState([]);
  const [funnels, setFunnels] = useState([]);
  const [queues, setQueues] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [removing, setRemoving] = useState(null);
  const latest = useRef(createLatest());

  const load = useCallback(async () => {
    const request = latest.current.next();
    try {
      const [r, f] = await Promise.all([
        api.get("/crm/rules"),
        api.get("/crm/funnels", { params: { includeArchived: true } }),
      ]);
      if (!latest.current.isCurrent(request)) return;
      setRules(r.data);
      setFunnels(f.data);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => {
    load();
    api.get("/queue").then(({ data }) => setQueues(data)).catch(() => setQueues([]));
  }, [load]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketConnection({ companyId });
    socket.on(`company-${companyId}-funnel`, load);
    return () => socket.disconnect();
  }, [load]);

  const setActive = async (rule, active) => {
    setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, active } : r)));
    try {
      await api.put(`/crm/rules/${rule.id}`, { active });
    } catch (err) {
      toastError(err);
    }
    load();
  };

  const remove = async () => {
    const rule = removing;
    setRemoving(null);
    try {
      await api.delete(`/crm/rules/${rule.id}`);
    } catch (err) {
      toastError(err);
    }
    load();
  };

  const add = async (e) => {
    e.preventDefault();
    if (!draft.funnelId || !draft.stageId) return;
    try {
      await api.post("/crm/rules", {
        funnelId: draft.funnelId,
        stageId: draft.stageId,
        whatsappId: draft.whatsappId || null,
        queueId: draft.queueId || null,
      });
      setDraft(EMPTY);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const stages = ruleStages(funnels, draft.funnelId);

  return (
    <section aria-label="Criação automática">
      <p className={classes.hint}>
        Quando uma conversa casa com a regra e o contato não tem negócio aberto no funil, um negócio é criado na coluna
        escolhida. O responsável é o atendente do ticket, se houver.
      </p>
      {rules.length === 0 ? (
        <p className={classes.empty}>Nenhuma regra. Os negócios só são criados à mão.</p>
      ) : (
        <ul className={classes.list}>
          {rules.map((rule) => {
            const problem = ruleProblem(rule, funnels);
            const label = stageLabel(rule, funnels);
            return (
              <li key={rule.id} className={classes.row}>
                <div className={classes.text}>
                  <div className={classes.target}>{label}</div>
                  <div className={classes.scope}>{ruleScope(rule, whatsApps, queues)}</div>
                  {problem && rule.active && <div className={classes.warning}>{problem}</div>}
                </div>
                <Switch
                  color="primary"
                  checked={rule.active}
                  onChange={(e) => setActive(rule, e.target.checked)}
                  inputProps={{ "aria-label": `Regra ${label} ativa` }}
                />
                <Button size="small" onClick={() => setRemoving(rule)}>Remover</Button>
              </li>
            );
          })}
        </ul>
      )}

      <form className={classes.form} onSubmit={add} aria-label="Nova regra">
        <p className={classes.label}>Nova regra</p>
        <TextField
          select size="small" variant="outlined" label="Funil" className={classes.select}
          value={draft.funnelId}
          onChange={(e) => setDraft({ ...draft, funnelId: e.target.value, stageId: "" })}
        >
          {activeFunnels(funnels).map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" variant="outlined" label="Coluna" className={classes.select}
          value={draft.stageId} disabled={!draft.funnelId}
          onChange={(e) => setDraft({ ...draft, stageId: e.target.value })}
        >
          {stages.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" variant="outlined" label="Conexão" className={classes.select}
          value={draft.whatsappId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
          onChange={(e) => setDraft({ ...draft, whatsappId: e.target.value })}
        >
          <MenuItem value="">Qualquer conexão</MenuItem>
          {whatsApps.map((w) => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" variant="outlined" label="Fila" className={classes.select}
          value={draft.queueId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
          onChange={(e) => setDraft({ ...draft, queueId: e.target.value })}
        >
          <MenuItem value="">Qualquer fila</MenuItem>
          {queues.map((q) => <MenuItem key={q.id} value={q.id}>{q.name}</MenuItem>)}
        </TextField>
        <Button type="submit" variant="contained" color="primary" disabled={!draft.funnelId || !draft.stageId}>
          Adicionar regra
        </Button>
        {draft.funnelId && isBroad(draft) && (
          <div className={classes.warning} style={{ width: "100%" }}>
            Esta regra vale para todo contato que mandar mensagem e não tiver negócio aberto neste funil.
          </div>
        )}
      </form>

      <ConfirmationModal
        title="Remover esta regra?"
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      >
        Negócios já criados por ela continuam no funil. Para pausar sem perder a regra, desligue a chave.
      </ConfirmationModal>
    </section>
  );
};

export default Rules;
```

`useWhatsApps` devolve `{ whatsApps, loading }`. `ConfirmationModal` chama `onClose(false)` e em seguida `onConfirm()`. Por isso `remove` lê a regra do `removing` da mesma renderização, e limpar o estado antes não perde a regra.

- [ ] **Step 2: Registrar a aba**

Em `index.js`, importar `import Rules from "./Rules";`, acrescentar a aba entre Funis e Motivos de perda e trocar o conteúdo do painel:

```js
        <Tab label="Funis" />
        <Tab label="Criação automática" />
        <Tab label="Motivos de perda" />
```

```js
      <div className={classes.panel}>{tab === 0 ? <Funnels /> : tab === 1 ? <Rules /> : <LossReasons />}</div>
```

- [ ] **Step 3: Tradução do erro**

Em `src/translate/languages/pt.js`, depois de `ERR_CRM_INVALID_DATE`:

```js
        ERR_CRM_RULE_INVALID: "Escolha um funil ativo, uma coluna aberta e uma conexão e fila desta empresa.",
```

- [ ] **Step 4: Build e testes**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FunnelSettings && npx eslint src/pages/FunnelSettings`
Expected: testes passando e nenhum erro do eslint. Warnings que já existiam antes podem continuar.

- [ ] **Step 5: Conferir no navegador (HM)**

Suba o app do HM e abra `/funil/configuracoes` → "Criação automática" como admin. Confira:
- Criar uma regra "Vendas › primeira coluna, fila X" faz ela aparecer na lista.
- Arquivar o funil na aba Funis faz aparecer, de volta na aba de regras, o aviso "O funil desta regra está arquivado.".
- Desligar a chave dessa regra funciona. Religar mostra o toast de `ERR_CRM_RULE_INVALID`.
- Remover pede confirmação.
- Escolher "Qualquer conexão" e "Qualquer fila" mostra o aviso de regra ampla.
- No tema escuro, os avisos continuam legíveis.

Depois, mande uma mensagem real de um número de teste para uma conexão do HM, com uma regra só por conexão, e confira que o negócio aparece em `/funil` sem recarregar a página.

- [ ] **Step 6: Commit**

```bash
cd whatsapp-app
git add src/pages/FunnelSettings/Rules.js src/pages/FunnelSettings/index.js src/translate/languages/pt.js
git commit -m "Adiciona a aba de criação automática nas configurações do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fechamento

- [ ] **Step 1: Suítes completas**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && npx jest` e `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false`
Expected: tudo passando.

- [ ] **Step 2: Atualizar o spec**

Em `whatsapp-api/docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md`, mudar a linha da tabela da API para `GET/POST/PUT/DELETE /crm/rules[/:id]` e acrescentar `ERR_CRM_RULE_INVALID` (400) à tabela de erros. Commit: `Atualiza o spec do CRM com a API final das regras`.

- [ ] **Step 3: Publicar só com o aval do usuário**

Push na `main` das duas pastas publica em produção (deploy automático no EasyPanel). Não há migration nesta etapa. Pergunte antes de fazer o push.
