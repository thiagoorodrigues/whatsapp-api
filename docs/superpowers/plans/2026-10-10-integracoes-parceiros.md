# Integrações de parceiros (Plamev): plano de implementação

> **Para agentes:** sub-skill obrigatória: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** liberar integrações de parceiros por plano. A empresa conecta o token em Configurações → Integrações, e na conversa um botão abre o submenu Plamev → Rede credenciada / Planos. Nesta fase, cada item do submenu abre um modal "Em breve".

**Arquitetura:**
- O catálogo de integrações fica no código (`services/IntegrationServices/providers`).
- O plano guarda a lista de chaves liberadas (`Plans.integrations`, JSONB).
- O token de cada empresa fica criptografado em `CompanyIntegrations`, com o `secretBox`.
- O front lê `GET /integrations` (com cache em módulo) para o card de Configurações e para o botão na conversa.

**Stack:** Node 24, Express, Sequelize-typescript, Postgres 18, Jest 27 + ts-jest (api); React 16, Material UI v4, react-scripts 3 (app).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-10-integracoes-parceiros-design.md`

**Repositórios:** `whatsapp-api` = `/Users/thiagorodrigues/Projetos/weconex/whatsapp-api`, `whatsapp-app` = `/Users/thiagorodrigues/Projetos/weconex/whatsapp-app`. Os dois estão na `main`. Cada tarefa commita no repo que tocou.

## Restrições globais

- O token nunca volta para o front, nunca aparece em log e nunca aparece em mensagem de erro.
- Todo código `AppError("ERR_…")` novo precisa de texto em `whatsapp-app/src/translate/languages/pt.js` → `backendErrors`. O teste `src/__tests__/errorTranslations.spec.ts` da api falha se faltar.
- A URL da Plamev vem de `PLAMEV_API_URL` no `.env` da api. Se ela estiver vazia, a Plamev some do catálogo.
- `PUT`, `POST …/test` e `DELETE` são só para `profile === "admin"`. `GET /integrations` aceita qualquer usuário logado. `GET /integrations/catalog` é só para super.
- Textos da interface em pt-BR.
- `fetch` é chamado como `(globalThis as any).fetch`, porque `@types/node` 17 não tipa `fetch`. É o mesmo padrão de `httpTools.ts`.

## Foco da revisão

1. Token colado com espaços ou quebra de linha: o token é aparado antes de testar e salvar. Teste na Tarefa 3.
2. `PLAMEV_API_URL` sem barra final ou com caminho: a URL final é `<base>/Estados/consultar`, sem perder o caminho. Teste na Tarefa 1.
3. A Plamev responde 500 ou HTML: tratar como "não respondeu" (`unreachable`), sem estourar 500 na nossa API. Teste na Tarefa 1.
4. Integração tirada do plano com token salvo: o `GET` deixa de listar, o `PUT` dá 403, e ao voltar para o plano aparece conectada de novo. Teste na Tarefa 3.
5. Plano antigo com `integrations` nulo ou inválido: é tratado como `[]`, sem quebrar. Teste na Tarefa 2.

---

### Tarefa 1: catálogo de integrações e cliente da Plamev

**Arquivos:**
- Criar: `whatsapp-api/src/services/IntegrationServices/providers/types.ts`
- Criar: `whatsapp-api/src/services/IntegrationServices/providers/plamev/client.ts`
- Criar: `whatsapp-api/src/services/IntegrationServices/providers/plamev/index.ts`
- Criar: `whatsapp-api/src/services/IntegrationServices/providers/index.ts`
- Modificar: `whatsapp-api/.env.example` (acrescentar `PLAMEV_API_URL=`)
- Teste: `whatsapp-api/src/services/IntegrationServices/providers/__tests__/plamev.spec.ts`
- Teste: `whatsapp-api/src/services/IntegrationServices/providers/__tests__/registry.spec.ts`

**Interfaces:**
- Produz:
  - `IntegrationError(kind: "auth" | "unreachable", message)`
  - `IntegrationProvider { key, name, description, tools: {key,label}[], isAvailable(): boolean, testConnection(token: string): Promise<void> }`
  - `plamevGet(opts: {apiUrl, token, fetchFn?, timeoutMs?}, path: string): Promise<unknown>`
  - `getProvider(key: string): IntegrationProvider | undefined`, que devolve mesmo quando a integração não está disponível
  - `availableProviders(): IntegrationProvider[]`
  - `sanitizeIntegrationKeys(input: unknown): string[]`

- [ ] **Passo 1: escrever os testes que falham**

`providers/__tests__/plamev.spec.ts`:

```ts
import { plamevGet } from "../plamev/client";
import { IntegrationError } from "../types";

const reply = (status: number, body = "") => jest.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => body }));

describe("plamevGet", () => {
  it("joins the path to the base URL and sends the token as is", async () => {
    const fetchFn = reply(200, "[]");
    await plamevGet({ apiUrl: "https://service.plamev-hm.com/api", token: "abc", fetchFn }, "Estados/consultar");
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe("https://service.plamev-hm.com/api/Estados/consultar");
    expect(init.headers.Authorization).toBe("abc");
  });

  it("works with a trailing slash", async () => {
    const fetchFn = reply(200, "[]");
    await plamevGet({ apiUrl: "https://service.plamev-hm.com/", token: "abc", fetchFn }, "Estados/consultar");
    expect((fetchFn.mock.calls[0] as any)[0]).toBe("https://service.plamev-hm.com/Estados/consultar");
  });

  it.each([401, 403])("turns %s into an auth error", async status => {
    await expect(plamevGet({ apiUrl: "https://x.test", token: "bad", fetchFn: reply(status) }, "Estados/consultar"))
      .rejects.toMatchObject({ kind: "auth" });
  });

  it("turns 500 and HTML into unreachable", async () => {
    await expect(plamevGet({ apiUrl: "https://x.test", token: "t", fetchFn: reply(500) }, "a")).rejects.toMatchObject({ kind: "unreachable" });
    await expect(plamevGet({ apiUrl: "https://x.test", token: "t", fetchFn: reply(200, "<html>") }, "a")).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("turns a network failure or timeout into unreachable", async () => {
    const fetchFn = jest.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const err = await plamevGet({ apiUrl: "https://x.test", token: "t", fetchFn }, "a").catch(e => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err.kind).toBe("unreachable");
    expect(err.message).not.toContain("t");
  });
});
```

O último `expect` garante que a mensagem não carrega o token. "t" é uma letra comum, então ele vale como sanidade, não como prova. O que importa é que o código nunca concatena o token.

`providers/__tests__/registry.spec.ts`:

```ts
import { availableProviders, getProvider, sanitizeIntegrationKeys } from "..";

const OLD = process.env.PLAMEV_API_URL;
afterEach(() => { process.env.PLAMEV_API_URL = OLD; });

describe("integration registry", () => {
  it("lists Plamev only when PLAMEV_API_URL is set", () => {
    process.env.PLAMEV_API_URL = "";
    expect(availableProviders().map(p => p.key)).toEqual([]);
    process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";
    expect(availableProviders().map(p => p.key)).toEqual(["plamev"]);
  });

  it("Plamev exposes the two tools", () => {
    expect(getProvider("plamev")?.tools).toEqual([
      { key: "rede", label: "Rede credenciada" },
      { key: "planos", label: "Planos" }
    ]);
  });

  it("keeps only known keys, once, from any input", () => {
    expect(sanitizeIntegrationKeys(["plamev", "x", "plamev", 3])).toEqual(["plamev"]);
    expect(sanitizeIntegrationKeys(null)).toEqual([]);
    expect(sanitizeIntegrationKeys("plamev")).toEqual([]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd whatsapp-api && npx jest src/services/IntegrationServices/providers`
Esperado: FAIL com "Cannot find module '../plamev/client'".

- [ ] **Passo 3: implementar**

`providers/types.ts`:

```ts
export type IntegrationErrorKind = "auth" | "unreachable";

// Failure talking to a partner API. The message never carries the token.
export class IntegrationError extends Error {
  constructor(public kind: IntegrationErrorKind, message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface IntegrationTool {
  key: string;
  label: string;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  description: string;
  tools: IntegrationTool[];
  // False when the server lacks what the integration needs (e.g. API URL).
  isAvailable(): boolean;
  // Resolves when the partner accepts the token; throws IntegrationError.
  testConnection(token: string): Promise<void>;
}
```

`providers/plamev/client.ts`:

```ts
import { IntegrationError } from "../types";

interface Options {
  apiUrl: string;
  token: string;
  fetchFn?: (url: string, init: Record<string, any>) => Promise<any>;
  timeoutMs?: number;
}

// GET on the Plamev API. Token goes literally in Authorization, as their
// Swagger defines it (seller token; sales are attributed to its owner).
export const plamevGet = async (
  { apiUrl, token, fetchFn = (globalThis as any).fetch, timeoutMs = 15000 }: Options,
  path: string
): Promise<unknown> => {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const url = new URL(path, base).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: any;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: token, Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "AbortError";
    throw new IntegrationError("unreachable", timedOut ? "A Plamev não respondeu a tempo." : "Falha de rede ao falar com a Plamev.");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw new IntegrationError("auth", "A Plamev recusou o token.");
  }
  if (!response.ok) {
    throw new IntegrationError("unreachable", `A Plamev respondeu com erro ${response.status}.`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationError("unreachable", "A Plamev devolveu uma resposta inválida.");
  }
};
```

`providers/plamev/index.ts`:

```ts
import { IntegrationProvider } from "../types";
import { plamevGet } from "./client";

const apiUrl = (): string => (process.env.PLAMEV_API_URL || "").trim();

const plamev: IntegrationProvider = {
  key: "plamev",
  name: "Plamev",
  description: "Plano de saúde pet: consulte a rede credenciada e os planos durante o atendimento.",
  tools: [
    { key: "rede", label: "Rede credenciada" },
    { key: "planos", label: "Planos" }
  ],
  isAvailable: () => apiUrl() !== "",
  testConnection: async (token: string) => {
    // Light authenticated read; 401/403 means the token was refused.
    await plamevGet({ apiUrl: apiUrl(), token }, "Estados/consultar");
  }
};

export default plamev;
```

`providers/index.ts`:

```ts
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
```

Em `whatsapp-api/.env.example`, acrescentar ao final:

```
# Integração Plamev (vazio = integração indisponível)
PLAMEV_API_URL=
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd whatsapp-api && npx jest src/services/IntegrationServices/providers`
Esperado: PASS (8 testes).

- [ ] **Passo 5: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api
git add src/services/IntegrationServices .env.example
git commit -m "feat: catálogo de integrações de parceiros com a Plamev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: `Plans.integrations` e checagem de acesso

**Arquivos:**
- Criar: `whatsapp-api/src/database/migrations/20261010120000-add-integrations-to-plans.ts`
- Modificar: `whatsapp-api/src/models/Plan.ts` (depois de `crmFunnels`)
- Modificar: `whatsapp-api/src/controllers/PlanController.ts` (tipos `StorePlanData` e `UpdatePlanData`)
- Modificar: `whatsapp-api/src/services/PlanService/CreatePlanService.ts` e `UpdatePlanService.ts`
- Modificar: `whatsapp-api/src/services/CompanyService/ShowPlanCompanyService.ts` e `ListCompaniesPlanService.ts` (lista `attributes` do Plan)
- Criar: `whatsapp-api/src/helpers/integrationAccess.ts`
- Teste: `whatsapp-api/src/helpers/__tests__/integrationAccess.spec.ts`

**Interfaces:**
- Consome: `sanitizeIntegrationKeys`, `getProvider` e `IntegrationProvider` (Tarefa 1).
- Produz:
  - `companyIntegrations(companyId: number): Promise<string[]>`
  - `assertIntegration(companyId: number, key: string): Promise<IntegrationProvider>`, que lança `AppError("ERR_INTEGRATION_NOT_FOUND", 404)` se a chave não existir ou não estiver disponível, e `AppError("ERR_INTEGRATION_NOT_AVAILABLE", 403)` se a integração estiver fora do plano.

- [ ] **Passo 1: escrever o teste que falha**

`helpers/__tests__/integrationAccess.spec.ts`:

```ts
const findByPk = jest.fn();
jest.mock("../../models/Company", () => ({ __esModule: true, default: { findByPk: (...a: any[]) => findByPk(...a) } }));
jest.mock("../../models/Plan", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import { assertIntegration, companyIntegrations } from "../integrationAccess";

const withPlan = (integrations: unknown) => findByPk.mockResolvedValue({ plan: { integrations } });

beforeEach(() => {
  findByPk.mockReset();
  process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";
});

describe("integrationAccess", () => {
  it("returns the plan keys, ignoring unknown ones", async () => {
    withPlan(["plamev", "zzz"]);
    expect(await companyIntegrations(1)).toEqual(["plamev"]);
  });

  it("treats a null or invalid list as empty", async () => {
    withPlan(null);
    expect(await companyIntegrations(1)).toEqual([]);
    withPlan("plamev");
    expect(await companyIntegrations(1)).toEqual([]);
    findByPk.mockResolvedValue(null);
    expect(await companyIntegrations(1)).toEqual([]);
  });

  it("returns the provider when the plan has it", async () => {
    withPlan(["plamev"]);
    expect((await assertIntegration(1, "plamev")).key).toBe("plamev");
  });

  it("403 when the plan does not have it", async () => {
    withPlan([]);
    await expect(assertIntegration(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_AVAILABLE", statusCode: 403 });
  });

  it("404 for an unknown key or a provider without configuration", async () => {
    withPlan(["plamev"]);
    await expect(assertIntegration(1, "nope")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_FOUND", statusCode: 404 });
    process.env.PLAMEV_API_URL = "";
    await expect(assertIntegration(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_FOUND", statusCode: 404 });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd whatsapp-api && npx jest src/helpers/__tests__/integrationAccess.spec.ts`
Esperado: FAIL com "Cannot find module '../integrationAccess'".

- [ ] **Passo 3: implementar**

`helpers/integrationAccess.ts`:

```ts
import AppError from "../errors/AppError";
import Company from "../models/Company";
import Plan from "../models/Plan";
import { getProvider, IntegrationProvider, sanitizeIntegrationKeys } from "../services/IntegrationServices/providers";

// Partner integrations the company's plan includes.
export const companyIntegrations = async (companyId: number): Promise<string[]> => {
  const company = await Company.findByPk(companyId, {
    include: [{ model: Plan, as: "plan", attributes: ["integrations"] }]
  });
  return sanitizeIntegrationKeys((company as any)?.plan?.integrations);
};

export const assertIntegration = async (companyId: number, key: string): Promise<IntegrationProvider> => {
  const provider = getProvider(key);
  if (!provider || !provider.isAvailable()) throw new AppError("ERR_INTEGRATION_NOT_FOUND", 404);
  if (!(await companyIntegrations(companyId)).includes(key)) {
    throw new AppError("ERR_INTEGRATION_NOT_AVAILABLE", 403);
  }
  return provider;
};
```

Migration `20261010120000-add-integrations-to-plans.ts`:

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Partner integrations each plan sells, e.g. ["plamev"].
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Plans", "integrations", {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Plans", "integrations");
  }
};
```

Em `models/Plan.ts`, acrescentar `DataType` ao import de `sequelize-typescript` e, depois de `crmFunnels`:

```ts
  // Partner integrations this plan sells (keys from the integration catalog).
  @Column({ type: DataType.JSONB, defaultValue: [] })
  integrations: string[];
```

Em `PlanController.ts`, acrescentar `integrations?: string[];` em `StorePlanData` e em `UpdatePlanData`.

Em `CreatePlanService.ts`:
- acrescentar `integrations?: string[];` em `PlanData`;
- importar `import { sanitizeIntegrationKeys } from "../IntegrationServices/providers";`;
- trocar `const plan = await Plan.create(planData);` por:

```ts
  const plan = await Plan.create({ ...planData, integrations: sanitizeIntegrationKeys(planData.integrations) });
```

Em `UpdatePlanService.ts`:
- acrescentar `integrations?: string[];` em `PlanData`;
- importar `sanitizeIntegrationKeys` do mesmo jeito;
- trocar `await plan.update(planData);` por:

```ts
  const data = planData.integrations === undefined
    ? planData
    : { ...planData, integrations: sanitizeIntegrationKeys(planData.integrations) };
  await plan.update(data);
```

Em `ShowPlanCompanyService.ts` e `ListCompaniesPlanService.ts`, acrescentar `"integrations"` logo depois de `"crmFunnels"` na lista `attributes` do Plan.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd whatsapp-api && npx jest src/helpers/__tests__/integrationAccess.spec.ts && npx tsc --noEmit -p .`
Esperado: PASS (5 testes) e o tsc sem erros.

- [ ] **Passo 5: aplicar a migration no HM**

O HM é o Docker deste notebook. Aplicar a migration da forma usada nas entregas anteriores (ver a memória "weconex-hm-deploy"): build da api e depois `npx sequelize db:migrate` no container da api.
Esperado: `20261010120000-add-integrations-to-plans: migrated`.

- [ ] **Passo 6: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api
git add src/helpers/integrationAccess.ts src/helpers/__tests__/integrationAccess.spec.ts src/database/migrations/20261010120000-add-integrations-to-plans.ts src/models/Plan.ts src/controllers/PlanController.ts src/services/PlanService src/services/CompanyService
git commit -m "feat: plano libera integrações de parceiros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: `CompanyIntegrations` e o serviço de conexão

**Arquivos:**
- Criar: `whatsapp-api/src/database/migrations/20261010120100-create-company-integrations.ts`
- Criar: `whatsapp-api/src/models/CompanyIntegration.ts`
- Modificar: `whatsapp-api/src/database/index.ts` (import e entrada no array `models`)
- Criar: `whatsapp-api/src/services/IntegrationServices/CompanyIntegrationService.ts`
- Teste: `whatsapp-api/src/services/IntegrationServices/__tests__/CompanyIntegrationService.spec.ts`

**Interfaces:**
- Consome: `assertIntegration` e `companyIntegrations` (Tarefa 2); `getProvider`, `availableProviders` e `IntegrationError` (Tarefa 1); `encryptSecret`, `decryptSecret` e `secretHint` de `helpers/secretBox`.
- Produz:
  - `IntegrationView { key, name, description, tools, connected: boolean, status: "connected" | "error" | null, tokenHint: string | null, lastCheckedAt: Date | null, lastError: string | null }`
  - `listCatalog(): { key: string; name: string }[]`
  - `listForCompany(companyId: number): Promise<IntegrationView[]>`
  - `connect(companyId: number, key: string, token: unknown): Promise<IntegrationView>`
  - `testSaved(companyId: number, key: string): Promise<IntegrationView>`
  - `disconnect(companyId: number, key: string): Promise<void>`
  - Novos códigos de erro: `ERR_INTEGRATION_TOKEN_REQUIRED` (400), `ERR_INTEGRATION_TOKEN_REJECTED` (400), `ERR_INTEGRATION_UNREACHABLE` (502) e `ERR_INTEGRATION_NOT_CONNECTED` (404).

- [ ] **Passo 1: escrever o teste que falha**

`services/IntegrationServices/__tests__/CompanyIntegrationService.spec.ts`:

```ts
process.env.SECRETS_KEY = "test-secret";
process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";

const rows: any[] = [];
const testConnection = jest.fn();
let planKeys: string[] = ["plamev"];

const row = (data: any) => ({
  ...data,
  update: jest.fn(async function update(this: any, v: any) { Object.assign(this, v); return this; }),
  destroy: jest.fn(async function destroy(this: any) { rows.splice(rows.indexOf(this), 1); })
});

jest.mock("../../../models/CompanyIntegration", () => {
  const match = (where: any) => (r: any) =>
    r.companyId === where.companyId && (Array.isArray(where.provider) ? where.provider.includes(r.provider) : r.provider === where.provider);
  const api = {
    findOne: async ({ where }: any) => rows.find(match(where)) || null,
    findAll: async ({ where }: any) => rows.filter(match(where)),
    create: async (data: any) => { const r = row(data); rows.push(r); return r; }
  };
  return { __esModule: true, default: { ...api, unscoped: () => api } };
});
jest.mock("../../../helpers/integrationAccess", () => {
  const AppError = jest.requireActual("../../../errors/AppError").default;
  return {
    companyIntegrations: async () => planKeys,
    assertIntegration: async (_c: number, key: string) => {
      if (!planKeys.includes(key)) throw new AppError("ERR_INTEGRATION_NOT_AVAILABLE", 403);
      const p = jest.requireActual("../providers").getProvider(key);
      return { ...p, testConnection };
    }
  };
});

// eslint-disable-next-line import/first
import { connect, disconnect, listForCompany, testSaved } from "../CompanyIntegrationService";
// eslint-disable-next-line import/first
import { IntegrationError } from "../providers";
// eslint-disable-next-line import/first
import { decryptSecret } from "../../../helpers/secretBox";

beforeEach(() => {
  rows.length = 0;
  planKeys = ["plamev"];
  testConnection.mockReset().mockResolvedValue(undefined);
});

describe("CompanyIntegrationService", () => {
  it("lists plan integrations as not connected at first", async () => {
    const [plamev] = await listForCompany(1);
    expect(plamev).toMatchObject({ key: "plamev", connected: false, status: null, tokenHint: null });
  });

  it("trims, tests, then stores the token encrypted and never returns it", async () => {
    const view = await connect(1, "plamev", "  tok-1234\n");
    expect(testConnection).toHaveBeenCalledWith("tok-1234");
    expect(decryptSecret(rows[0].tokenEncrypted)).toBe("tok-1234");
    expect(view).toMatchObject({ connected: true, status: "connected", tokenHint: "…1234" });
    expect(JSON.stringify(view)).not.toContain("tok-1234");
    expect(JSON.stringify(view)).not.toContain(rows[0].tokenEncrypted);
  });

  it("requires a token", async () => {
    await expect(connect(1, "plamev", "   ")).rejects.toMatchObject({ message: "ERR_INTEGRATION_TOKEN_REQUIRED" });
  });

  it("does not save a refused token", async () => {
    testConnection.mockRejectedValue(new IntegrationError("auth", "A Plamev recusou o token."));
    await expect(connect(1, "plamev", "bad")).rejects.toMatchObject({ message: "ERR_INTEGRATION_TOKEN_REJECTED", statusCode: 400 });
    expect(rows).toHaveLength(0);
  });

  it("does not save when the partner is down", async () => {
    testConnection.mockRejectedValue(new IntegrationError("unreachable", "A Plamev não respondeu a tempo."));
    await expect(connect(1, "plamev", "tok")).rejects.toMatchObject({ message: "ERR_INTEGRATION_UNREACHABLE", statusCode: 502 });
    expect(rows).toHaveLength(0);
  });

  it("replaces the token on a second connect", async () => {
    await connect(1, "plamev", "first-aaaa");
    await connect(1, "plamev", "second-bbbb");
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0].tokenEncrypted)).toBe("second-bbbb");
  });

  it("testSaved records an error instead of throwing", async () => {
    await connect(1, "plamev", "tok-9999");
    testConnection.mockRejectedValue(new IntegrationError("auth", "A Plamev recusou o token."));
    const view = await testSaved(1, "plamev");
    expect(view).toMatchObject({ connected: true, status: "error", lastError: "A Plamev recusou o token." });
  });

  it("testSaved without a token is 404", async () => {
    await expect(testSaved(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_CONNECTED", statusCode: 404 });
  });

  it("hides an integration removed from the plan and brings it back connected", async () => {
    await connect(1, "plamev", "tok-1111");
    planKeys = [];
    expect(await listForCompany(1)).toEqual([]);
    await expect(connect(1, "plamev", "x")).rejects.toMatchObject({ statusCode: 403 });
    planKeys = ["plamev"];
    expect((await listForCompany(1))[0]).toMatchObject({ connected: true, tokenHint: "…1111" });
  });

  it("disconnect removes the row", async () => {
    await connect(1, "plamev", "tok");
    await disconnect(1, "plamev");
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd whatsapp-api && npx jest src/services/IntegrationServices/__tests__/CompanyIntegrationService.spec.ts`
Esperado: FAIL com "Cannot find module '../../../models/CompanyIntegration'" (ou com o serviço ausente).

- [ ] **Passo 3: implementar**

Migration `20261010120100-create-company-integrations.ts`:

```ts
import { QueryInterface, DataTypes } from "sequelize";

// One row per company and partner integration; the token is AES-GCM encrypted.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("CompanyIntegrations", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      tokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
      tokenHint: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "connected" },
      lastCheckedAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CompanyIntegrations", ["companyId", "provider"], {
      unique: true,
      name: "company_integrations_company_provider"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("CompanyIntegrations");
  }
};
```

`models/CompanyIntegration.ts`:

```ts
import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DefaultScope
} from "sequelize-typescript";
import Company from "./Company";

// The token never leaves the API: read it with CompanyIntegration.unscoped().
@DefaultScope(() => ({ attributes: { exclude: ["tokenEncrypted"] } }))
@Table({ tableName: "CompanyIntegrations" })
class CompanyIntegration extends Model<CompanyIntegration> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  provider: string;

  @Column(DataType.TEXT)
  tokenEncrypted: string;

  @Column
  tokenHint: string;

  @Column
  status: string;

  @Column
  lastCheckedAt: Date;

  @Column
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CompanyIntegration;
```

Em `database/index.ts`:
- acrescentar `import CompanyIntegration from "../models/CompanyIntegration";` depois de `import ServerMetric …`;
- acrescentar `CompanyIntegration,` no array `models`, depois de `ServerMetric`.

`services/IntegrationServices/CompanyIntegrationService.ts`:

```ts
import AppError from "../../errors/AppError";
import { assertIntegration, companyIntegrations } from "../../helpers/integrationAccess";
import { decryptSecret, encryptSecret, secretHint } from "../../helpers/secretBox";
import CompanyIntegration from "../../models/CompanyIntegration";
import { availableProviders, getProvider, IntegrationError, IntegrationProvider, IntegrationTool } from "./providers";

export interface IntegrationView {
  key: string;
  name: string;
  description: string;
  tools: IntegrationTool[];
  connected: boolean;
  status: "connected" | "error" | null;
  tokenHint: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
}

const view = (provider: IntegrationProvider, row?: CompanyIntegration | null): IntegrationView => ({
  key: provider.key,
  name: provider.name,
  description: provider.description,
  tools: provider.tools,
  connected: !!row,
  status: row ? (row.status as "connected" | "error") : null,
  tokenHint: row?.tokenHint ?? null,
  lastCheckedAt: row?.lastCheckedAt ?? null,
  lastError: row?.lastError ?? null
});

const asAppError = (err: unknown): unknown => {
  if (!(err instanceof IntegrationError)) return err;
  return err.kind === "auth"
    ? new AppError("ERR_INTEGRATION_TOKEN_REJECTED", 400)
    : new AppError("ERR_INTEGRATION_UNREACHABLE", 502);
};

const findRow = (companyId: number, provider: string) =>
  CompanyIntegration.unscoped().findOne({ where: { companyId, provider } });

// Catalog for the plan form (super only).
export const listCatalog = (): { key: string; name: string }[] =>
  availableProviders().map(p => ({ key: p.key, name: p.name }));

export const listForCompany = async (companyId: number): Promise<IntegrationView[]> => {
  const keys = await companyIntegrations(companyId);
  const providers = keys.map(getProvider).filter((p): p is IntegrationProvider => !!p && p.isAvailable());
  if (!providers.length) return [];
  const rows = await CompanyIntegration.findAll({ where: { companyId, provider: providers.map(p => p.key) } });
  return providers.map(p => view(p, rows.find(r => r.provider === p.key)));
};

// Tests the token first; nothing is stored when the partner refuses it.
export const connect = async (companyId: number, key: string, token: unknown): Promise<IntegrationView> => {
  const provider = await assertIntegration(companyId, key);
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) throw new AppError("ERR_INTEGRATION_TOKEN_REQUIRED", 400);

  try {
    await provider.testConnection(clean);
  } catch (err) {
    throw asAppError(err);
  }

  const data = {
    tokenEncrypted: encryptSecret(clean),
    tokenHint: secretHint(clean),
    status: "connected",
    lastCheckedAt: new Date(),
    lastError: null
  };
  const existing = await findRow(companyId, key);
  const row = existing ? await existing.update(data) : await CompanyIntegration.create({ companyId, provider: key, ...data } as any);
  return view(provider, row);
};

// Re-tests the saved token; a refusal is recorded, not thrown.
export const testSaved = async (companyId: number, key: string): Promise<IntegrationView> => {
  const provider = await assertIntegration(companyId, key);
  const row = await findRow(companyId, key);
  if (!row) throw new AppError("ERR_INTEGRATION_NOT_CONNECTED", 404);

  try {
    await provider.testConnection(decryptSecret(row.tokenEncrypted));
    await row.update({ status: "connected", lastCheckedAt: new Date(), lastError: null });
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err;
    await row.update({ status: "error", lastCheckedAt: new Date(), lastError: err.message });
  }
  return view(provider, row);
};

export const disconnect = async (companyId: number, key: string): Promise<void> => {
  await assertIntegration(companyId, key);
  const row = await findRow(companyId, key);
  if (row) await row.destroy();
};
```

`row.tokenEncrypted` fica fora do `view`, porque o objeto é montado campo a campo.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd whatsapp-api && npx jest src/services/IntegrationServices && npx tsc --noEmit -p .`
Esperado: PASS (10 testes no serviço, mais os da Tarefa 1) e o tsc sem erros.

- [ ] **Passo 5: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api
git add src/database/migrations/20261010120100-create-company-integrations.ts src/models/CompanyIntegration.ts src/database/index.ts src/services/IntegrationServices
git commit -m "feat: token de integração por empresa, testado antes de salvar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4: rotas `/integrations` e textos dos erros

**Arquivos:**
- Criar: `whatsapp-api/src/controllers/IntegrationController.ts`
- Criar: `whatsapp-api/src/routes/integrationRoutes.ts`
- Modificar: `whatsapp-api/src/routes/index.ts` (import e `routes.use(integrationRoutes);` depois de `followUpRoutes`)
- Modificar: `whatsapp-app/src/translate/languages/pt.js` (`backendErrors`, ao lado de `ERR_PLAN_FEATURE_NOT_AVAILABLE`, por volta da linha 1008)
- Teste: `whatsapp-api/src/routes/__tests__/integrationRoutes.spec.ts`
- Teste existente: `whatsapp-api/src/__tests__/errorTranslations.spec.ts`

**Interfaces:**
- Consome: as funções da Tarefa 3.
- Produz as rotas HTTP:
  - `GET /integrations/catalog` → `{key,name}[]`
  - `GET /integrations` → `IntegrationView[]`
  - `PUT /integrations/:provider` com body `{token}` → `IntegrationView`
  - `POST /integrations/:provider/test` → `IntegrationView`
  - `DELETE /integrations/:provider` → `204`

- [ ] **Passo 1: escrever o teste que falha**

`routes/__tests__/integrationRoutes.spec.ts`:

```ts
jest.mock("../../controllers/IntegrationController", () => ({
  catalog: jest.fn(), index: jest.fn(), update: jest.fn(), test: jest.fn(), remove: jest.fn()
}));
// eslint-disable-next-line import/first
import integrationRoutes from "../integrationRoutes";

const byPath = () =>
  Object.fromEntries(
    (integrationRoutes as any).stack.map((l: any) => [
      `${Object.keys(l.route.methods)[0]} ${l.route.path}`,
      l.route.stack.map((s: any) => s.handle.name)
    ])
  );

describe("integrationRoutes", () => {
  it("catalog is super only", () => {
    expect(byPath()["get /integrations/catalog"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
  });
  it("any logged user lists the company integrations", () => {
    expect(byPath()["get /integrations"]).toEqual(["isAuth", expect.any(String)]);
  });
  it("only admins change the token", () => {
    const p = byPath();
    ["put /integrations/:provider", "post /integrations/:provider/test", "delete /integrations/:provider"].forEach(path =>
      expect(p[path].slice(0, 2)).toEqual(["isAuth", "isAdmin"])
    );
  });
  it("declares /catalog before /:provider", () => {
    const paths = (integrationRoutes as any).stack.map((l: any) => l.route.path);
    expect(paths.indexOf("/integrations/catalog")).toBeLessThan(paths.indexOf("/integrations/:provider"));
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd whatsapp-api && npx jest src/routes/__tests__/integrationRoutes.spec.ts`
Esperado: FAIL com "Cannot find module '../integrationRoutes'".

- [ ] **Passo 3: implementar**

`controllers/IntegrationController.ts`:

```ts
import { Request, Response } from "express";
import * as Service from "../services/IntegrationServices/CompanyIntegrationService";

export const catalog = async (_req: Request, res: Response): Promise<Response> =>
  res.json(Service.listCatalog());

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.listForCompany(req.user.companyId));

export const update = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.connect(req.user.companyId, req.params.provider, req.body?.token));

export const test = async (req: Request, res: Response): Promise<Response> =>
  res.json(await Service.testSaved(req.user.companyId, req.params.provider));

export const remove = async (req: Request, res: Response): Promise<Response> => {
  await Service.disconnect(req.user.companyId, req.params.provider);
  return res.status(204).send();
};
```

`routes/integrationRoutes.ts`:

```ts
import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import isSuper from "../middleware/isSuper";
import * as IntegrationController from "../controllers/IntegrationController";

const integrationRoutes = Router();

integrationRoutes.get("/integrations/catalog", isAuth, isSuper, IntegrationController.catalog);
integrationRoutes.get("/integrations", isAuth, IntegrationController.index);
integrationRoutes.put("/integrations/:provider", isAuth, isAdmin, IntegrationController.update);
integrationRoutes.post("/integrations/:provider/test", isAuth, isAdmin, IntegrationController.test);
integrationRoutes.delete("/integrations/:provider", isAuth, isAdmin, IntegrationController.remove);

export default integrationRoutes;
```

Em `routes/index.ts`, acrescentar `import integrationRoutes from "./integrationRoutes";` e `routes.use(integrationRoutes);` depois de `routes.use(followUpRoutes);`.

Em `whatsapp-app/src/translate/languages/pt.js`, dentro de `backendErrors`, logo abaixo de `ERR_PLAN_FEATURE_NOT_AVAILABLE`:

```js
        ERR_INTEGRATION_NOT_FOUND: "Integração não encontrada.",
        ERR_INTEGRATION_NOT_AVAILABLE: "Esta integração não está disponível no seu plano.",
        ERR_INTEGRATION_TOKEN_REQUIRED: "Cole o token da integração.",
        ERR_INTEGRATION_TOKEN_REJECTED: "O parceiro recusou o token. Confira se ele foi copiado inteiro.",
        ERR_INTEGRATION_UNREACHABLE: "O parceiro não respondeu agora. Tente de novo em instantes.",
        ERR_INTEGRATION_NOT_CONNECTED: "Esta integração ainda não foi conectada.",
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd whatsapp-api && npx jest src/routes/__tests__/integrationRoutes.spec.ts src/__tests__/errorTranslations.spec.ts && npx tsc --noEmit -p .`
Esperado: PASS e o tsc sem erros.

- [ ] **Passo 5: rodar a suíte inteira da api**

Rodar: `cd whatsapp-api && npm test`
Esperado: PASS em tudo.

- [ ] **Passo 6: commit (dois repos)**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api
git add src/controllers/IntegrationController.ts src/routes/integrationRoutes.ts src/routes/index.ts src/routes/__tests__/integrationRoutes.spec.ts
git commit -m "feat: rotas de integrações de parceiros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app
git add src/translate/languages/pt.js
git commit -m "feat: textos dos erros de integração

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 5: integrações no formulário de plano

**Arquivos:**
- Modificar: `whatsapp-app/src/components/PlansManager/index.js`
- Criar: `whatsapp-app/src/services/integrations.js`
- Teste: `whatsapp-app/src/services/integrations.test.js`

**Interfaces:**
- Consome: `GET /integrations/catalog` e `GET /integrations` (Tarefa 4).
- Produz:
  - `loadIntegrations(force?: boolean): Promise<IntegrationView[]>`, com cache em módulo e uma única chamada simultânea;
  - `clearIntegrationsCache(): void`;
  - `loadIntegrationCatalog(): Promise<{key,name}[]>`, sem cache.

- [ ] **Passo 1: escrever o teste que falha**

`src/services/integrations.test.js`:

```js
import api from "./api";
import { clearIntegrationsCache, loadIntegrations } from "./integrations";

jest.mock("./api", () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => {
  clearIntegrationsCache();
  api.get.mockReset();
});

it("calls the API once for concurrent loads", async () => {
  api.get.mockResolvedValue({ data: [{ key: "plamev" }] });
  const [a, b] = await Promise.all([loadIntegrations(), loadIntegrations()]);
  expect(a).toEqual([{ key: "plamev" }]);
  expect(b).toBe(a);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith("/integrations");
});

it("force reloads", async () => {
  api.get.mockResolvedValue({ data: [] });
  await loadIntegrations();
  await loadIntegrations(true);
  expect(api.get).toHaveBeenCalledTimes(2);
});

it("does not cache a failure", async () => {
  api.get.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ data: [] });
  await expect(loadIntegrations()).rejects.toThrow("down");
  await expect(loadIntegrations()).resolves.toEqual([]);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/services/integrations.test.js`
Esperado: FAIL com "Cannot find module './integrations'".

- [ ] **Passo 3: implementar**

`src/services/integrations.js`:

```js
import api from "./api";

// Integrações da empresa, compartilhadas entre o botão da conversa e as
// Configurações. Uma chamada por vez; falha não fica guardada.
let cached = null;

export const loadIntegrations = (force = false) => {
  if (!cached || force) {
    cached = api
      .get("/integrations")
      .then(({ data }) => data)
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
};

export const clearIntegrationsCache = () => {
  cached = null;
};

// Catálogo completo, só para o formulário de plano (super).
export const loadIntegrationCatalog = () => api.get("/integrations/catalog").then(({ data }) => data);
```

Mudanças em `components/PlansManager/index.js`:

1. Imports: `Checkbox` entra no import de `@material-ui/core`, e acrescentar `import { loadIntegrationCatalog } from "../../services/integrations";`.

2. Em `emptyPlan`, acrescentar `integrations: [],`.

3. Em `PlanDialog`, receber a prop `catalog` (`const PlanDialog = ({ open, plan, catalog, onClose, onSubmit }) => {`). Dentro de `initialValues`, antes do `return base;`, acrescentar:

```js
        base.integrations = Array.isArray(base.integrations) ? base.integrations : [];
```

4. Na aba Recursos, logo depois do `</div>` que fecha `classes.switches`, acrescentar:

```jsx
                            {tab === 2 && catalog.length > 0 && (
                                <>
                                    <p className={classes.sectionLabel}>Integrações de parceiros</p>
                                    <div className={classes.switches}>
                                        {catalog.map((item) => (
                                            <FormControlLabel
                                                key={item.key}
                                                control={
                                                    <Checkbox
                                                        color="primary"
                                                        checked={values.integrations.includes(item.key)}
                                                        onChange={(e) =>
                                                            setFieldValue(
                                                                "integrations",
                                                                e.target.checked
                                                                    ? [...values.integrations, item.key]
                                                                    : values.integrations.filter((k) => k !== item.key)
                                                            )
                                                        }
                                                    />
                                                }
                                                label={item.name}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
```

5. Em `PlansManager`, acrescentar o estado e a carga do catálogo:

```js
    const [catalog, setCatalog] = useState([]);

    useEffect(() => {
        loadIntegrationCatalog().then(setCatalog).catch(() => setCatalog([]));
    }, []);
```

6. Em `handleSubmit`, dentro do objeto `data`, acrescentar:

```js
            integrations: Array.isArray(values.integrations) ? values.integrations : [],
```

7. No `<PlanDialog …>`, que é renderizado mais abaixo no arquivo, passar `catalog={catalog}`.

8. No `PlanCard`, depois do `<ul className={classes.features}>…</ul>`, mostrar as integrações do plano:

```jsx
            {Array.isArray(plan.integrations) && plan.integrations.length > 0 && (
                <ul className={classes.features} aria-label="Integrações">
                    {plan.integrations.map((key) => (
                        <li key={key} className={clsx(classes.feature, classes.featureOn)}>
                            {key === "plamev" ? "Plamev" : key}
                        </li>
                    ))}
                </ul>
            )}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/services/integrations.test.js`
Esperado: PASS (3 testes).

- [ ] **Passo 5: conferir no navegador (HM)**

1. Subir o app do HM.
2. Entrar como super e abrir Configurações → Planos → Editar "Wazzy Demo" → aba Recursos.
3. Marcar "Plamev" e salvar.
4. Reabrir o plano e conferir que a marcação continua e que o card do plano mostra o chip "Plamev".

O catálogo só aparece com `PLAMEV_API_URL` preenchido no `.env` da api do HM. Use `https://service.plamev-hm.com/`.

- [ ] **Passo 6: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app
git add src/services/integrations.js src/services/integrations.test.js src/components/PlansManager/index.js
git commit -m "feat: plano libera integrações de parceiros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 6: Configurações → Integrações

**Arquivos:**
- Criar: `whatsapp-app/src/components/Settings/Integrations.js`
- Criar: `whatsapp-app/public/integrations/plamev.svg` (cópia de `/Users/thiagorodrigues/Projetos/plamev/plamev-website-75779/public/assets/Images/ImageLPCaixa/logo-plamev.svg`)
- Modificar: `whatsapp-app/src/pages/SettingsCustom/index.js` (`SECTIONS`, efeito de carga e `renderSection`)
- Modificar: `whatsapp-app/src/layout/MainListItems.js` (estado do plano, por volta das linhas 245-266, e submenu de Configurações, por volta das linhas 481-490)

**Interfaces:**
- Consome:
  - `loadIntegrations(force)` (Tarefa 5);
  - `PUT /integrations/:key {token}`, `POST /integrations/:key/test` e `DELETE /integrations/:key` (Tarefa 4);
  - `PasswordField` (`components/PasswordField`), `ConfirmationModal` e `toastError`.
- Produz: a rota `/settings/integracoes`.

- [ ] **Passo 1: copiar o logo**

```bash
mkdir -p /Users/thiagorodrigues/Projetos/weconex/whatsapp-app/public/integrations
cp /Users/thiagorodrigues/Projetos/plamev/plamev-website-75779/public/assets/Images/ImageLPCaixa/logo-plamev.svg /Users/thiagorodrigues/Projetos/weconex/whatsapp-app/public/integrations/plamev.svg
```

- [ ] **Passo 2: criar `components/Settings/Integrations.js`**

```jsx
import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { makeStyles } from "@material-ui/core/styles";
import { Button, Chip, CircularProgress } from "@material-ui/core";

import api from "../../services/api";
import { loadIntegrations } from "../../services/integrations";
import toastError from "../../errors/toastError";
import PasswordField from "../PasswordField";
import ConfirmationModal from "../ConfirmationModal";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    card: {
      padding: theme.spacing(2.5),
      backgroundColor: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: theme.radii.panel,
      display: "flex",
      flexDirection: "column",
      gap: theme.spacing(2),
    },
    header: { display: "flex", alignItems: "center", gap: theme.spacing(1.5) },
    logo: { width: 44, height: 44, objectFit: "contain", borderRadius: 10, backgroundColor: t.surfaceSunken, padding: 6 },
    title: { flex: 1, minWidth: 0, "& h3": { margin: 0, fontSize: 15, fontWeight: 700, color: t.textPrimary }, "& p": { margin: "2px 0 0", fontSize: 13, color: t.textTertiary } },
    ok: { backgroundColor: t.successSoft, color: t.successText, fontWeight: 600 },
    bad: { backgroundColor: t.dangerSoft, color: t.danger, fontWeight: 600 },
    off: { backgroundColor: t.neutralTag, color: t.textTertiary, fontWeight: 600 },
    error: { margin: 0, fontSize: 13, color: t.danger },
    actions: { display: "flex", flexWrap: "wrap", gap: theme.spacing(1), justifyContent: "flex-end" },
    empty: { padding: theme.spacing(4), textAlign: "center", color: t.textSecondary },
  };
});

const statusChip = (item, classes) => {
  if (!item.connected) return <Chip size="small" label="Não conectado" className={classes.off} />;
  if (item.status === "error") return <Chip size="small" label="Erro" className={classes.bad} />;
  return <Chip size="small" label="Conectado" className={classes.ok} />;
};

const IntegrationCard = ({ item, onChange }) => {
  const classes = useStyles();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(null); // "save" | "test" | "remove"
  const [confirm, setConfirm] = useState(false);

  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    }
    setBusy(null);
  };

  const save = () =>
    run("save", async () => {
      await api.put(`/integrations/${item.key}`, { token });
      setToken("");
      toast.success(`${item.name} conectada.`);
      await onChange();
    });

  const test = () =>
    run("test", async () => {
      const { data } = await api.post(`/integrations/${item.key}/test`);
      if (data.status === "connected") toast.success("Conexão funcionando.");
      else toast.error(data.lastError || "A conexão falhou.");
      await onChange();
    });

  const remove = () =>
    run("remove", async () => {
      await api.delete(`/integrations/${item.key}`);
      toast.success(`${item.name} desconectada.`);
      await onChange();
    });

  return (
    <article className={classes.card} aria-label={`Integração ${item.name}`}>
      <div className={classes.header}>
        <img
          className={classes.logo}
          src={`/integrations/${item.key}.svg`}
          alt=""
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
        <div className={classes.title}>
          <h3>{item.name}</h3>
          <p>{item.description}</p>
        </div>
        {statusChip(item, classes)}
      </div>

      {item.status === "error" && item.lastError && <p className={classes.error}>{item.lastError}</p>}

      <PasswordField
        label={item.connected ? "Trocar token" : "Token"}
        placeholder={item.connected ? `Token salvo ${item.tokenHint}` : "Cole aqui o token do vendedor"}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        fullWidth
        variant="outlined"
        size="small"
        autoComplete="off"
        disabled={!!busy}
      />

      <div className={classes.actions}>
        {item.connected && (
          <>
            <Button variant="outlined" onClick={() => setConfirm(true)} disabled={!!busy}>
              Desconectar
            </Button>
            <Button variant="outlined" onClick={test} disabled={!!busy}>
              {busy === "test" ? <CircularProgress size={18} /> : "Testar conexão"}
            </Button>
          </>
        )}
        <Button variant="contained" color="primary" disableElevation onClick={save} disabled={!!busy || !token.trim()}>
          {busy === "save" ? <CircularProgress size={18} color="inherit" /> : "Salvar e testar"}
        </Button>
      </div>

      <ConfirmationModal
        title={`Desconectar ${item.name}?`}
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
      >
        O token será apagado e as ferramentas somem da conversa até alguém conectar de novo.
      </ConfirmationModal>
    </article>
  );
};

const Integrations = () => {
  const classes = useStyles();
  const [items, setItems] = useState(null);

  const reload = async (force = true) => {
    try {
      setItems(await loadIntegrations(force));
    } catch (err) {
      toastError(err);
      setItems([]);
    }
  };

  useEffect(() => {
    reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items === null) return <div className={classes.empty}><CircularProgress size={24} /></div>;
  if (items.length === 0) return <div className={classes.empty}>Nenhuma integração disponível no seu plano.</div>;
  return items.map((item) => <IntegrationCard key={item.key} item={item} onChange={() => reload(true)} />);
};

export default Integrations;
```

`ConfirmationModal` recebe `{ title, children, open, onClose, onConfirm }`, e `theme.tokens` tem `danger` e `dangerSoft` (confirmado).

- [ ] **Passo 3: ligar a seção na página**

Em `pages/SettingsCustom/index.js`:
- importar `import Integrations from "../../components/Settings/Integrations";`;
- em `SECTIONS`, acrescentar `integracoes: "integrations",`;
- no efeito, trocar a guarda por `if (!section || section === "logs" || section === "monitor" || section === "integrations") return;`;
- no `switch` de `renderSection`, acrescentar:

```js
      case "integrations":
        return <Integrations />;
```

- logo depois do `if (!section || (SUPER_ONLY…)) return <Redirect …/>;`, acrescentar a guarda de admin:

```js
  if (section === "integrations" && user.profile !== "admin") {
    return <Redirect to="/settings" />;
  }
```

- [ ] **Passo 4: item no menu**

Em `layout/MainListItems.js`:
- junto dos outros `useState` do plano, acrescentar `const [showPartnerIntegrations, setShowPartnerIntegrations] = useState(false);`;
- dentro de `fetchData`, depois de `setShowCrm(...)`, acrescentar:

```js
      setShowPartnerIntegrations(Array.isArray(planConfigs.plan.integrations) && planConfigs.plan.integrations.length > 0);
```

- no submenu de Configurações, logo depois de `<NavItem sub exact to="/settings" primary="Opções" icon={<SlidersIcon />} />`, acrescentar:

```jsx
                {showPartnerIntegrations && user.profile === "admin" && (
                  <NavItem sub to="/settings/integracoes" primary="Integrações" icon={<BoltIcon />} />
                )}
```

`BoltIcon` já está importado nesse arquivo.

- [ ] **Passo 5: conferir no navegador (HM)**

Com a Plamev liberada no plano da Wazzy Demo (Tarefa 5), entrar como admin dessa empresa:
1. O menu Configurações mostra "Integrações", e a página mostra o card Plamev "Não conectado".
2. Colar um token falso e clicar "Salvar e testar". Deve aparecer o toast "O parceiro recusou o token…", e o card continua "Não conectado". Isso confirma que `Estados/consultar` exige token. Se ele salvar com token falso, o endpoint é público: trocar `testConnection` na Tarefa 1 por outra leitura autenticada do Swagger (`docs/plamev/swagger.json` no repo `plamev-mcp`) e anotar.
3. Pedir ao usuário que cole o token de homologação. O card deve ficar "Conectado" com a dica `…xxxx`, e "Testar conexão" deve mostrar "Conexão funcionando.".
4. Em `read_network_requests`, conferir que a resposta do `PUT` não traz o token.
5. Entrar como usuário comum: o menu não mostra "Integrações", e abrir `/settings/integracoes` redireciona.

- [ ] **Passo 6: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app
git add public/integrations/plamev.svg src/components/Settings/Integrations.js src/pages/SettingsCustom/index.js src/layout/MainListItems.js
git commit -m "feat: Configurações → Integrações com token da Plamev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 7: botão de integrações na conversa

**Arquivos:**
- Criar: `whatsapp-app/src/components/TicketIntegrationsMenu/index.js`
- Criar: `whatsapp-app/src/components/IntegrationToolModal/index.js`
- Modificar: `whatsapp-app/src/components/TicketActionButtonsCustom/index.js` (import e uso antes do `<Tooltip title="Adicionar Participante">`)

**Interfaces:**
- Consome: `loadIntegrations()` (Tarefa 5), que devolve `IntegrationView[]`.
- Produz: `IntegrationToolModal({ open, integration, tool, ticket, onClose })`. A próxima rodada troca o corpo do modal pela ferramenta, sem mexer no menu.

- [ ] **Passo 1: criar `components/IntegrationToolModal/index.js`**

```jsx
import React from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@material-ui/core";

// Uma ferramenta de integração aberta a partir da conversa. Nesta fase só
// mostra "Em breve"; cada ferramenta entra aqui por provider/tool.
const IntegrationToolModal = ({ open, integration, tool, ticket, onClose }) => {
  if (!integration || !tool) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="integration-tool-title">
      <DialogTitle id="integration-tool-title">
        {integration.name} — {tool.label}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary">
          Em breve: {tool.label.toLowerCase()} da {integration.name} direto na conversa
          {ticket?.contact?.name ? ` com ${ticket.contact.name}` : ""}.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IntegrationToolModal;
```

- [ ] **Passo 2: criar `components/TicketIntegrationsMenu/index.js`**

```jsx
import React, { useEffect, useState } from "react";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@material-ui/core";
import ExtensionIcon from "@material-ui/icons/Extension";
import ChevronRightIcon from "@material-ui/icons/ChevronRight";

import { loadIntegrations } from "../../services/integrations";
import IntegrationToolModal from "../IntegrationToolModal";

// Ícone no cabeçalho da conversa: integração conectada → submenu de ferramentas.
const TicketIntegrationsMenu = ({ ticket }) => {
  const [items, setItems] = useState([]);
  const [anchor, setAnchor] = useState(null);
  const [sub, setSub] = useState(null); // { anchor, integration }
  const [open, setOpen] = useState(null); // { integration, tool }

  useEffect(() => {
    let alive = true;
    loadIntegrations()
      .then((data) => alive && setItems(data.filter((i) => i.connected)))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  const closeAll = () => {
    setSub(null);
    setAnchor(null);
  };

  return (
    <>
      <Tooltip title="Integrações">
        <IconButton aria-label="Integrações" aria-haspopup="true" onClick={(e) => setAnchor(e.currentTarget)}>
          <ExtensionIcon />
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchor} open={!!anchor} onClose={closeAll} keepMounted={false}>
        {items.map((integration) => (
          <MenuItem key={integration.key} onClick={(e) => setSub({ anchor: e.currentTarget, integration })}>
            <ListItemText primary={integration.name} />
            <ListItemIcon style={{ minWidth: 0, marginLeft: 16 }}>
              <ChevronRightIcon fontSize="small" />
            </ListItemIcon>
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={sub?.anchor}
        open={!!sub}
        onClose={() => setSub(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        getContentAnchorEl={null}
      >
        {(sub?.integration.tools || []).map((tool) => (
          <MenuItem
            key={tool.key}
            onClick={() => {
              setOpen({ integration: sub.integration, tool });
              closeAll();
            }}
          >
            {tool.label}
          </MenuItem>
        ))}
      </Menu>

      <IntegrationToolModal
        open={!!open}
        integration={open?.integration}
        tool={open?.tool}
        ticket={ticket}
        onClose={() => setOpen(null)}
      />
    </>
  );
};

export default TicketIntegrationsMenu;
```

- [ ] **Passo 3: colocar no cabeçalho**

Em `components/TicketActionButtonsCustom/index.js`:
- acrescentar `import TicketIntegrationsMenu from "../TicketIntegrationsMenu";` junto dos outros imports de componentes;
- dentro do `<>` que envolve o botão "Adicionar Participante", antes do `<Tooltip title="Adicionar Participante">`, acrescentar `<TicketIntegrationsMenu ticket={ticket} />`.

- [ ] **Passo 4: conferir no navegador (HM)**

Com a Plamev conectada (Tarefa 6):
1. Abrir uma conversa. O ícone de peça aparece antes do "Adicionar participante".
2. Clicar no ícone. O menu mostra "Plamev ›", e passar ou clicar abre "Rede credenciada" e "Planos".
3. Clicar em "Planos". Abre o modal "Plamev — Planos" com "Em breve…" e o botão Fechar.
4. Desconectar em Configurações e recarregar a conversa. O ícone some.
5. Tirar a Plamev do plano e recarregar. O ícone e o item do menu somem.
6. Recolocar a Plamev no plano. Ela volta conectada e o ícone reaparece.
7. Repetir o passo 2 em largura de celular (`resize_window` mobile) e conferir que o submenu não sai da tela.
8. Tirar screenshot do menu aberto como prova.

- [ ] **Passo 5: commit**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app
git add src/components/TicketIntegrationsMenu src/components/IntegrationToolModal src/components/TicketActionButtonsCustom/index.js
git commit -m "feat: botão de integrações na conversa com submenu da Plamev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 8: fechamento

- [ ] **Passo 1: suítes completas**

Rodar: `cd whatsapp-api && npm test && npx tsc --noEmit -p .`
Rodar: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false`
Esperado: tudo PASS. Se algum teste falhar e não tiver relação com esta entrega, anotar a falha e não mexer nele.

- [ ] **Passo 2: anotar o que falta para produção**

Não publicar sem o usuário pedir. Antes de publicar, é preciso:
1. a URL de produção da Plamev, para colocar `PLAMEV_API_URL` no EasyPanel;
2. rodar as migrations `20261010120000` e `20261010120100`.

Registrar isso na resposta final ao usuário e numa memória nova "Wazzy: integrações de parceiros".
