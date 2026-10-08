# Logs do sistema e mensagens de erro reais — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a mensagem genérica de erro do painel por mensagens reais e gravar em banco tudo que acontece no sistema (requisições, erros da API, de segundo plano e do navegador), com uma página "Logs do sistema" em Configurações para o super admin.

**Architecture:** A API ganha a tabela `SystemLogs`, um gravador em lote (`libs/systemLog.ts`), um middleware de requisições, um tratador de erros extraído para `middleware/errorHandler.ts` que devolve `ERR_INTERNAL` + protocolo, e um gancho no `logger` (pino) que leva `logger.warn/error` para a tabela. O painel ganha `errorMessage()` no `toastError`, um `ErrorBoundary`, envio de erros do navegador para `POST /system-logs/client` e a página `/settings/logs`.

**Tech Stack:** Node 24, Express, Sequelize (sequelize-typescript), Postgres 18, pino 7, Jest 27 + ts-jest + supertest (API); React 17, Material UI 4, react-scripts 3 / Jest (painel).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-08-logs-e-mensagens-de-erro-design.md`

Repositórios: `whatsapp-api` (API) e `whatsapp-app` (painel), ambos em `/Users/thiagorodrigues/Projetos/weconex/`. Testes da API: `npx jest <caminho>` dentro de `whatsapp-api`. Testes do painel: `CI=true npx react-scripts test --watchAll=false <caminho>` dentro de `whatsapp-app`.

## Global Constraints

- Página só para super admin (`user.super`; na API, middleware `isSuper`), todas as empresas.
- Registrar: requisições, erros da API, erros em segundo plano e erros do navegador.
- Retenção: `info` 7 dias; `warn` e `error` 30 dias; limpeza diária às 03:30.
- Local da página: Configurações → "Logs do sistema", rota `/settings/logs`.
- Protocolo: 6 caracteres do alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
- Mascarar valores de chaves que casem com `/pass|senha|token|secret|authorization|api[-_]?key|cookie/i` como `***`.
- Limites: `message` 1000 caracteres, `detail` 8 KB, `context` 4 KB serializado.
- Lote: descarga a cada 2 s ou 200 itens; fila máxima 5.000.
- Rota do navegador: até 30 registros por usuário por minuto; acima responde 204 sem gravar.
- Gravar log nunca pode derrubar uma requisição nem gerar outro log sobre si mesmo.
- Push na `main` de qualquer repo publica em produção: só com autorização do usuário.
- `Dockerfile`, `.dockerignore` e `nginx.conf` não entram em commits.

## Review Focus

1. Erro dentro do próprio gravador (banco fora, tabela inexistente antes da migration) → a API continua respondendo e só escreve no console.
2. Corpo de requisição com senha/token/chave aninhados ou em array → nada disso chega à tabela.
3. Rajada de erros (loop no navegador ou fila em erro) → fila em memória limitada, limite por usuário na rota `client`, sem travar a API.
4. Erro durante o envio de um 4xx/5xx → um único registro por requisição, sem duplicar entre middleware, tratador e gancho do logger.
5. Navegador sem resposta do servidor → mensagem "Sem resposta do servidor…", nunca o texto genérico, e o envio do log não gera outro toast.

---

## Estrutura de arquivos

API (`whatsapp-api/src`):
- Criar `database/migrations/20261008200000-create-system-logs.ts` — tabela e índices.
- Criar `models/SystemLog.ts` — modelo; registrar em `database/index.ts`.
- Criar `libs/requestContext.ts` — `AsyncLocalStorage` com a requisição atual.
- Criar `libs/systemLog.ts` — `newProtocol`, `mask`, `recordLog`, `flushLogs`.
- Modificar `utils/logger.ts` — `rawLogger` e gancho que grava `warn/error`.
- Criar `middleware/requestLog.ts` — registro de cada requisição.
- Criar `middleware/errorHandler.ts` — tratador de erros (sai de `app.ts`).
- Modificar `app.ts` — usar `requestLog` e `errorHandler`.
- Modificar `server.ts` — `unhandledRejection`, `uncaughtException`, descarga no desligamento, limpeza diária.
- Modificar `queues.ts` — `on("failed")` nas filas.
- Criar `services/SystemLogServices/ListSystemLogsService.ts`, `SummarySystemLogsService.ts`, `PurgeSystemLogsService.ts`, `clientLogLimiter.ts`.
- Criar `controllers/SystemLogController.ts` e `routes/systemLogRoutes.ts`; registrar em `routes/index.ts`.
- Modificar `services/AiAgentServices/keys.ts` — `ERR_AI_KEY_UNREADABLE`.

Painel (`whatsapp-app/src`):
- Modificar `errors/toastError.js` — `errorMessage()` e envio de erro de rede.
- Criar `utils/clientLog.js` — envio para `/system-logs/client`.
- Modificar `translate/languages/pt.js` — 26 textos novos.
- Modificar os 6 arquivos com `toast.error(e|err|err.message)`.
- Criar `components/ErrorBoundary/index.js`; modificar `layout/index.js`.
- Criar `components/SystemLogs/index.js`, `components/SystemLogs/format.js`; modificar `pages/SettingsCustom/index.js` e `layout/MainListItems.js`.

---

### Task 1: Tabela `SystemLogs` e modelo

**Files:**
- Create: `whatsapp-api/src/database/migrations/20261008200000-create-system-logs.ts`
- Create: `whatsapp-api/src/models/SystemLog.ts`
- Modify: `whatsapp-api/src/database/index.ts` (import e lista `models`)

**Interfaces:**
- Produces: modelo `SystemLog` (default export) com colunas `id, createdAt, level, source, protocol, companyId, userId, method, route, status, durationMs, code, message, detail, context`.

- [ ] **Step 1: Escrever a migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Logs do sistema (requisições, erros da API, de segundo plano e do
// navegador). Sem FKs: o registro sobrevive à exclusão da empresa/usuário.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("SystemLogs", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      level: { type: DataTypes.STRING(8), allowNull: false },
      source: { type: DataTypes.STRING(8), allowNull: false },
      protocol: { type: DataTypes.STRING(8), allowNull: true },
      companyId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      method: { type: DataTypes.STRING(8), allowNull: true },
      route: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.SMALLINT, allowNull: true },
      durationMs: { type: DataTypes.INTEGER, allowNull: true },
      code: { type: DataTypes.STRING(80), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      detail: { type: DataTypes.TEXT, allowNull: true },
      context: { type: DataTypes.JSONB, allowNull: true }
    });
    await queryInterface.addIndex("SystemLogs", ["createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["level", "createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["companyId", "createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["protocol"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("SystemLogs");
  }
};
```

- [ ] **Step 2: Escrever o modelo**

```ts
import { Table, Column, Model, PrimaryKey, AutoIncrement, CreatedAt, DataType } from "sequelize-typescript";

@Table({ tableName: "SystemLogs", updatedAt: false })
class SystemLog extends Model<SystemLog> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @CreatedAt
  createdAt: Date;

  @Column(DataType.STRING(8))
  level: string;

  @Column(DataType.STRING(8))
  source: string;

  @Column(DataType.STRING(8))
  protocol: string;

  @Column
  companyId: number;

  @Column
  userId: number;

  @Column(DataType.STRING(8))
  method: string;

  @Column(DataType.STRING(255))
  route: string;

  @Column(DataType.SMALLINT)
  status: number;

  @Column
  durationMs: number;

  @Column(DataType.STRING(80))
  code: string;

  @Column(DataType.TEXT)
  message: string;

  @Column(DataType.TEXT)
  detail: string;

  @Column(DataType.JSONB)
  context: object;
}

export default SystemLog;
```

- [ ] **Step 3: Registrar o modelo** — em `database/index.ts`, `import SystemLog from "../models/SystemLog";` junto dos outros imports e `SystemLog` ao final do array `models` (depois de `FollowUpEnrollment`).

- [ ] **Step 4: Compilar e migrar no HM**

Run: `cd whatsapp-api && npx tsc -p . && npx sequelize db:migrate`
Expected: `TypeScript: No errors found` e `== 20261008200000-create-system-logs: migrated`.
Conferir: `docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c '\d "SystemLogs"'` mostra as 15 colunas e 4 índices.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/20261008200000-create-system-logs.ts src/models/SystemLog.ts src/database/index.ts
git commit -m "Tabela SystemLogs para os logs do sistema"
```

---

### Task 2: Gravador em lote (`libs/systemLog.ts`) e contexto da requisição

**Files:**
- Create: `whatsapp-api/src/libs/requestContext.ts`
- Create: `whatsapp-api/src/libs/systemLog.ts`
- Test: `whatsapp-api/src/libs/__tests__/systemLog.spec.ts`

**Interfaces:**
- Consumes: `SystemLog.bulkCreate` (Task 1).
- Produces:
  - `type LogLevel = "info" | "warn" | "error"`, `type LogSource = "api" | "job" | "web"`
  - `interface LogEntry { level: LogLevel; source: LogSource; message: string; protocol?: string; companyId?: number; userId?: number; method?: string; route?: string; status?: number; durationMs?: number; code?: string; detail?: string; context?: unknown; createdAt?: Date }`
  - `newProtocol(): string`, `mask(value: unknown): unknown`, `recordLog(entry: LogEntry): void`, `flushLogs(): Promise<void>`, `resetLogQueueForTests(): void`
  - `requestContext: AsyncLocalStorage<{ req: Request; res: Response }>`

- [ ] **Step 1: Escrever os testes**

```ts
const bulkCreate = jest.fn();
jest.mock("../../models/SystemLog", () => ({ __esModule: true, default: { bulkCreate: (...a: any[]) => bulkCreate(...a) } }));

// eslint-disable-next-line import/first
import { flushLogs, mask, newProtocol, recordLog, resetLogQueueForTests } from "../systemLog";

beforeEach(() => {
  jest.useFakeTimers();
  bulkCreate.mockReset().mockResolvedValue([]);
  resetLogQueueForTests();
});
afterEach(() => jest.useRealTimers());

describe("newProtocol", () => {
  it("has 6 characters without ambiguous ones", () => {
    for (let i = 0; i < 200; i += 1) expect(newProtocol()).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  });
});

describe("mask", () => {
  it("hides secrets at any depth, also inside arrays", () => {
    expect(
      mask({ email: "a@b.com", password: "x", nested: { apiKey: "sk", list: [{ Authorization: "Bearer y", ok: 1 }] }, senhaNova: "z" })
    ).toEqual({ email: "a@b.com", password: "***", nested: { apiKey: "***", list: [{ Authorization: "***", ok: 1 }] }, senhaNova: "***" });
  });
  it("cuts long strings and stops at deep nesting", () => {
    expect((mask("a".repeat(2000)) as string).length).toBeLessThanOrEqual(501);
    const deep: any = {}; let cur = deep;
    for (let i = 0; i < 20; i += 1) { cur.n = {}; cur = cur.n; }
    expect(JSON.stringify(mask(deep))).toContain("[…]");
  });
});

describe("recordLog / flushLogs", () => {
  it("writes in batches every 2 s", async () => {
    recordLog({ level: "info", source: "api", message: "GET /x 200" });
    recordLog({ level: "error", source: "job", message: "boom", context: { token: "t" } });
    expect(bulkCreate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    await flushLogs();
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    const rows = bulkCreate.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ level: "error", source: "job", message: "boom", context: { token: "***" } });
    expect(rows[1].createdAt).toBeInstanceOf(Date);
  });
  it("writes right away at 200 entries", async () => {
    for (let i = 0; i < 200; i += 1) recordLog({ level: "info", source: "api", message: `r${i}` });
    await flushLogs();
    expect(bulkCreate.mock.calls[0][0]).toHaveLength(200);
  });
  it("limits sizes", async () => {
    recordLog({ level: "error", source: "api", message: "m".repeat(3000), detail: "d".repeat(20000), context: { big: "x".repeat(400).split("").map(() => "y".repeat(400)) } });
    await flushLogs();
    const [row] = bulkCreate.mock.calls[0][0];
    expect(row.message.length).toBeLessThanOrEqual(1001);
    expect(row.detail.length).toBeLessThanOrEqual(8001);
    expect(JSON.stringify(row.context).length).toBeLessThanOrEqual(4100);
  });
  it("drops past 5000 queued and reports how many", async () => {
    bulkCreate.mockImplementation(() => new Promise(() => undefined)); // banco travado
    for (let i = 0; i < 5010; i += 1) recordLog({ level: "info", source: "api", message: `r${i}` });
    resetLogQueueForTests({ keepQueue: true });
    bulkCreate.mockReset().mockResolvedValue([]);
    await flushLogs();
    const rows = bulkCreate.mock.calls.flatMap(c => c[0]);
    expect(rows.some((r: any) => r.level === "warn" && /descartados/.test(r.message))).toBe(true);
  });
  it("never throws when the database fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    bulkCreate.mockRejectedValue(new Error("relation does not exist"));
    recordLog({ level: "error", source: "api", message: "x" });
    await expect(flushLogs()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/libs/__tests__/systemLog.spec.ts`
Expected: FAIL — `Cannot find module '../systemLog'`.

- [ ] **Step 3: Escrever `libs/requestContext.ts`**

```ts
import { AsyncLocalStorage } from "async_hooks";
import { Request, Response } from "express";

// The request being handled, for logs written deep inside services.
export const requestContext = new AsyncLocalStorage<{ req: Request; res: Response }>();
```

- [ ] **Step 4: Escrever `libs/systemLog.ts`**

```ts
import crypto from "crypto";
import SystemLog from "../models/SystemLog";

// Logs do sistema: gravados em lote na tabela SystemLogs. Gravar log nunca
// derruba quem chamou: falha ao gravar vai só para o console.

export type LogLevel = "info" | "warn" | "error";
export type LogSource = "api" | "job" | "web";

export interface LogEntry {
  level: LogLevel;
  source: LogSource;
  message: string;
  protocol?: string;
  companyId?: number;
  userId?: number;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  detail?: string;
  context?: unknown;
  createdAt?: Date;
}

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SECRET_KEY = /pass|senha|token|secret|authorization|api[-_]?key|cookie/i;
const BATCH = 200;
const INTERVAL_MS = 2000;
const MAX_QUEUE = 5000;
const MAX_CONTEXT = 4000;

export const newProtocol = (): string =>
  Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join("");

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export const mask = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return cut(value, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map(v => mask(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "***" : mask(v, depth + 1)])
    );
  }
  return value;
};

const limitContext = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  const masked = mask(value);
  const json = JSON.stringify(masked);
  return json.length <= MAX_CONTEXT ? masked : { truncated: true, preview: json.slice(0, MAX_CONTEXT) };
};

const toRow = (entry: LogEntry) => ({
  createdAt: entry.createdAt || new Date(),
  level: entry.level,
  source: entry.source,
  protocol: entry.protocol || null,
  companyId: Number.isFinite(Number(entry.companyId)) && entry.companyId !== undefined ? Number(entry.companyId) : null,
  userId: Number.isFinite(Number(entry.userId)) && entry.userId !== undefined ? Number(entry.userId) : null,
  method: entry.method || null,
  route: entry.route ? cut(entry.route, 250) : null,
  status: entry.status ?? null,
  durationMs: entry.durationMs ?? null,
  code: entry.code ? cut(entry.code, 78) : null,
  message: cut(String(entry.message || ""), 1000),
  detail: entry.detail ? cut(String(entry.detail), 8000) : null,
  context: limitContext(entry.context)
});

let queue: ReturnType<typeof toRow>[] = [];
let dropped = 0;
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

const schedule = (): void => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushLogs();
  }, INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
};

export const flushLogs = (): Promise<void> => {
  if (flushing) return flushing;
  if (!queue.length && !dropped) return Promise.resolve();
  flushing = (async () => {
    try {
      while (queue.length || dropped) {
        const rows = queue.splice(0, BATCH);
        if (dropped) {
          rows.push(toRow({ level: "warn", source: "api", message: `${dropped} registros de log descartados (fila cheia)` }));
          dropped = 0;
        }
        try {
          await SystemLog.bulkCreate(rows as any[]);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`SystemLogs: falha ao gravar ${rows.length} registros: ${(err as Error)?.message || err}`);
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
};

export const recordLog = (entry: LogEntry): void => {
  try {
    if (queue.length >= MAX_QUEUE) {
      dropped += 1;
      return;
    }
    queue.push(toRow(entry));
    if (queue.length >= BATCH) flushLogs();
    else schedule();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`SystemLogs: registro ignorado: ${(err as Error)?.message || err}`);
  }
};

export const resetLogQueueForTests = ({ keepQueue = false } = {}): void => {
  if (!keepQueue) {
    queue = [];
    dropped = 0;
  }
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = null;
};
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/libs/__tests__/systemLog.spec.ts`
Expected: PASS (8 testes). Se o teste "drops past 5000" falhar por causa do `flushing` pendurado, confira que `resetLogQueueForTests({ keepQueue: true })` zera `flushing` mantendo `queue` e `dropped`.

- [ ] **Step 6: Commit**

```bash
git add src/libs/requestContext.ts src/libs/systemLog.ts src/libs/__tests__/systemLog.spec.ts
git commit -m "Gravador em lote dos logs do sistema"
```

---

### Task 3: `logger` grava avisos e erros de segundo plano

**Files:**
- Modify: `whatsapp-api/src/utils/logger.ts`
- Test: `whatsapp-api/src/utils/__tests__/logger.spec.ts`

**Interfaces:**
- Consumes: `recordLog`, `newProtocol` (Task 2), `requestContext` (Task 2).
- Produces: `logger` (como hoje, mas `warn/error` também vão para `SystemLogs`), `rawLogger` (só console, para quem já gravou o registro), `logEntryFromArgs(level, args): LogEntry` (exportado para teste).

- [ ] **Step 1: Escrever os testes**

```ts
const recordLog = jest.fn();
jest.mock("../../libs/systemLog", () => ({
  recordLog: (...a: any[]) => recordLog(...a),
  newProtocol: () => "ABC234"
}));

// eslint-disable-next-line import/first
import { logger, rawLogger, logEntryFromArgs } from "../logger";
// eslint-disable-next-line import/first
import { requestContext } from "../../libs/requestContext";

beforeEach(() => recordLog.mockClear());

describe("logger", () => {
  it("records errors with the stack", () => {
    logger.error(new Error("falhou o envio"));
    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({ level: "error", source: "job", message: "falhou o envio", protocol: "ABC234" }));
    expect(recordLog.mock.calls[0][0].detail).toContain("Error: falhou o envio");
  });
  it("records { err } objects and extra text", () => {
    logger.error({ err: new Error("timeout") }, "Fila CampaignQueue job 7 falhou");
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "error", message: "Fila CampaignQueue job 7 falhou: timeout" });
  });
  it("records warnings, not info", () => {
    logger.info("tudo bem");
    logger.warn("fila com 300 pendentes");
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "warn", message: "fila com 300 pendentes" });
  });
  it("tags logs written during a request with it", () => {
    const req: any = { method: "POST", originalUrl: "/ai-agents/3/test?x=1", user: { companyId: 4, id: "9" } };
    requestContext.run({ req, res: {} as any }, () => logger.error("algo"));
    expect(recordLog.mock.calls[0][0]).toMatchObject({ source: "api", companyId: 4, userId: 9, method: "POST", route: "/ai-agents/3/test" });
  });
  it("rawLogger never records", () => {
    rawLogger.error(new Error("x"));
    expect(recordLog).not.toHaveBeenCalled();
  });
  it("builds a message from mixed arguments", () => {
    expect(logEntryFromArgs("error", ["MessageQueue -> SendMessage: error", "sem conexão"]).message).toBe(
      "MessageQueue -> SendMessage: error sem conexão"
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/utils/__tests__/logger.spec.ts`
Expected: FAIL — `rawLogger`/`logEntryFromArgs` não existem e nada é gravado.

- [ ] **Step 3: Reescrever `utils/logger.ts`**

```ts
import pino from "pino";
import { LogEntry, newProtocol, recordLog } from "../libs/systemLog";
import { requestContext } from "../libs/requestContext";

// pino-pretty roda numa worker thread: fora dos testes.
const base = process.env.NODE_ENV === "test"
  ? {}
  : { transport: { target: "pino-pretty", options: { levelFirst: true, translateTime: true, colorize: true } } };

const describe = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// warn/error do código viram registros em SystemLogs.
export const logEntryFromArgs = (level: "warn" | "error", args: unknown[]): LogEntry => {
  const [first, ...rest] = args;
  const objectErr = first && typeof first === "object" && !(first instanceof Error) ? (first as any).err : undefined;
  const error = first instanceof Error ? first : objectErr instanceof Error ? objectErr : undefined;
  const textParts = (objectErr !== undefined ? rest : args)
    .filter(a => !(a instanceof Error) || a !== error)
    .map(describe)
    .filter(Boolean);
  const text = textParts.join(" ");
  const message = error ? (text ? `${text}: ${error.message}` : error.message) : text || describe(objectErr);
  const ctx = requestContext.getStore();
  const req = ctx?.req as any;
  return {
    level,
    source: req ? "api" : "job",
    message,
    detail: error?.stack,
    protocol: newProtocol(),
    companyId: req?.user?.companyId,
    userId: req?.user?.id !== undefined ? Number(req.user.id) : undefined,
    method: req?.method,
    route: req?.originalUrl ? String(req.originalUrl).split("?")[0] : undefined
  };
};

// Só console: para quem já gravou o registro (tratador de erros da API).
export const rawLogger = pino(base);

const logger = pino({
  ...base,
  hooks: {
    logMethod(args: any[], method: (...a: any[]) => void, level: number) {
      if (level >= 40) recordLog(logEntryFromArgs(level >= 50 ? "error" : "warn", args));
      return method.apply(this, args);
    }
  }
});

export { logger };
```

- [ ] **Step 4: Rodar e ver passar; rodar a suíte inteira**

Run: `npx jest src/utils/__tests__/logger.spec.ts && npx jest`
Expected: PASS em tudo. Se algum teste antigo falhar porque agora o logger importa `models/SystemLog`, adicione no teste `jest.mock("../../libs/systemLog", () => ({ recordLog: jest.fn(), newProtocol: () => "X" }))` com o caminho relativo certo — não altere o comportamento do logger.

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger.ts src/utils/__tests__/logger.spec.ts
git commit -m "Logger leva avisos e erros para os logs do sistema"
```

---

### Task 4: Registro de requisições e tratador de erros com protocolo

**Files:**
- Create: `whatsapp-api/src/middleware/requestLog.ts`
- Create: `whatsapp-api/src/middleware/errorHandler.ts`
- Modify: `whatsapp-api/src/app.ts` (usar os dois; remover o tratador inline)
- Test: `whatsapp-api/src/middleware/__tests__/requestLog.spec.ts`

**Interfaces:**
- Consumes: `recordLog`, `newProtocol` (Task 2), `requestContext` (Task 2), `rawLogger` (Task 3).
- Produces: `requestLog` (middleware express), `errorHandler` (middleware de erro express). Resposta de erro inesperado: `500 { error: "ERR_INTERNAL", protocol }`. `res.locals.logged = true` quando o tratador já gravou.

- [ ] **Step 1: Escrever os testes**

```ts
import express from "express";
import request from "supertest";
import "express-async-errors";
import multer from "multer";

const recordLog = jest.fn();
jest.mock("../../libs/systemLog", () => ({ recordLog: (...a: any[]) => recordLog(...a), newProtocol: () => "K7Q2M9" }));
jest.mock("../../utils/logger", () => ({ rawLogger: { warn: jest.fn(), error: jest.fn() }, logger: { warn: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import requestLog from "../requestLog";
// eslint-disable-next-line import/first
import errorHandler from "../errorHandler";
// eslint-disable-next-line import/first
import AppError from "../../errors/AppError";

const app = express();
app.use(express.json());
app.use(requestLog);
app.use((req: any, _res, next) => { req.user = { id: "9", companyId: 4 }; next(); });
app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/ok", (_req, res) => res.json({ ok: true }));
app.get("/system-logs", (_req, res) => res.json([]));
app.post("/app-error", () => { throw new AppError("ERR_NO_SCHEDULE_FOUND", 404); });
app.post("/crash", () => { throw new Error("cannot read property x of undefined"); });
app.post("/upload", () => { throw new multer.MulterError("LIMIT_FILE_SIZE"); });
app.use(errorHandler);

beforeEach(() => recordLog.mockClear());

describe("requestLog + errorHandler", () => {
  it("records a successful request as info", async () => {
    await request(app).get("/ok?token=abc").expect(200);
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "info", source: "api", method: "GET", route: "/ok", status: 200, companyId: 4, userId: 9 });
    expect(recordLog.mock.calls[0][0].durationMs).toEqual(expect.any(Number));
  });
  it("skips the status route, options and the log page itself", async () => {
    await request(app).get("/");
    await request(app).options("/ok");
    await request(app).get("/system-logs");
    expect(recordLog).not.toHaveBeenCalled();
  });
  it("records an AppError once, as warn with code and masked body", async () => {
    const res = await request(app).post("/app-error").send({ id: 1, password: "segredo" }).expect(404);
    expect(res.body).toEqual({ error: "ERR_NO_SCHEDULE_FOUND" });
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "warn", status: 404, code: "ERR_NO_SCHEDULE_FOUND", protocol: "K7Q2M9", route: "/app-error" });
    expect(recordLog.mock.calls[0][0].context.body).toEqual({ id: 1, password: "segredo" }); // mascarado depois, no gravador
  });
  it("answers ERR_INTERNAL with a protocol on unexpected errors", async () => {
    const res = await request(app).post("/crash").expect(500);
    expect(res.body).toEqual({ error: "ERR_INTERNAL", protocol: "K7Q2M9" });
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "error", status: 500, code: "ERR_INTERNAL", message: "cannot read property x of undefined" });
    expect(recordLog.mock.calls[0][0].detail).toContain("Error: cannot read property");
  });
  it("keeps the upload error codes", async () => {
    const res = await request(app).post("/upload").expect(400);
    expect(res.body).toEqual({ error: "ERR_FILE_TOO_LARGE" });
    expect(recordLog).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/middleware/__tests__/requestLog.spec.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Escrever `middleware/requestLog.ts`**

```ts
import { Request, Response, NextFunction } from "express";
import { newProtocol, recordLog } from "../libs/systemLog";
import { requestContext } from "../libs/requestContext";

// Cada requisição vira um registro; erros já gravados pelo errorHandler
// (res.locals.logged) não se repetem.
const SKIP = [/^\/public\//, /^\/socket\.io/, /^\/system-logs/];

export const routeOf = (req: Request): string => String(req.originalUrl || req.url || "").split("?")[0];

const requestLog = (req: Request, res: Response, next: NextFunction): void => {
  const route = routeOf(req);
  if (req.method === "OPTIONS" || (req.method === "GET" && route === "/") || SKIP.some(r => r.test(route))) {
    next();
    return;
  }
  const started = process.hrtime.bigint();
  res.locals.startedAt = started;
  res.on("finish", () => {
    if (res.locals.logged) return;
    const status = res.statusCode;
    const user = (req as any).user;
    recordLog({
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      source: "api",
      method: req.method,
      route,
      status,
      durationMs: Number((process.hrtime.bigint() - started) / BigInt(1000000)),
      companyId: user?.companyId,
      userId: user?.id !== undefined ? Number(user.id) : undefined,
      protocol: status >= 400 ? newProtocol() : undefined,
      message: `${req.method} ${route} ${status}`
    });
  });
  requestContext.run({ req, res }, next);
};

export default requestLog;
```

- [ ] **Step 4: Escrever `middleware/errorHandler.ts`**

```ts
import { Request, Response, NextFunction } from "express";
import multer from "multer";
import AppError from "../errors/AppError";
import { LogEntry, newProtocol, recordLog } from "../libs/systemLog";
import { rawLogger } from "../utils/logger";
import { routeOf } from "./requestLog";

const requestFields = (req: Request, res: Response): Partial<LogEntry> => {
  const user = (req as any).user;
  const started = res.locals.startedAt as bigint | undefined;
  return {
    source: "api",
    method: req.method,
    route: routeOf(req),
    companyId: user?.companyId,
    userId: user?.id !== undefined ? Number(user.id) : undefined,
    durationMs: started ? Number((process.hrtime.bigint() - started) / BigInt(1000000)) : undefined,
    context: { body: req.body, query: req.query }
  };
};

const codeOf = (message: string): string | undefined => {
  const match = /^([A-Z][A-Z0-9_]{2,})(?::|$)/.exec(message || "");
  return match ? match[1] : undefined;
};

// Todo erro devolvido pela API fica registrado com protocolo; o inesperado
// responde ERR_INTERNAL + protocolo em vez de "Internal server error".
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): Response => {
  const protocol = newProtocol();
  res.locals.logged = true;

  if (err instanceof AppError) {
    recordLog({ ...requestFields(req, res), level: err.statusCode >= 500 ? "error" : "warn", status: err.statusCode, code: codeOf(err.message), message: err.message, protocol } as LogEntry);
    rawLogger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const code = err.code === "LIMIT_FILE_SIZE" ? "ERR_FILE_TOO_LARGE" : "ERR_UPLOAD_INVALID";
    recordLog({ ...requestFields(req, res), level: "warn", status: 400, code, message: err.message, protocol } as LogEntry);
    return res.status(400).json({ error: code });
  }

  recordLog({ ...requestFields(req, res), level: "error", status: 500, code: "ERR_INTERNAL", message: err?.message || String(err), detail: err?.stack, protocol } as LogEntry);
  rawLogger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL", protocol });
};

export default errorHandler;
```

- [ ] **Step 5: Ligar em `app.ts`** — trocar `import multer from "multer";` por `import requestLog from "./middleware/requestLog";` e `import errorHandler from "./middleware/errorHandler";`; colocar `app.use(requestLog);` logo depois de `app.use(cookieParser());`; substituir todo o bloco `app.use(async (err: Error, req, res, _) => { ... })` por `app.use(errorHandler);`. Remover os imports que ficarem sem uso (`AppError`, `logger`, `NextFunction`, `Request`, `Response`) se o `tsc`/eslint acusar.

- [ ] **Step 6: Rodar testes e compilar**

Run: `npx jest src/middleware && npx tsc -p . --noEmit`
Expected: PASS e `TypeScript: No errors found`.

- [ ] **Step 7: Commit**

```bash
git add src/middleware/requestLog.ts src/middleware/errorHandler.ts src/middleware/__tests__/requestLog.spec.ts src/app.ts
git commit -m "Registro de requisições e erro interno com protocolo"
```

---

### Task 5: Erros de processo, filas e desligamento

**Files:**
- Modify: `whatsapp-api/src/server.ts`
- Modify: `whatsapp-api/src/queues.ts` (dentro de `startQueueProcess`)

**Interfaces:**
- Consumes: `logger` (Task 3), `flushLogs` (Task 2).

- [ ] **Step 1: Processo e desligamento em `server.ts`** — depois do bloco `missing`, acrescentar:

```ts
import { flushLogs } from "./libs/systemLog";

// Promessa sem catch: registra e segue (antes derrubava o processo).
process.on("unhandledRejection", reason => {
  logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, "unhandledRejection");
});
// Exceção sem tratamento: registra, grava e encerra (o container reinicia).
process.on("uncaughtException", err => {
  logger.error({ err }, "uncaughtException");
  flushLogs().finally(() => process.exit(1));
});
```

E trocar `gracefulShutdown(server);` por:

```ts
gracefulShutdown(server, { onShutdown: () => flushLogs() });
```

- [ ] **Step 2: Falha de job nas filas** — em `queues.ts`, no início de `startQueueProcess` (antes dos `.process(...)`), acrescentar:

```ts
  // Job que falhou (depois das tentativas) aparece nos logs do sistema.
  [messageQueue, scheduleMonitor, sendScheduledMessages, campaignQueue, userMonitor, followUpMonitor, queueMonitor].forEach(queue =>
    queue.on("failed", (job, err) =>
      logger.error({ err }, `Fila ${queue.name} job ${job?.id} (${job?.name}) falhou`)
    )
  );
```

- [ ] **Step 3: Compilar e rodar a suíte**

Run: `npx tsc -p . --noEmit && npx jest`
Expected: sem erros de tipo; suíte toda PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/queues.ts
git commit -m "Falhas de filas e do processo nos logs do sistema"
```

---

### Task 6: Rotas de consulta, resumo e erros do navegador

**Files:**
- Create: `whatsapp-api/src/services/SystemLogServices/ListSystemLogsService.ts`
- Create: `whatsapp-api/src/services/SystemLogServices/SummarySystemLogsService.ts`
- Create: `whatsapp-api/src/services/SystemLogServices/clientLogLimiter.ts`
- Create: `whatsapp-api/src/controllers/SystemLogController.ts`
- Create: `whatsapp-api/src/routes/systemLogRoutes.ts`
- Modify: `whatsapp-api/src/routes/index.ts`
- Test: `whatsapp-api/src/services/SystemLogServices/__tests__/systemLogServices.spec.ts`
- Test: `whatsapp-api/src/routes/__tests__/systemLogRoutes.spec.ts`

**Interfaces:**
- Consumes: `SystemLog` (Task 1), `recordLog`, `newProtocol` (Task 2), `isAuth`, `isSuper`.
- Produces (HTTP):
  - `GET /system-logs?level&source&companyId&status&search&from&to&pageNumber` → `{ logs: Array<SystemLog & { companyName: string|null; userName: string|null }>, hasMore: boolean }`
  - `GET /system-logs/summary` → `{ errors: number; warnings: number; requests: number; avgMs: number|null }`
  - `POST /system-logs/client` body `{ message, detail?, url?, kind? }` → `200 { protocol }` ou `204`.

- [ ] **Step 1: Escrever os testes dos serviços**

```ts
import { Op } from "sequelize";

const findAll = jest.fn();
const companyFindAll = jest.fn();
const userFindAll = jest.fn();
const query = jest.fn();
jest.mock("../../../models/SystemLog", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAll(...a) } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findAll: (...a: any[]) => companyFindAll(...a) } }));
jest.mock("../../../models/User", () => ({ __esModule: true, default: { findAll: (...a: any[]) => userFindAll(...a) } }));
jest.mock("../../../database", () => ({ __esModule: true, default: { query: (...a: any[]) => query(...a) } }));

// eslint-disable-next-line import/first
import ListSystemLogsService from "../ListSystemLogsService";
// eslint-disable-next-line import/first
import SummarySystemLogsService from "../SummarySystemLogsService";
// eslint-disable-next-line import/first
import { acceptClientLog, resetClientLogLimiter } from "../clientLogLimiter";

const row = (id: number, extra: any = {}) => ({ toJSON: () => ({ id, companyId: 4, userId: 9, ...extra }) });

describe("ListSystemLogsService", () => {
  beforeEach(() => {
    companyFindAll.mockResolvedValue([{ id: 4, name: "Adra" }]);
    userFindAll.mockResolvedValue([{ id: 9, name: "Samuel" }]);
  });
  it("filters, defaults to the last hour and names company and user", async () => {
    findAll.mockResolvedValue([row(2), row(1)]);
    const result = await ListSystemLogsService({ level: "error", source: "api", companyId: "4", status: "500", search: " K7Q ", pageNumber: "1" });
    const options = findAll.mock.calls[0][0];
    expect(options.where).toMatchObject({ level: "error", source: "api", companyId: 4, status: 500 });
    expect(options.where.createdAt[Op.gte].getTime()).toBeGreaterThan(Date.now() - 3600 * 1000 - 5000);
    expect(options.where[Op.or]).toHaveLength(4);
    expect(options.limit).toBe(51);
    expect(options.offset).toBe(0);
    expect(result).toEqual({ hasMore: false, logs: [expect.objectContaining({ id: 2, companyName: "Adra", userName: "Samuel" }), expect.objectContaining({ id: 1 })] });
  });
  it("pages by 50 and reports more", async () => {
    findAll.mockResolvedValue(Array.from({ length: 51 }, (_, i) => row(i)));
    const result = await ListSystemLogsService({ pageNumber: "2", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" });
    expect(findAll.mock.calls[0][0].offset).toBe(50);
    expect(findAll.mock.calls[0][0].where.createdAt[Op.lte]).toEqual(new Date("2026-10-02T00:00:00Z"));
    expect(result.hasMore).toBe(true);
    expect(result.logs).toHaveLength(50);
  });
  it("ignores invalid filters", async () => {
    findAll.mockResolvedValue([]);
    await ListSystemLogsService({ level: "drop table", companyId: "abc", status: "x", from: "ontem" });
    const where = findAll.mock.calls[0][0].where;
    expect(where.level).toBeUndefined();
    expect(where.companyId).toBeUndefined();
    expect(where.status).toBeUndefined();
    expect(where.createdAt[Op.gte]).toBeInstanceOf(Date);
  });
});

describe("SummarySystemLogsService", () => {
  it("counts the last 24 h", async () => {
    query.mockResolvedValue([{ errors: "3", warnings: "10", requests: "1200", avgMs: "84" }]);
    expect(await SummarySystemLogsService()).toEqual({ errors: 3, warnings: 10, requests: 1200, avgMs: 84 });
    query.mockResolvedValue([{ errors: "0", warnings: "0", requests: "0", avgMs: null }]);
    expect((await SummarySystemLogsService()).avgMs).toBeNull();
  });
});

describe("acceptClientLog", () => {
  beforeEach(() => resetClientLogLimiter());
  it("allows 30 per user per minute", () => {
    const now = 1000000;
    for (let i = 0; i < 30; i += 1) expect(acceptClientLog(9, now)).toBe(true);
    expect(acceptClientLog(9, now + 1000)).toBe(false);
    expect(acceptClientLog(8, now + 1000)).toBe(true);
    expect(acceptClientLog(9, now + 61000)).toBe(true);
  });
});
```

- [ ] **Step 2: Escrever o teste das rotas**

```ts
jest.mock("../../controllers/SystemLogController", () => ({ index: jest.fn(), summary: jest.fn(), client: jest.fn() }));
// eslint-disable-next-line import/first
import systemLogRoutes from "../systemLogRoutes";

const layers = () =>
  (systemLogRoutes as any).stack.map((l: any) => ({
    path: `${Object.keys(l.route.methods)[0]} ${l.route.path}`,
    names: l.route.stack.map((s: any) => s.handle.name)
  }));

describe("systemLogRoutes", () => {
  it("only super users read the logs", () => {
    const byPath = Object.fromEntries(layers().map((l: any) => [l.path, l.names]));
    expect(byPath["get /system-logs"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
    expect(byPath["get /system-logs/summary"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
  });
  it("any logged user can report a browser error", () => {
    const byPath = Object.fromEntries(layers().map((l: any) => [l.path, l.names]));
    expect(byPath["post /system-logs/client"][0]).toBe("isAuth");
    expect(byPath["post /system-logs/client"]).not.toContain("isSuper");
  });
  it("declares /summary before any parametrized route", () => {
    expect(layers().map((l: any) => l.path)).toEqual(["get /system-logs", "get /system-logs/summary", "post /system-logs/client"]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/services/SystemLogServices src/routes/__tests__/systemLogRoutes.spec.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 4: Escrever `ListSystemLogsService.ts`**

```ts
import { Op, WhereOptions } from "sequelize";
import SystemLog from "../../models/SystemLog";
import Company from "../../models/Company";
import User from "../../models/User";

interface Filters {
  level?: string;
  source?: string;
  companyId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  pageNumber?: string;
}

const PAGE = 50;
const LEVELS = ["info", "warn", "error"];
const SOURCES = ["api", "job", "web"];

const validDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
const validInt = (value?: string): number | undefined => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) ? n : undefined;
};

const ListSystemLogsService = async (filters: Filters) => {
  const where: any = {};
  if (filters.level && LEVELS.includes(filters.level)) where.level = filters.level;
  if (filters.source && SOURCES.includes(filters.source)) where.source = filters.source;
  const companyId = validInt(filters.companyId);
  if (companyId !== undefined) where.companyId = companyId;
  const status = validInt(filters.status);
  if (status !== undefined) where.status = status;

  const from = validDate(filters.from) || new Date(Date.now() - 3600 * 1000);
  const to = validDate(filters.to);
  where.createdAt = { [Op.gte]: from, ...(to ? { [Op.lte]: to } : {}) };

  const search = (filters.search || "").trim();
  if (search) {
    const like = `%${search}%`;
    where[Op.or] = [
      { protocol: { [Op.iLike]: like } },
      { code: { [Op.iLike]: like } },
      { route: { [Op.iLike]: like } },
      { message: { [Op.iLike]: like } }
    ];
  }

  const page = Math.max(validInt(filters.pageNumber) || 1, 1);
  const rows = await SystemLog.findAll({
    where: where as WhereOptions,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: PAGE + 1,
    offset: (page - 1) * PAGE
  });
  const logs = rows.slice(0, PAGE).map(r => r.toJSON() as any);

  const companyIds = [...new Set(logs.map(l => l.companyId).filter(Boolean))];
  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
  const [companies, users] = await Promise.all([
    companyIds.length ? Company.findAll({ where: { id: companyIds }, attributes: ["id", "name"] }) : [],
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ["id", "name"] }) : []
  ]);
  const companyName = new Map((companies as any[]).map(c => [c.id, c.name]));
  const userName = new Map((users as any[]).map(u => [u.id, u.name]));

  return {
    hasMore: rows.length > PAGE,
    logs: logs.map(l => ({ ...l, companyName: companyName.get(l.companyId) ?? null, userName: userName.get(l.userId) ?? null }))
  };
};

export default ListSystemLogsService;
```

- [ ] **Step 5: Escrever `SummarySystemLogsService.ts`**

```ts
import { QueryTypes } from "sequelize";
import sequelize from "../../database";

const SummarySystemLogsService = async () => {
  const [row]: any[] = await sequelize.query(
    `SELECT count(*) FILTER (WHERE level = 'error') AS errors,
            count(*) FILTER (WHERE level = 'warn') AS warnings,
            count(*) FILTER (WHERE source = 'api' AND status IS NOT NULL) AS requests,
            round(avg("durationMs") FILTER (WHERE source = 'api' AND "durationMs" IS NOT NULL)) AS "avgMs"
       FROM "SystemLogs"
      WHERE "createdAt" >= :since`,
    { replacements: { since: new Date(Date.now() - 24 * 3600 * 1000) }, type: QueryTypes.SELECT }
  );
  return {
    errors: Number(row?.errors || 0),
    warnings: Number(row?.warnings || 0),
    requests: Number(row?.requests || 0),
    avgMs: row?.avgMs === null || row?.avgMs === undefined ? null : Number(row.avgMs)
  };
};

export default SummarySystemLogsService;
```

- [ ] **Step 6: Escrever `clientLogLimiter.ts`**

```ts
// Erros do navegador: até 30 por usuário por minuto (um loop de erro numa
// tela não enche a tabela).
const LIMIT = 30;
const WINDOW_MS = 60 * 1000;
let windows = new Map<number, { start: number; count: number }>();

export const acceptClientLog = (userId: number, now = Date.now()): boolean => {
  const current = windows.get(userId);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(userId, { start: now, count: 1 });
    return true;
  }
  if (current.count >= LIMIT) return false;
  current.count += 1;
  return true;
};

export const resetClientLogLimiter = (): void => {
  windows = new Map();
};
```

- [ ] **Step 7: Escrever o controller e as rotas**

`controllers/SystemLogController.ts`:

```ts
import { Request, Response } from "express";
import ListSystemLogsService from "../services/SystemLogServices/ListSystemLogsService";
import SummarySystemLogsService from "../services/SystemLogServices/SummarySystemLogsService";
import { acceptClientLog } from "../services/SystemLogServices/clientLogLimiter";
import { newProtocol, recordLog } from "../libs/systemLog";

export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await ListSystemLogsService(req.query as Record<string, string>));

export const summary = async (_req: Request, res: Response): Promise<Response> =>
  res.json(await SummarySystemLogsService());

const KINDS = ["render", "runtime", "network"];

export const client = async (req: Request, res: Response): Promise<Response> => {
  const userId = Number(req.user.id);
  if (!acceptClientLog(userId)) return res.status(204).send();
  const { message, detail, url, kind } = req.body || {};
  const protocol = newProtocol();
  recordLog({
    level: "error",
    source: "web",
    protocol,
    companyId: req.user.companyId,
    userId,
    route: url ? String(url).slice(0, 250) : undefined,
    code: KINDS.includes(kind) ? `WEB_${String(kind).toUpperCase()}` : "WEB_RUNTIME",
    message: String(message || "Erro no navegador"),
    detail: detail ? String(detail) : undefined,
    context: { userAgent: req.headers["user-agent"] }
  });
  return res.json({ protocol });
};
```

`routes/systemLogRoutes.ts`:

```ts
import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as SystemLogController from "../controllers/SystemLogController";

const systemLogRoutes = Router();

systemLogRoutes.get("/system-logs", isAuth, isSuper, SystemLogController.index);
systemLogRoutes.get("/system-logs/summary", isAuth, isSuper, SystemLogController.summary);
systemLogRoutes.post("/system-logs/client", isAuth, SystemLogController.client);

export default systemLogRoutes;
```

Em `routes/index.ts`: `import systemLogRoutes from "./systemLogRoutes";` e `routes.use(systemLogRoutes);` antes de `routes.use(emailRoute);`.

- [ ] **Step 8: Rodar e ver passar; compilar**

Run: `npx jest src/services/SystemLogServices src/routes/__tests__/systemLogRoutes.spec.ts && npx tsc -p . --noEmit`
Expected: PASS; sem erros de tipo. (Se `src/docs/__tests__/openapi.spec.ts` exigir documentar rotas novas, rode `npx jest src/docs` e siga a mensagem do teste.)

- [ ] **Step 9: Commit**

```bash
git add src/services/SystemLogServices src/controllers/SystemLogController.ts src/routes/systemLogRoutes.ts src/routes/__tests__/systemLogRoutes.spec.ts src/routes/index.ts
git commit -m "Rotas dos logs do sistema: consulta, resumo e erros do navegador"
```

---

### Task 7: Limpeza diária e chave de IA ilegível

**Files:**
- Create: `whatsapp-api/src/services/SystemLogServices/PurgeSystemLogsService.ts`
- Modify: `whatsapp-api/src/server.ts` (cron 03:30)
- Modify: `whatsapp-api/src/services/AiAgentServices/keys.ts`
- Test: `whatsapp-api/src/services/SystemLogServices/__tests__/purge.spec.ts`
- Test: `whatsapp-api/src/services/AiAgentServices/__tests__/keys.spec.ts` (criar ou acrescentar)

**Interfaces:**
- Produces: `PurgeSystemLogsService(now?: Date): Promise<number>` (total apagado); `agentKey` lança `AppError("ERR_AI_KEY_UNREADABLE")` quando a chave não decifra.

- [ ] **Step 1: Escrever os testes**

`purge.spec.ts`:

```ts
import { Op } from "sequelize";

const destroy = jest.fn();
jest.mock("../../../models/SystemLog", () => ({ __esModule: true, default: { destroy: (...a: any[]) => destroy(...a) } }));
// eslint-disable-next-line import/first
import PurgeSystemLogsService from "../PurgeSystemLogsService";

it("keeps info 7 days and warn/error 30 days", async () => {
  destroy.mockResolvedValueOnce(100).mockResolvedValueOnce(5);
  const now = new Date("2026-10-08T06:30:00Z");
  expect(await PurgeSystemLogsService(now)).toBe(105);
  expect(destroy.mock.calls[0][0].where).toEqual({ level: "info", createdAt: { [Op.lt]: new Date("2026-10-01T06:30:00Z") } });
  expect(destroy.mock.calls[1][0].where).toEqual({ level: { [Op.in]: ["warn", "error"] }, createdAt: { [Op.lt]: new Date("2026-09-08T06:30:00Z") } });
});
```

`keys.spec.ts` (acrescentar se o arquivo existir):

```ts
import { agentKey } from "../keys";
import { encryptSecret } from "../../../helpers/secretBox";

describe("agentKey", () => {
  it("decrypts a stored key", () => {
    expect(agentKey({ apiKeyEncrypted: encryptSecret("sk-teste-123") })).toBe("sk-teste-123");
  });
  it("explains when the key cannot be read", () => {
    expect(() => agentKey({ apiKeyEncrypted: "v1:aaaa:bbbb:cccc" })).toThrow("ERR_AI_KEY_UNREADABLE");
  });
  it("returns null without a key", () => {
    expect(agentKey({ apiKeyEncrypted: null })).toBeNull();
  });
});
```

(Se `JWT_SECRET`/`SECRETS_KEY` não estiverem definidos no ambiente de teste, coloque `process.env.SECRETS_KEY = "teste";` no topo do arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/SystemLogServices/__tests__/purge.spec.ts src/services/AiAgentServices/__tests__/keys.spec.ts`
Expected: FAIL — serviço não existe; `agentKey` lança "Unsupported state or unable to authenticate data" em vez de `ERR_AI_KEY_UNREADABLE`.

- [ ] **Step 3: Implementar**

`PurgeSystemLogsService.ts`:

```ts
import { Op } from "sequelize";
import SystemLog from "../../models/SystemLog";

const DAY = 24 * 3600 * 1000;

// Retenção: requisições (info) 7 dias; avisos e erros 30 dias.
const PurgeSystemLogsService = async (now = new Date()): Promise<number> => {
  const info = await SystemLog.destroy({ where: { level: "info", createdAt: { [Op.lt]: new Date(now.getTime() - 7 * DAY) } } });
  const problems = await SystemLog.destroy({
    where: { level: { [Op.in]: ["warn", "error"] }, createdAt: { [Op.lt]: new Date(now.getTime() - 30 * DAY) } }
  });
  return info + problems;
};

export default PurgeSystemLogsService;
```

Em `server.ts`, depois do `cron.schedule` existente:

```ts
cron.schedule("30 3 * * *", async () => {
  try {
    const removed = await PurgeSystemLogsService();
    logger.info(`Logs do sistema: ${removed} registros antigos apagados`);
  } catch (error) {
    logger.error({ err: error }, "Limpeza dos logs do sistema falhou");
  }
});
```

(com `import PurgeSystemLogsService from "./services/SystemLogServices/PurgeSystemLogsService";`).

Em `keys.ts`, trocar `agentKey` por:

```ts
// Chave gravada com outra SECRETS_KEY/JWT_SECRET não decifra: o usuário
// precisa informar a chave de novo.
export const agentKey = (agent: { apiKeyEncrypted?: string | null }): string | null => {
  if (!agent.apiKeyEncrypted) return null;
  try {
    return decryptSecret(agent.apiKeyEncrypted);
  } catch (err) {
    throw new AppError("ERR_AI_KEY_UNREADABLE");
  }
};
```

- [ ] **Step 4: Rodar e ver passar; suíte inteira**

Run: `npx jest && npx tsc -p . --noEmit`
Expected: PASS em tudo; sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/services/SystemLogServices/PurgeSystemLogsService.ts src/services/SystemLogServices/__tests__/purge.spec.ts src/server.ts src/services/AiAgentServices/keys.ts src/services/AiAgentServices/__tests__/keys.spec.ts
git commit -m "Limpeza diária dos logs e erro claro para chave de IA ilegível"
```

---

### Task 8: Mensagens reais no `toastError` e traduções

**Files:**
- Modify: `whatsapp-app/src/errors/toastError.js`
- Create: `whatsapp-app/src/utils/clientLog.js`
- Modify: `whatsapp-app/src/translate/languages/pt.js` (bloco `backendErrors`, linha ~970)
- Test: `whatsapp-app/src/errors/toastError.test.js`
- Test (API): `whatsapp-api/src/__tests__/errorTranslations.spec.ts`

**Interfaces:**
- Consumes: `POST /system-logs/client` (Task 6).
- Produces: `errorMessage(err): string` (named export de `toastError.js`); `toastError(err)` (default, mesma assinatura de hoje); `reportClientError({ kind, message, detail?, url? }): Promise<string|null>` (protocolo ou null).

- [ ] **Step 1: Escrever o teste do painel**

```js
import { errorMessage } from "./toastError";

jest.mock("../utils/clientLog", () => ({ reportClientError: jest.fn(() => Promise.resolve(null)) }));

const http = (status, data) => ({ response: { status, data } });

describe("errorMessage", () => {
  it("explains a server that did not answer", () => {
    expect(errorMessage({ isAxiosError: true, request: {}, message: "Network Error" })).toBe(
      "Sem resposta do servidor. Verifique sua conexão ou tente de novo em instantes."
    );
    expect(errorMessage({ isAxiosError: true, request: {}, code: "ECONNABORTED", message: "timeout of 0ms exceeded" })).toBe(
      "O servidor demorou demais para responder. Tente de novo em instantes."
    );
  });
  it("translates known codes, with and without detail", () => {
    expect(errorMessage(http(400, { error: "ERR_AI_TEST_EMPTY" }))).toBe("Escreva uma mensagem para testar.");
    expect(errorMessage(http(404, { error: "ERR_NO_SCHEDULE_FOUND" }))).toBe("Agendamento não encontrado.");
  });
  it("shows the protocol of internal errors", () => {
    expect(errorMessage(http(500, { error: "ERR_INTERNAL", protocol: "K7Q2M9" }))).toBe(
      "Erro interno no servidor (protocolo K7Q2M9). Se continuar, envie esse protocolo ao suporte."
    );
  });
  it("shows readable text and unknown codes as they are", () => {
    expect(errorMessage(http(400, { error: "Não é possível excluir registro de outra empresa" }))).toBe(
      "Não é possível excluir registro de outra empresa"
    );
    expect(errorMessage(http(409, { error: "ERR_SOMETHING_NEW" }))).toBe("Erro: ERR_SOMETHING_NEW (status 409).");
  });
  it("never falls back to the old generic text", () => {
    expect(errorMessage(http(502, "<html>Bad Gateway</html>"))).toBe("Erro inesperado (status 502).");
    expect(errorMessage("Falha local")).toBe("Falha local");
    expect(errorMessage(new Error("x is undefined"))).toBe("x is undefined");
    expect(errorMessage(undefined)).toBe("Erro inesperado.");
  });
});
```

- [ ] **Step 2: Escrever o teste de cobertura de traduções (API)**

```ts
import fs from "fs";
import path from "path";

// Todo código de erro da API precisa de texto no painel (senão o usuário vê
// só "Erro: ERR_X"). Pula quando o repo do painel não está ao lado.
const ptPath = path.resolve(__dirname, "../../../whatsapp-app/src/translate/languages/pt.js");
const maybe = fs.existsSync(ptPath) ? describe : describe.skip;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });

maybe("error translations", () => {
  it("has a Portuguese text for every AppError code", () => {
    const pt = fs.readFileSync(ptPath, "utf8");
    const codes = new Set<string>();
    walk(path.resolve(__dirname, "..")).forEach(file => {
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(/AppError\(\s*["'`]([A-Z][A-Z0-9_]{2,})["'`:]/g)) codes.add(m[1]);
    });
    codes.add("ERR_INTERNAL");
    const missing = [...codes].filter(code => !new RegExp(`^\\s*${code}:`, "m").test(pt));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/errors/toastError.test.js` → FAIL (`errorMessage` não existe).
Run: `cd whatsapp-api && npx jest src/__tests__/errorTranslations.spec.ts` → FAIL listando os 26 códigos.

- [ ] **Step 4: Escrever `utils/clientLog.js`**

```js
import api from "../services/api";

// Erros do navegador vão para os logs do sistema. A mesma mensagem é
// enviada no máximo uma vez a cada 30 s; falha no envio é ignorada.
const recent = new Map();

export const reportClientError = async ({ kind = "runtime", message, detail, url }) => {
	const text = String(message || "Erro no navegador").slice(0, 1000);
	const key = `${kind}:${text}`;
	const now = Date.now();
	if (recent.has(key) && now - recent.get(key) < 30000) return null;
	recent.set(key, now);
	try {
		const { data } = await api.post("/system-logs/client", {
			kind,
			message: text,
			detail: detail ? String(detail).slice(0, 8000) : undefined,
			url: url || window.location.pathname,
		});
		return data?.protocol || null;
	} catch (err) {
		return null;
	}
};
```

- [ ] **Step 5: Reescrever `errors/toastError.js`**

```js
import { toast } from "react-toastify";
import { i18n } from "../translate/i18n";
import { reportClientError } from "../utils/clientLog";

const toastConfig = {
	autoClose: 4000,
	hideProgressBar: false,
	closeOnClick: true,
	pauseOnHover: true,
	draggable: true,
	progress: undefined,
	theme: "light",
};

const NO_ANSWER = "Sem resposta do servidor. Verifique sua conexão ou tente de novo em instantes.";
const TIMEOUT = "O servidor demorou demais para responder. Tente de novo em instantes.";

const translate = (key) => (i18n.exists(`backendErrors.${key}`) ? i18n.t(`backendErrors.${key}`) : null);

// O texto mostrado para um erro: o que a API respondeu, nunca uma
// mensagem genérica.
export const errorMessage = (err) => {
	if (!err) return "Erro inesperado.";
	if (typeof err === "string") return err;
	if (!err.response) {
		if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) return TIMEOUT;
		if (err.isAxiosError || err.request) return NO_ANSWER;
		return err.message || "Erro inesperado.";
	}
	const { status, data } = err.response;
	const errorMsg = data && typeof data === "object" ? data.error : undefined;
	if (errorMsg === "ERR_INTERNAL") {
		const protocol = data.protocol ? ` (protocolo ${data.protocol})` : "";
		return `Erro interno no servidor${protocol}. Se continuar, envie esse protocolo ao suporte.`;
	}
	if (typeof errorMsg === "string" && errorMsg) {
		const known = translate(errorMsg);
		if (known) return known;
		// "ERR_CODE: detalhe" carries a readable detail after the code.
		const [, code, detail] = errorMsg.match(/^(ERR_[A-Z0-9_]+):\s*([\s\S]+)$/) || [];
		const knownCode = code && translate(code);
		if (knownCode) return `${knownCode} ${detail}`;
		if (/^[A-Z][A-Z0-9_]{2,}$/.test(errorMsg)) return `Erro: ${errorMsg} (status ${status}).`;
		return errorMsg;
	}
	return `Erro inesperado (status ${status}).`;
};

const toastError = (err) => {
	const message = errorMessage(err);
	toast.error(message, { ...toastConfig, toastId: message });
	if (err && !err.response && (err.isAxiosError || err.request)) {
		reportClientError({ kind: "network", message: `${message} (${err.config?.method || ""} ${err.config?.url || ""})`.trim() });
	}
};

export default toastError;
```

- [ ] **Step 6: Acrescentar as traduções** — no bloco `backendErrors` de `pt.js`, acrescentar (antes de ler o texto de cada código, confira com `grep -rn "CODIGO" whatsapp-api/src` onde ele é lançado e ajuste a frase se o sentido for outro):

```js
      CONTACT_NOT_FIND: "Contato não encontrado.",
      MESSAGE_NOT_FIND: "Mensagem não encontrada.",
      ERR_INTERNAL: "Erro interno no servidor.",
      ERR_AI_KEY_UNREADABLE: "Não consegui ler a chave de API do agente. Informe a chave de novo na seção Básico e salve.",
      ERR_CANNOT_DELETE_COMPANY_SUPER: "A empresa principal da plataforma não pode ser excluída.",
      ERR_FLOW_INVALID_GRAPH: "O fluxo tem ligações inválidas. Revise as conexões entre os blocos.",
      ERR_FLOW_INVALID_NODE: "O fluxo tem um bloco inválido. Revise os blocos e salve de novo.",
      ERR_FLOW_NOT_FOUND: "Fluxo não encontrado.",
      ERR_INVALID_DATE: "Data inválida.",
      ERR_NO_BAILEYS_DATA_FOUND: "Dados da sessão do WhatsApp não encontrados. Leia o QR Code de novo.",
      ERR_NO_CAMPAIGN_FOUND: "Campanha não encontrada.",
      ERR_NO_COMPANY_FOUND: "Empresa não encontrada.",
      ERR_NO_CONTACTLISTITEM_FOUND: "Contato da lista não encontrado.",
      ERR_NO_CONTACTLISTITEM_SELECTED: "Selecione ao menos um contato da lista.",
      ERR_NO_CONTACTLIST_FOUND: "Lista de contatos não encontrada.",
      ERR_NO_DIALOG_FOUND: "Integração não encontrada.",
      ERR_NO_MESSAGE_FOUND: "Mensagem não encontrada.",
      ERR_NO_PLAN_FOUND: "Plano não encontrado.",
      ERR_NO_QUICKMESSAGE_FOUND: "Resposta rápida não encontrada.",
      ERR_NO_SCHEDULE_FOUND: "Agendamento não encontrado.",
      ERR_NO_TAG_FOUND: "Tag não encontrada.",
      ERR_NO_TICKETNOTE_FOUND: "Nota do atendimento não encontrada.",
      ERR_QUEUE_NOT_FOUND: "Setor não encontrado.",
      ERR_TICKET_NOT_GROUP: "Este atendimento não é de um grupo.",
      ERR_TOO_MANY_CONTACTLISTITEMS: "A lista passou do limite de contatos permitido.",
      ERR_WAPP_NUMBER_IN_USE: "Este número já está conectado em outra conexão desta empresa.",
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false` → PASS (inclui `toastError.test.js`).
Run: `cd whatsapp-api && npx jest src/__tests__/errorTranslations.spec.ts` → PASS (`missing` vazio). Se aparecer código que não estava na lista, acrescente a tradução — não ajuste o teste.

- [ ] **Step 8: Commit (dois repos)**

```bash
cd whatsapp-app && git add src/errors/toastError.js src/errors/toastError.test.js src/utils/clientLog.js src/translate/languages/pt.js && git commit -m "Mensagens de erro reais no lugar da genérica"
cd ../whatsapp-api && git add src/__tests__/errorTranslations.spec.ts && git commit -m "Teste: todo código de erro tem texto no painel"
```

---

### Task 9: Pontos que fogem do `toastError`

**Files:**
- Modify: `whatsapp-app/src/components/CampaignModal/index.js:362,373`
- Modify: `whatsapp-app/src/components/CompaniesManager/index.js:442`
- Modify: `whatsapp-app/src/components/ContactNotes/index.js:85,103,114`
- Modify: `whatsapp-app/src/components/ContactNotesDialog/index.js:97,115,126`
- Modify: `whatsapp-app/src/pages/Campaigns/index.js` (2 pontos)
- Modify: `whatsapp-app/src/pages/SettingsCustom/index.js:90` e o de `handleSubmitSchedules`

- [ ] **Step 1: Localizar**

Run: `cd whatsapp-app && grep -rnE "toast\.error\((e|err|error)(\.message)?\)" src`
Expected: 13 linhas nos 6 arquivos acima.

- [ ] **Step 2: Trocar cada uma** por `toastError(<mesma variável>)` (ex.: `toast.error(err.message);` → `toastError(err);`, `toast.error(e)` → `toastError(e)`), acrescentando `import toastError from "../../errors/toastError";` onde faltar (caminho relativo de cada arquivo). Se `toast` deixar de ser usado no arquivo, remova o import.

- [ ] **Step 3: Conferir**

Run: `grep -rnE "toast\.error\((e|err|error)(\.message)?\)" src | wc -l` → `0`.
Run: `CI=true npx react-scripts test --watchAll=false` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/CampaignModal/index.js src/components/CompaniesManager/index.js src/components/ContactNotes/index.js src/components/ContactNotesDialog/index.js src/pages/Campaigns/index.js src/pages/SettingsCustom/index.js
git commit -m "Erros de campanhas, notas, empresas e configurações pelo toastError"
```

---

### Task 10: Tela quebrada vira cartão com protocolo

**Files:**
- Create: `whatsapp-app/src/components/ErrorBoundary/index.js`
- Modify: `whatsapp-app/src/layout/index.js` (linha ~703 `{children ? children : null}` e um `useEffect`)
- Test: `whatsapp-app/src/components/ErrorBoundary/ErrorBoundary.test.js`

**Interfaces:**
- Consumes: `reportClientError` (Task 8).
- Produces: `<ErrorBoundary resetKey={string}>{children}</ErrorBoundary>`.

- [ ] **Step 1: Escrever o teste**

```js
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import ErrorBoundary from "./index";

jest.mock("../../utils/clientLog", () => ({ reportClientError: jest.fn(() => Promise.resolve("K7Q2M9")) }));
const { reportClientError } = require("../../utils/clientLog");

const Boom = () => {
	throw new Error("schedule.contact is undefined");
};

it("shows the protocol instead of a blank page", async () => {
	jest.spyOn(console, "error").mockImplementation(() => undefined);
	render(
		<ErrorBoundary resetKey="/schedules">
			<Boom />
		</ErrorBoundary>
	);
	expect(screen.getByText("Algo deu errado nesta tela")).toBeTruthy();
	await waitFor(() => expect(screen.getByText(/K7Q2M9/)).toBeTruthy());
	expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({ kind: "render", message: "schedule.contact is undefined" }));
	console.error.mockRestore();
});

it("renders children when nothing breaks", () => {
	render(<ErrorBoundary resetKey="/a"><p>ok</p></ErrorBoundary>);
	expect(screen.getByText("ok")).toBeTruthy();
});
```

(`@testing-library/react` 11 já está no `package.json`; o projeto não tem `setupTests.js`, por isso os testes usam `toBeTruthy()` em vez de `toBeInTheDocument()`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `CI=true npx react-scripts test --watchAll=false src/components/ErrorBoundary`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Escrever o componente**

```js
import React from "react";
import { Button } from "@material-ui/core";
import { reportClientError } from "../../utils/clientLog";

// Uma tela que quebra mostra este cartão (com o protocolo do log) em vez
// da página em branco. Trocar de página (resetKey) tenta de novo.
class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null, protocol: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error, info) {
		reportClientError({
			kind: "render",
			message: error?.message || String(error),
			detail: `${error?.stack || ""}\n${info?.componentStack || ""}`,
		}).then((protocol) => this.setState({ protocol }));
	}

	componentDidUpdate(prev) {
		if (prev.resetKey !== this.props.resetKey && this.state.error) {
			this.setState({ error: null, protocol: null });
		}
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			<div style={{ margin: 32, padding: 24, borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "var(--surface, #fff)", maxWidth: 560 }}>
				<h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Algo deu errado nesta tela</h2>
				<p style={{ margin: "0 0 4px", fontSize: 14 }}>{this.state.error.message}</p>
				<p style={{ margin: "0 0 16px", fontSize: 13, opacity: 0.7 }}>
					{this.state.protocol ? `Protocolo ${this.state.protocol} — envie ao suporte se continuar.` : "Registrando o erro…"}
				</p>
				<Button variant="contained" color="primary" onClick={() => window.location.reload()} style={{ marginRight: 8 }}>
					Recarregar
				</Button>
				<Button variant="outlined" onClick={() => (window.location.href = "/tickets")}>
					Voltar ao início
				</Button>
			</div>
		);
	}
}

export default ErrorBoundary;
```

- [ ] **Step 4: Ligar no layout** — em `layout/index.js`:
  - `import ErrorBoundary from "../components/ErrorBoundary";` e `import { reportClientError } from "../utils/clientLog";`
  - `const location = useLocation();` (já há `useLocation` importado; se já existir uma variável `location`/`pathname`, reutilize).
  - Trocar `{children ? children : null}` por `<ErrorBoundary resetKey={location.pathname}>{children ? children : null}</ErrorBoundary>`.
  - Acrescentar dentro de `LoggedInLayout`:

```js
	// Erros soltos do navegador (fora da renderização) vão para os logs.
	useEffect(() => {
		const onError = (event) =>
			reportClientError({ kind: "runtime", message: event.message, detail: event.error?.stack });
		const onRejection = (event) =>
			reportClientError({ kind: "runtime", message: event.reason?.message || String(event.reason), detail: event.reason?.stack });
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		return () => {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}, []);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ErrorBoundary src/layout/index.js
git commit -m "Tela quebrada mostra protocolo e vai para os logs"
```

---

### Task 11: Página "Logs do sistema"

**Files:**
- Create: `whatsapp-app/src/components/SystemLogs/format.js`
- Create: `whatsapp-app/src/components/SystemLogs/index.js`
- Modify: `whatsapp-app/src/pages/SettingsCustom/index.js` (`SECTIONS`, `SUPER_ONLY`, `renderSection`)
- Modify: `whatsapp-app/src/layout/MainListItems.js:458-463` (item no submenu)
- Test: `whatsapp-app/src/components/SystemLogs/format.test.js`

**Interfaces:**
- Consumes: `GET /system-logs`, `GET /system-logs/summary`, `GET /companies/list` (Task 6 e existente).
- Produces: `buildParams(filters, page) → object`, `periodStart(period, now) → ISO string`, `durationText(ms) → string`, `LEVEL_LABEL`, `SOURCE_LABEL` (de `format.js`).

- [ ] **Step 1: Escrever o teste de `format.js`**

```js
import { buildParams, periodStart, durationText } from "./format";

const NOW = new Date("2026-10-08T12:00:00Z");

it("turns the period into a start date", () => {
	expect(periodStart("1h", NOW)).toBe("2026-10-08T11:00:00.000Z");
	expect(periodStart("24h", NOW)).toBe("2026-10-07T12:00:00.000Z");
	expect(periodStart("7d", NOW)).toBe("2026-10-01T12:00:00.000Z");
	expect(periodStart("30d", NOW)).toBe("2026-09-08T12:00:00.000Z");
});

it("only sends filled filters", () => {
	expect(buildParams({ period: "1h", level: "", source: "api", companyId: "", status: "500", search: " K7Q " }, 2, NOW)).toEqual({
		from: "2026-10-08T11:00:00.000Z",
		source: "api",
		status: "500",
		search: "K7Q",
		pageNumber: 2,
	});
});

it("formats durations", () => {
	expect(durationText(null)).toBe("—");
	expect(durationText(84)).toBe("84 ms");
	expect(durationText(2304)).toBe("2,3 s");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `CI=true npx react-scripts test --watchAll=false src/components/SystemLogs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Escrever `format.js`**

```js
export const LEVEL_LABEL = { info: "Info", warn: "Aviso", error: "Erro" };
export const SOURCE_LABEL = { api: "API", job: "Segundo plano", web: "Navegador" };
export const PERIODS = [
	{ value: "1h", label: "Última hora", ms: 3600e3 },
	{ value: "24h", label: "Últimas 24 h", ms: 24 * 3600e3 },
	{ value: "7d", label: "Últimos 7 dias", ms: 7 * 24 * 3600e3 },
	{ value: "30d", label: "Últimos 30 dias", ms: 30 * 24 * 3600e3 },
];

export const periodStart = (period, now = new Date()) => {
	const found = PERIODS.find((p) => p.value === period) || PERIODS[0];
	return new Date(now.getTime() - found.ms).toISOString();
};

export const buildParams = (filters, page, now = new Date()) => {
	const params = { from: periodStart(filters.period, now) };
	["level", "source", "companyId", "status"].forEach((key) => {
		if (filters[key] !== "" && filters[key] !== undefined && filters[key] !== null) params[key] = filters[key];
	});
	const search = (filters.search || "").trim();
	if (search) params.search = search;
	params.pageNumber = page;
	return params;
};

export const durationText = (ms) => {
	if (ms === null || ms === undefined) return "—";
	if (ms < 1000) return `${ms} ms`;
	return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
};
```

- [ ] **Step 4: Escrever `SystemLogs/index.js`**

```js
import React, { useCallback, useEffect, useRef, useState } from "react";
import moment from "moment";
import clsx from "clsx";
import { makeStyles } from "@material-ui/core/styles";
import {
	Button,
	Chip,
	Drawer,
	FormControlLabel,
	IconButton,
	MenuItem,
	Switch,
	TextField,
	Tooltip,
} from "@material-ui/core";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { CopyIcon, XIcon } from "../../layout/icons";
import { LEVEL_LABEL, PERIODS, SOURCE_LABEL, buildParams, durationText } from "./format";

const useStyles = makeStyles((theme) => {
	const t = theme.tokens;
	return {
		root: { display: "flex", flexDirection: "column", gap: theme.spacing(2), minHeight: 0 },
		card: { backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: theme.radii.panel, padding: theme.spacing(2, 2.5) },
		title: { margin: 0, fontSize: 18, fontWeight: 700, color: t.textPrimary },
		hint: { margin: "2px 0 0", fontSize: 13, color: t.textTertiary },
		counters: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, [theme.breakpoints.down("sm")]: { gridTemplateColumns: "repeat(2, 1fr)" } },
		counter: { "& strong": { display: "block", fontSize: 22, fontWeight: 700, color: t.textPrimary }, "& span": { fontSize: 12.5, color: t.textTertiary } },
		filters: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" },
		field: { minWidth: 150 },
		search: { flex: 1, minWidth: 220 },
		table: { width: "100%", borderCollapse: "collapse", fontSize: 13, "& th": { textAlign: "left", fontWeight: 600, color: t.textSecondary, padding: "8px 10px", borderBottom: `1px solid ${t.border}`, whiteSpace: "nowrap" }, "& td": { padding: "8px 10px", borderBottom: `1px solid ${t.divider || t.border}`, verticalAlign: "top" } },
		row: { cursor: "pointer", "&:hover": { backgroundColor: t.surfaceMuted } },
		mono: { fontFamily: "monospace", fontSize: 12 },
		message: { maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
		chip: { height: 22, fontSize: 11.5, fontWeight: 700 },
		info: { backgroundColor: t.neutralTag, color: t.textNav },
		warn: { backgroundColor: "#fff4e5", color: "#8a5300" },
		error: { backgroundColor: theme.palette.error.main, color: "#fff" },
		empty: { padding: 24, textAlign: "center", color: t.textTertiary },
		drawer: { width: 560, maxWidth: "100vw", padding: theme.spacing(2.5), display: "flex", flexDirection: "column", gap: 12 },
		drawerHead: { display: "flex", alignItems: "center", gap: 8, "& h3": { margin: 0, fontSize: 16, flex: 1 } },
		kv: { display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", fontSize: 13, "& dt": { color: t.textTertiary }, "& dd": { margin: 0, wordBreak: "break-word" } },
		pre: { margin: 0, padding: 12, borderRadius: 8, backgroundColor: t.surfaceMuted, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflow: "auto" },
	};
});

const emptyFilters = { period: "1h", level: "", source: "", companyId: "", status: "", search: "" };

const SystemLogs = () => {
	const classes = useStyles();
	const [filters, setFilters] = useState(emptyFilters);
	const [logs, setLogs] = useState([]);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [summary, setSummary] = useState(null);
	const [companies, setCompanies] = useState([]);
	const [auto, setAuto] = useState(false);
	const [selected, setSelected] = useState(null);
	const searchTimer = useRef(null);
	const [search, setSearch] = useState("");

	useEffect(() => {
		api.get("/companies/list").then(({ data }) => setCompanies(data || [])).catch(toastError);
	}, []);

	const load = useCallback(
		async (nextPage = 1) => {
			setLoading(true);
			try {
				const [{ data }, { data: totals }] = await Promise.all([
					api.get("/system-logs", { params: buildParams(filters, nextPage) }),
					nextPage === 1 ? api.get("/system-logs/summary") : Promise.resolve({ data: null }),
				]);
				setLogs((prev) => (nextPage === 1 ? data.logs : [...prev, ...data.logs]));
				setHasMore(data.hasMore);
				setPage(nextPage);
				if (totals) setSummary(totals);
			} catch (err) {
				toastError(err);
			}
			setLoading(false);
		},
		[filters]
	);

	useEffect(() => {
		load(1);
	}, [load]);

	useEffect(() => {
		if (!auto) return undefined;
		const id = setInterval(() => load(1), 10000);
		return () => clearInterval(id);
	}, [auto, load]);

	const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

	const onSearch = (e) => {
		const value = e.target.value;
		setSearch(value);
		clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => setFilters((prev) => ({ ...prev, search: value })), 400);
	};

	const copy = (log) => {
		navigator.clipboard?.writeText(JSON.stringify(log, null, 2));
	};

	const counters = [
		{ label: "Erros (24 h)", value: summary?.errors },
		{ label: "Avisos (24 h)", value: summary?.warnings },
		{ label: "Requisições (24 h)", value: summary?.requests },
		{ label: "Tempo médio", value: summary ? durationText(summary.avgMs) : undefined },
	];

	return (
		<div className={classes.root}>
			<div className={classes.card}>
				<h2 className={classes.title}>Logs do sistema</h2>
				<p className={classes.hint}>Requisições, erros da API, de segundo plano e do navegador de todas as empresas. Erros ficam 30 dias; requisições, 7.</p>
			</div>

			<div className={clsx(classes.card, classes.counters)}>
				{counters.map((c) => (
					<div key={c.label} className={classes.counter}>
						<strong>{c.value === undefined || c.value === null ? "—" : c.value}</strong>
						<span>{c.label}</span>
					</div>
				))}
			</div>

			<div className={clsx(classes.card, classes.filters)}>
				<TextField select size="small" variant="outlined" label="Período" value={filters.period} onChange={setFilter("period")} className={classes.field}>
					{PERIODS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
				</TextField>
				<TextField select size="small" variant="outlined" label="Nível" value={filters.level} onChange={setFilter("level")} className={classes.field}>
					<MenuItem value="">Todos</MenuItem>
					{Object.entries(LEVEL_LABEL).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
				</TextField>
				<TextField select size="small" variant="outlined" label="Origem" value={filters.source} onChange={setFilter("source")} className={classes.field}>
					<MenuItem value="">Todas</MenuItem>
					{Object.entries(SOURCE_LABEL).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
				</TextField>
				<TextField select size="small" variant="outlined" label="Empresa" value={filters.companyId} onChange={setFilter("companyId")} className={classes.field}>
					<MenuItem value="">Todas</MenuItem>
					{companies.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
				</TextField>
				<TextField size="small" variant="outlined" label="Status" value={filters.status} onChange={setFilter("status")} className={classes.field} placeholder="ex.: 500" />
				<TextField size="small" variant="outlined" label="Buscar" value={search} onChange={onSearch} className={classes.search} placeholder="Protocolo, código, rota ou mensagem" />
				<FormControlLabel control={<Switch color="primary" checked={auto} onChange={(e) => setAuto(e.target.checked)} />} label="Atualizar a cada 10 s" />
				<Button variant="outlined" onClick={() => load(1)} disabled={loading}>Atualizar</Button>
			</div>

			<div className={classes.card} style={{ overflowX: "auto" }}>
				<table className={classes.table}>
					<thead>
						<tr>
							<th>Hora</th><th>Nível</th><th>Origem</th><th>Empresa</th><th>Usuário</th><th>Rota</th><th>Status</th><th>Tempo</th><th>Mensagem</th>
						</tr>
					</thead>
					<tbody>
						{logs.map((log) => (
							<tr key={log.id} className={classes.row} onClick={() => setSelected(log)}>
								<td className={classes.mono}>{moment(log.createdAt).format("DD/MM HH:mm:ss")}</td>
								<td><Chip label={LEVEL_LABEL[log.level] || log.level} className={clsx(classes.chip, classes[log.level])} /></td>
								<td>{SOURCE_LABEL[log.source] || log.source}</td>
								<td>{log.companyName || (log.companyId ? `#${log.companyId}` : "—")}</td>
								<td>{log.userName || (log.userId ? `#${log.userId}` : "—")}</td>
								<td className={classes.mono}>{log.method ? `${log.method} ` : ""}{log.route || "—"}</td>
								<td>{log.status || "—"}</td>
								<td>{durationText(log.durationMs)}</td>
								<td className={classes.message} title={log.message}>{log.protocol ? `[${log.protocol}] ` : ""}{log.message}</td>
							</tr>
						))}
					</tbody>
				</table>
				{!logs.length && !loading && <div className={classes.empty}>Nenhum registro nesse período.</div>}
				{hasMore && (
					<div style={{ textAlign: "center", marginTop: 12 }}>
						<Button variant="outlined" onClick={() => load(page + 1)} disabled={loading}>Carregar mais</Button>
					</div>
				)}
			</div>

			<Drawer anchor="right" open={Boolean(selected)} onClose={() => setSelected(null)}>
				{selected && (
					<div className={classes.drawer}>
						<div className={classes.drawerHead}>
							<Chip label={LEVEL_LABEL[selected.level]} className={clsx(classes.chip, classes[selected.level])} />
							<h3>{selected.protocol ? `Protocolo ${selected.protocol}` : `Registro #${selected.id}`}</h3>
							<Tooltip title="Copiar"><IconButton size="small" onClick={() => copy(selected)}><CopyIcon /></IconButton></Tooltip>
							<IconButton size="small" onClick={() => setSelected(null)} aria-label="Fechar"><XIcon /></IconButton>
						</div>
						<dl className={classes.kv}>
							<dt>Quando</dt><dd>{moment(selected.createdAt).format("DD/MM/YYYY HH:mm:ss")}</dd>
							<dt>Origem</dt><dd>{SOURCE_LABEL[selected.source]}</dd>
							<dt>Empresa</dt><dd>{selected.companyName || selected.companyId || "—"}</dd>
							<dt>Usuário</dt><dd>{selected.userName || selected.userId || "—"}</dd>
							<dt>Rota</dt><dd>{selected.method} {selected.route || "—"}</dd>
							<dt>Status</dt><dd>{selected.status || "—"}</dd>
							<dt>Tempo</dt><dd>{durationText(selected.durationMs)}</dd>
							<dt>Código</dt><dd>{selected.code || "—"}</dd>
							<dt>Mensagem</dt><dd>{selected.message}</dd>
						</dl>
						{selected.detail && <pre className={classes.pre}>{selected.detail}</pre>}
						{selected.context && <pre className={classes.pre}>{JSON.stringify(selected.context, null, 2)}</pre>}
					</div>
				)}
			</Drawer>
		</div>
	);
};

export default SystemLogs;
```

- [ ] **Step 5: Ligar em Configurações**

`pages/SettingsCustom/index.js`:
- `import SystemLogs from "../../components/SystemLogs";`
- `SECTIONS`: acrescentar `logs: "logs",`
- `SUPER_ONLY`: `["companies", "plans", "logs"]`
- `renderSection`: `case "logs": return <SystemLogs />;`
- O `useEffect` que carrega empresa/horários não precisa rodar para `logs`: trocar `if (!section) return;` por `if (!section || section === "logs") return;`
- Atualizar o comentário do topo: `/settings, /settings/empresas, /settings/planos, /settings/logs`.

`layout/MainListItems.js`, dentro do bloco `{user.super && (<> ... </>)}` do submenu Configurações, depois de Planos:

```js
                    <NavItem sub to="/settings/logs" primary="Logs do sistema" icon={<ListIcon />} />
```

(`ListIcon` já existe em `layout/icons.js`; acrescentar ao import de ícones do arquivo se faltar.)

- [ ] **Step 6: Rodar testes**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/SystemLogs src/pages/SettingsCustom/index.js src/layout/MainListItems.js
git commit -m "Página Logs do sistema em Configurações (super admin)"
```

---

### Task 12: Verificação ponta a ponta no HM

**Files:** nenhum (só verificação). Corrigir na task de origem o que falhar.

- [ ] **Step 1: Publicar no HM** — `cd whatsapp-api && npx tsc -p . && npx sequelize db:migrate`; reiniciar o preview "backend" (conferir com `ps aux | grep "dist/server"` que não ficou processo órfão); o preview "frontend" recompila sozinho.

- [ ] **Step 2: Requisições** — navegar pelo painel do HM por 1 minuto; abrir Configurações → Logs do sistema; ver linhas `info` com rota, status e tempo; contadores preenchidos.

- [ ] **Step 3: Erro 4xx** — abrir um agendamento inexistente: `curl -s -H "Authorization: Bearer <token do HM do localStorage>" localhost:3001/schedules/999999` → `{"error":"ERR_NO_SCHEDULE_FOUND"}`; no painel o toast mostra "Agendamento não encontrado."; na página, um `warn` com o código e protocolo.

- [ ] **Step 4: Erro 500 e chave ilegível** — `curl -s -H "Authorization: Bearer <token do HM>" localhost:3001/schedules/abc` (id não numérico quebra no Postgres) → `{"error":"ERR_INTERNAL","protocol":"XXXXXX"}`; buscar esse protocolo na página e ver a pilha no detalhe. Depois, num agente de teste do HM, anotar `apiKeyEncrypted`, trocar por `'v1:aaaa:bbbb:cccc'`, clicar em "Testar agente" e ver "Não consegui ler a chave de API do agente..."; restaurar o valor anotado.

- [ ] **Step 5: Tela quebrada** — no console do navegador do HM, `window.dispatchEvent(new ErrorEvent("error", { message: "teste de log do navegador" }))`; o registro `web` aparece na página.

- [ ] **Step 6: Segundo plano** — parar o Redis por 5 s (`docker stop whatsapp-api-redis-1 && sleep 5 && docker start whatsapp-api-redis-1`) e ver os erros `job` na página; conferir que a API segue respondendo.

- [ ] **Step 7: Mascaramento** — fazer login com senha errada no HM; abrir o registro do `POST /auth/login` e conferir `password: "***"` no contexto.

- [ ] **Step 8: Relatar ao usuário e pedir autorização para publicar** (push na `main` dos dois repos = produção; a migration roda no deploy da API). Depois do deploy, conferir que a API reiniciou (se o webhook não subir, chamar de novo a URL de deploy do EasyPanel) e abrir a página em produção.
