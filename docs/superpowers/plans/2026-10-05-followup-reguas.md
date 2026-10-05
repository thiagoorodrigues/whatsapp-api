# Réguas de follow-up — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réguas de follow-up por empresa (etapas com espera + texto fixo ou IA) que disparam quando o cliente para de responder, param quando ele responde e executam ações finais.

**Architecture:** Três tabelas novas (`FollowUpRules`, `FollowUpSteps`, `FollowUpEnrollments`) e a coluna `Messages.followUpEnrollmentId`. Ganchos explícitos (mensagem do atendente, da IA, do celular, do cliente, mudança no ticket) criam/reiniciam/param inscrições; um job Bull a cada 30s envia as etapas vencidas pela `SendTicketMessageService`. Tela `/followups` no `whatsapp-app` e selo na conversa.

**Tech Stack:** Node 24 + TypeScript, Express, sequelize-typescript (Postgres 18), Bull (Redis), jest + ts-jest (`whatsapp-api`); React 16 + Material-UI v4, react-scripts 3 / jest (`whatsapp-app`).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-05-followup-reguas-design.md` (inclui a seção "Ajustes pós-leitura do código", que prevalece sobre o texto anterior).

## Global Constraints

- Repositórios: `whatsapp-api` (branch `feat/followup-reguas`, já criada) e `whatsapp-app` (criar branch `feat/followup-reguas` na Task 9). **Nunca dar push na `main`** — push na `main` = deploy automático em produção.
- Toda consulta e validação filtrada por `companyId` do usuário logado (inclusive `whatsappId`, `queueId`, `tagId`, `aiAgentId`, `ticketId`).
- Rotas de régua: `isAuth` + `isAdmin`. Rotas de ticket: `isAuth` + ticket da empresa.
- Socket: emitir só em salas da empresa (`companyRoom`), nunca `io.emit`. Evento: `company-{companyId}-followup`.
- Ganchos de follow-up nunca derrubam o fluxo principal: erros são capturados, logados (`logger` + `Sentry`) e engolidos.
- Textos da interface em português; visual com `theme.tokens` existentes.
- Comentários e nomes no estilo do código vizinho (comentários em inglês curtos explicando o porquê, como no restante de `services/`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes da API: `cd whatsapp-api && NODE_ENV=test npx jest <caminho>`; do app: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false <caminho>`.

## Review Focus

1. **Mensagem automática no meio da régua** (aviso de transferência, avaliação, fora de horário) — não pode iniciar nem reiniciar a régua; coberto na Task 8 (testes do `MessageController`/inbound só chamam o gancho nos caminhos certos) e na Task 5 (`onCustomerMessage` não é chamado para `fromMe`).
2. **Dois processos/ticks pegando a mesma inscrição** — envio duplicado ao cliente; Task 7 testa que o lote "reivindica" as inscrições (avança `nextRunAt`) dentro da transação com `SKIP LOCKED`.
3. **Ticket fechado por caminho que não passa no `UpdateTicketService`** (avaliação, fechamento automático) — Task 7 testa a revalidação (`stale`) antes de enviar.
4. **Régua editada com conversas em andamento** (etapa removida) — Task 7 testa conclusão com `rule_changed` sem envio.
5. **`mediaPath` adulterado** apontando para fora da pasta da empresa — Task 6 testa que a mídia é ignorada se não começar com `company{companyId}/`.

---

## File Structure

`whatsapp-api/src/`
- `database/migrations/20261005120000-create-followups.ts` — tabelas, índices, coluna em `Messages`.
- `models/FollowUpRule.ts`, `models/FollowUpStep.ts`, `models/FollowUpEnrollment.ts` — modelos; `models/Message.ts` ganha `followUpEnrollmentId`; `database/index.ts` registra.
- `services/FollowUpServices/businessHours.ts` — `nextBusinessSlot` (pura) e `getSchedulesForTicket`.
- `services/FollowUpServices/resolveRule.ts` — `pickRule` (pura) e `ResolveFollowUpRule`.
- `services/FollowUpServices/FollowUpRuleService.ts` — CRUD, validação, estatísticas.
- `services/FollowUpServices/EnrollmentService.ts` — iniciar/reiniciar/parar inscrições, consulta por ticket, emissão de socket.
- `services/FollowUpServices/buildStepMessage.ts` — monta o conteúdo da etapa (texto/mídia/IA).
- `services/FollowUpServices/FollowUpMonitor.ts` — `processDueFollowUps` (job).
- `services/FollowUpServices/hooks.ts` — wrappers seguros chamados pelo resto do sistema.
- `controllers/FollowUpController.ts`, `routes/followUpRoutes.ts`.
- Modificados: `services/MessageServices/CreateMessageService.ts`, `SaveSentMessageService.ts`, `SendTicketMessageService.ts`, `controllers/MessageController.ts`, `services/InboundServices/ProcessInboundMessage.ts`, `services/TicketServices/UpdateTicketService.ts`, `queues.ts`, `routes/index.ts`.

`whatsapp-app/src/`
- `pages/FollowUps/followUpHelpers.js` (+ `.test.js`) — conversões de tempo, rótulos, validação.
- `pages/FollowUps/index.js` — lista de réguas.
- `pages/FollowUps/RuleEditor.js` — diálogo de edição.
- `components/TicketFollowUp/index.js`, `components/TicketFollowUp/followUpLabel.js` (+ `.test.js`) — selo na conversa.
- Modificados: `routes/index.js`, `layout/MainListItems.js`, `components/Ticket/index.js`, `components/MessagesList/index.js`.

---

### Task 1: Migration e modelos

**Files:**
- Create: `whatsapp-api/src/database/migrations/20261005120000-create-followups.ts`
- Create: `whatsapp-api/src/models/FollowUpRule.ts`, `FollowUpStep.ts`, `FollowUpEnrollment.ts`
- Modify: `whatsapp-api/src/models/Message.ts` (após `mentions`), `whatsapp-api/src/database/index.ts` (imports + array `models`)

**Interfaces:**
- Produces: modelos `FollowUpRule` (com `steps: FollowUpStep[]`, alias `"steps"`), `FollowUpStep`, `FollowUpEnrollment`; tipos `FollowUpFinalActions`, `EnrollmentStatus`; `Message.followUpEnrollmentId: number | null`.

- [ ] **Step 1: Escrever a migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Réguas de follow-up: etapas enviadas quando o cliente para de responder.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("FollowUpRules", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Companies", key: "id" }, onDelete: "CASCADE" },
      name: { type: DataTypes.STRING, allowNull: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      trigger: { type: DataTypes.STRING, allowNull: false, defaultValue: "no_reply" },
      whatsappId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Whatsapps", key: "id" }, onDelete: "SET NULL" },
      queueId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Queues", key: "id" }, onDelete: "SET NULL" },
      respectBusinessHours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      finalActions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      aiAgentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "AiAgents", key: "id" }, onDelete: "SET NULL" },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("FollowUpRules", ["companyId"]);

    await queryInterface.createTable("FollowUpSteps", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      ruleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "FollowUpRules", key: "id" }, onDelete: "CASCADE" },
      order: { type: DataTypes.INTEGER, allowNull: false },
      delayMinutes: { type: DataTypes.INTEGER, allowNull: false },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: "text" },
      body: { type: DataTypes.TEXT, allowNull: false },
      mediaPath: { type: DataTypes.STRING, allowNull: true },
      mediaName: { type: DataTypes.STRING, allowNull: true },
      aiInstruction: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("FollowUpSteps", ["ruleId", "order"]);

    await queryInterface.createTable("FollowUpEnrollments", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Companies", key: "id" }, onDelete: "CASCADE" },
      ruleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "FollowUpRules", key: "id" }, onDelete: "CASCADE" },
      ticketId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Tickets", key: "id" }, onDelete: "CASCADE" },
      contactId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Contacts", key: "id" }, onDelete: "SET NULL" },
      currentStep: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      nextRunAt: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
      stopReason: { type: DataTypes.STRING, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastSentAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.sequelize.query(
      `CREATE INDEX "FollowUpEnrollments_due" ON "FollowUpEnrollments" ("nextRunAt") WHERE status = 'active'`
    );
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "FollowUpEnrollments_one_active_per_ticket" ON "FollowUpEnrollments" ("ticketId") WHERE status = 'active'`
    );
    await queryInterface.addIndex("FollowUpEnrollments", ["ruleId", "status"]);

    await queryInterface.addColumn("Messages", "followUpEnrollmentId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "FollowUpEnrollments", key: "id" },
      onDelete: "SET NULL"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "followUpEnrollmentId");
    await queryInterface.dropTable("FollowUpEnrollments");
    await queryInterface.dropTable("FollowUpSteps");
    await queryInterface.dropTable("FollowUpRules");
  }
};
```

- [ ] **Step 2: Escrever os modelos**

`models/FollowUpRule.ts`:
```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, HasMany, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Whatsapp from "./Whatsapp";
import Queue from "./Queue";
import AiAgent from "./AiAgent";
import FollowUpStep from "./FollowUpStep";

export interface FollowUpFinalActions {
  closeTicket?: boolean;
  tagId?: number | null;
}

// A sequence of messages sent while the customer does not answer.
@Table({ tableName: "FollowUpRules" })
class FollowUpRule extends Model<FollowUpRule> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column
  name: string;

  @Default(true)
  @Column
  active: boolean;

  @Default("no_reply")
  @Column
  trigger: string;

  @ForeignKey(() => Whatsapp)
  @Column(DataType.INTEGER)
  whatsappId: number | null;

  @ForeignKey(() => Queue)
  @Column(DataType.INTEGER)
  queueId: number | null;

  @Default(true)
  @Column
  respectBusinessHours: boolean;

  @Default({})
  @Column(DataType.JSONB)
  finalActions: FollowUpFinalActions;

  @ForeignKey(() => AiAgent)
  @Column(DataType.INTEGER)
  aiAgentId: number | null;

  @BelongsTo(() => AiAgent)
  aiAgent: AiAgent;

  @HasMany(() => FollowUpStep, { foreignKey: "ruleId", as: "steps", onDelete: "CASCADE" })
  steps: FollowUpStep[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpRule;
```

`models/FollowUpStep.ts`:
```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, DataType
} from "sequelize-typescript";
import FollowUpRule from "./FollowUpRule";

export type FollowUpStepMode = "text" | "ai";

@Table({ tableName: "FollowUpSteps" })
class FollowUpStep extends Model<FollowUpStep> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => FollowUpRule)
  @Column
  ruleId: number;

  @Column
  order: number;

  // Wait after the previous send (step 1: after our last message).
  @Column
  delayMinutes: number;

  @Default("text")
  @Column(DataType.STRING)
  mode: FollowUpStepMode;

  // Fixed text; in AI mode it is what goes out when the AI fails.
  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  mediaPath: string | null;

  @Column(DataType.STRING)
  mediaName: string | null;

  @Column(DataType.TEXT)
  aiInstruction: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpStep;
```

`models/FollowUpEnrollment.ts`:
```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Ticket from "./Ticket";
import FollowUpRule from "./FollowUpRule";

export type EnrollmentStatus = "active" | "completed" | "replied" | "cancelled" | "failed";

// Where one ticket is in a rule. At most one active row per ticket.
@Table({ tableName: "FollowUpEnrollments" })
class FollowUpEnrollment extends Model<FollowUpEnrollment> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => FollowUpRule)
  @Column
  ruleId: number;

  @BelongsTo(() => FollowUpRule)
  rule: FollowUpRule;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @ForeignKey(() => Contact)
  @Column(DataType.INTEGER)
  contactId: number | null;

  // Position (1-based) of the next step to send.
  @Default(1)
  @Column
  currentStep: number;

  @Column(DataType.DATE)
  nextRunAt: Date;

  @Default("active")
  @Column(DataType.STRING)
  status: EnrollmentStatus;

  @Column(DataType.STRING)
  stopReason: string | null;

  @Default(0)
  @Column
  attempts: number;

  @Column(DataType.DATE)
  lastSentAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpEnrollment;
```

Em `models/Message.ts`, logo após o campo `mentions`:
```ts
  // Sent by a follow-up rule (see FollowUpServices).
  @Column(DataType.INTEGER)
  followUpEnrollmentId: number | null;
```

Em `database/index.ts`: importar os três modelos e adicioná-los ao final do array `models`, depois de `FunnelRule`:
```ts
import FollowUpRule from "../models/FollowUpRule";
import FollowUpStep from "../models/FollowUpStep";
import FollowUpEnrollment from "../models/FollowUpEnrollment";
// ...
  FunnelRule,
  FollowUpRule,
  FollowUpStep,
  FollowUpEnrollment
];
```

- [ ] **Step 3: Compilar**

Run: `cd whatsapp-api && npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Rodar a migration no banco local de homologação**

Run: `cd whatsapp-api && npx sequelize db:migrate` (no container da API do HM, conforme o fluxo de deploy local: `docker compose exec <api> npx sequelize db:migrate`)
Expected: `20261005120000-create-followups: migrated`. Conferir com `\d "FollowUpEnrollments"` que os dois índices parciais existem. Depois `npx sequelize db:migrate:undo` e `db:migrate` de novo para provar o `down`.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/20261005120000-create-followups.ts src/models/FollowUp*.ts src/models/Message.ts src/database/index.ts
git commit -m "Follow-up: tabelas de réguas, etapas e inscrições"
```

---

### Task 2: Horário de atendimento (`nextBusinessSlot`)

**Files:**
- Create: `whatsapp-api/src/services/FollowUpServices/businessHours.ts`
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/businessHours.spec.ts`

**Interfaces:**
- Produces: `interface WeekSchedule { weekdayEn: string; startTime: string | null; endTime: string | null }`; `nextBusinessSlot(date: Date, schedules: WeekSchedule[]): Date`; `getSchedulesForTicket(ticket: { companyId: number; queueId: number | null }): Promise<WeekSchedule[]>`.

- [ ] **Step 1: Teste que falha**

```ts
jest.mock("../../../models/Setting", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

// eslint-disable-next-line import/first
import Setting from "../../../models/Setting";
// eslint-disable-next-line import/first
import Company from "../../../models/Company";
// eslint-disable-next-line import/first
import Queue from "../../../models/Queue";
// eslint-disable-next-line import/first
import { nextBusinessSlot, getSchedulesForTicket } from "../businessHours";

const day = (weekdayEn: string, startTime = "08:00", endTime = "18:00") => ({ weekdayEn, startTime, endTime });
const weekdays = [
  day("monday"), day("tuesday"), day("wednesday"), day("thursday"), day("friday"),
  day("saturday", "", ""), day("sunday", "", "")
];
// 2026-10-05 is a Monday (local time, as the server runs with TZ set).
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe("nextBusinessSlot", () => {
  it("keeps a time inside business hours", () => {
    expect(nextBusinessSlot(at(5, 10), weekdays)).toEqual(at(5, 10));
  });
  it("treats the closing minute as open", () => {
    expect(nextBusinessSlot(at(5, 18), weekdays)).toEqual(at(5, 18));
  });
  it("moves an early time to the opening", () => {
    expect(nextBusinessSlot(at(5, 7, 30), weekdays)).toEqual(at(5, 8));
  });
  it("moves a time after closing to the next day's opening", () => {
    expect(nextBusinessSlot(at(5, 19), weekdays)).toEqual(at(6, 8));
  });
  it("skips the weekend", () => {
    expect(nextBusinessSlot(at(9, 19), weekdays)).toEqual(at(12, 8));
    expect(nextBusinessSlot(at(10, 12), weekdays)).toEqual(at(12, 8));
  });
  it("does not hold messages when no day is open", () => {
    expect(nextBusinessSlot(at(10, 3), [])).toEqual(at(10, 3));
    expect(nextBusinessSlot(at(10, 3), [day("monday", "", ""), day("sunday", null as any, null as any)])).toEqual(at(10, 3));
  });
});

describe("getSchedulesForTicket", () => {
  beforeEach(() => jest.clearAllMocks());
  it("uses the company hours when scheduleType is company", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "company" });
    (Company.findByPk as jest.Mock).mockResolvedValue({ schedules: weekdays });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toBe(weekdays);
    expect(Setting.findOne).toHaveBeenCalledWith({ where: { companyId: 4, key: "scheduleType" } });
  });
  it("uses the queue hours of this company when scheduleType is queue", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "queue" });
    (Queue.findOne as jest.Mock).mockResolvedValue({ schedules: weekdays });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toBe(weekdays);
    expect(Queue.findOne).toHaveBeenCalledWith({ where: { id: 3, companyId: 4 }, attributes: ["schedules"] });
  });
  it("has no restriction without a queue, a setting, or a known type", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "queue" });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: null })).toEqual([]);
    (Setting.findOne as jest.Mock).mockResolvedValue(null);
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toEqual([]);
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "disabled" });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && TZ=America/Sao_Paulo NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/businessHours.spec.ts`
Expected: FAIL — `Cannot find module '../businessHours'`.

- [ ] **Step 3: Implementar**

```ts
import Company from "../../models/Company";
import Queue from "../../models/Queue";
import Setting from "../../models/Setting";

export interface WeekSchedule {
  weekdayEn: string;
  startTime: string | null;
  endTime: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const isOpen = (s?: WeekSchedule): s is WeekSchedule & { startTime: string; endTime: string } =>
  !!s && !!s.startTime && !!s.endTime;

const atTime = (base: Date, hhmm: string): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
};

/**
 * First moment at or after `date` inside business hours. A day with empty
 * times is closed; with no open day at all there is no restriction (a
 * follow-up is never held forever).
 */
export const nextBusinessSlot = (date: Date, schedules: WeekSchedule[]): Date => {
  const list = Array.isArray(schedules) ? schedules : [];
  if (!list.some(isOpen)) return date;
  for (let offset = 0; offset <= 7; offset += 1) {
    const dayStart = new Date(date);
    dayStart.setDate(dayStart.getDate() + offset);
    const schedule = list.find(s => s.weekdayEn === WEEKDAYS[dayStart.getDay()]);
    if (isOpen(schedule)) {
      const opens = atTime(dayStart, schedule.startTime);
      const closes = atTime(dayStart, schedule.endTime);
      if (offset > 0) return opens;
      if (date < opens) return opens;
      if (date <= closes) return date;
    }
  }
  return date;
};

// Same choice as the out-of-hours message: company or queue hours.
export const getSchedulesForTicket = async (ticket: { companyId: number; queueId: number | null }): Promise<WeekSchedule[]> => {
  const setting = await Setting.findOne({ where: { companyId: ticket.companyId, key: "scheduleType" } });
  if (setting?.value === "company") {
    const company = await Company.findByPk(ticket.companyId, { attributes: ["schedules"] });
    return (company?.schedules as WeekSchedule[]) || [];
  }
  if (setting?.value === "queue" && ticket.queueId) {
    const queue = await Queue.findOne({ where: { id: ticket.queueId, companyId: ticket.companyId }, attributes: ["schedules"] });
    return (queue?.schedules as WeekSchedule[]) || [];
  }
  return [];
};
```

Note: the company test expects `findByPk(4, { attributes: ["schedules"] })`; the assertion above checks only the return value, which is enough.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && TZ=America/Sao_Paulo NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/businessHours.spec.ts`
Expected: PASS (9 testes). Se o `jest.config.js` não fixa `TZ`, adicionar no topo do spec `process.env.TZ = "America/Sao_Paulo";` não funciona depois do carregamento — manter o `TZ=` no comando e registrar no README do teste (comentário no topo do arquivo: `// Run with TZ=America/Sao_Paulo, like the server.`). Conferir: as datas são construídas em hora local, então o teste passa em qualquer TZ sem horário de verão no período; o comando com TZ só garante paridade com produção.

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowUpServices/businessHours.ts src/services/FollowUpServices/__tests__/businessHours.spec.ts
git commit -m "Follow-up: próximo horário de atendimento"
```

---

### Task 3: Escolha da régua para um ticket

**Files:**
- Create: `whatsapp-api/src/services/FollowUpServices/resolveRule.ts`
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/resolveRule.spec.ts`

**Interfaces:**
- Consumes: `FollowUpRule`, `FollowUpStep` (Task 1).
- Produces: `pickRule<T extends { id: number; whatsappId: number | null; queueId: number | null }>(rules: T[], target: { whatsappId: number | null; queueId: number | null }): T | null`; `ResolveFollowUpRule(ticket: { companyId: number; whatsappId: number | null; queueId: number | null }): Promise<FollowUpRule | null>` (com `steps` ordenados; null se não houver régua ou ela não tiver etapas); `STEPS_INCLUDE` (include reutilizável).

- [ ] **Step 1: Teste que falha**

```ts
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import FollowUpRule from "../../../models/FollowUpRule";
// eslint-disable-next-line import/first
import { pickRule, ResolveFollowUpRule } from "../resolveRule";

const r = (id: number, whatsappId: number | null, queueId: number | null, steps = [{ order: 1 }]) =>
  ({ id, whatsappId, queueId, steps }) as any;

describe("pickRule", () => {
  const all = [r(1, null, null), r(2, 7, null), r(3, null, 3), r(4, 7, 3)];
  it("prefers connection + queue, then queue, then connection, then the general rule", () => {
    expect(pickRule(all, { whatsappId: 7, queueId: 3 })?.id).toBe(4);
    expect(pickRule(all.filter(x => x.id !== 4), { whatsappId: 7, queueId: 3 })?.id).toBe(3);
    expect(pickRule([r(1, null, null), r(2, 7, null)], { whatsappId: 7, queueId: 3 })?.id).toBe(2);
    expect(pickRule([r(1, null, null)], { whatsappId: 7, queueId: 3 })?.id).toBe(1);
  });
  it("ignores rules for another connection or queue", () => {
    expect(pickRule([r(5, 8, null), r(6, null, 9)], { whatsappId: 7, queueId: 3 })).toBeNull();
  });
  it("works for a ticket without queue", () => {
    expect(pickRule(all, { whatsappId: 7, queueId: null })?.id).toBe(2);
  });
  it("breaks ties by the oldest rule", () => {
    expect(pickRule([r(9, null, 3), r(8, null, 3)], { whatsappId: 7, queueId: 3 })?.id).toBe(8);
  });
});

describe("ResolveFollowUpRule", () => {
  it("looks only at this company's active no_reply rules and skips rules without steps", async () => {
    (FollowUpRule.findAll as jest.Mock).mockResolvedValue([r(4, 7, 3, []), r(1, null, null)]);
    const rule = await ResolveFollowUpRule({ companyId: 2, whatsappId: 7, queueId: 3 });
    expect(rule?.id).toBe(1);
    const where = (FollowUpRule.findAll as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: 2, active: true, trigger: "no_reply" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/resolveRule.spec.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```ts
import { Op } from "sequelize";
import FollowUpRule from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";

type Scoped = { id: number; whatsappId: number | null; queueId: number | null };
type Target = { whatsappId: number | null; queueId: number | null };

export const STEPS_INCLUDE = { model: FollowUpStep, as: "steps" };
export const STEPS_ORDER: any = [[{ model: FollowUpStep, as: "steps" }, "order", "ASC"]];

// 4: connection and queue, 3: queue, 2: connection, 1: any; 0: not this ticket.
const score = (rule: Scoped, t: Target): number => {
  if (rule.whatsappId !== null && rule.whatsappId !== t.whatsappId) return 0;
  if (rule.queueId !== null && rule.queueId !== t.queueId) return 0;
  return 1 + (rule.queueId !== null ? 2 : 0) + (rule.whatsappId !== null ? 1 : 0);
};

export const pickRule = <T extends Scoped>(rules: T[], target: Target): T | null => {
  let best: T | null = null;
  let bestScore = 0;
  rules.forEach(rule => {
    const s = score(rule, target);
    if (s > bestScore || (s === bestScore && s > 0 && best && rule.id < best.id)) {
      best = rule;
      bestScore = s;
    }
  });
  return best;
};

const anyOr = (id: number | null) => (id === null ? null : { [Op.or]: [null, id] });

export const ResolveFollowUpRule = async (ticket: {
  companyId: number;
  whatsappId: number | null;
  queueId: number | null;
}): Promise<FollowUpRule | null> => {
  const rules = await FollowUpRule.findAll({
    where: {
      companyId: ticket.companyId,
      active: true,
      trigger: "no_reply",
      whatsappId: anyOr(ticket.whatsappId),
      queueId: anyOr(ticket.queueId)
    } as any,
    include: [STEPS_INCLUDE],
    order: STEPS_ORDER
  });
  return pickRule(rules.filter(rule => rule.steps?.length), {
    whatsappId: ticket.whatsappId ?? null,
    queueId: ticket.queueId ?? null
  });
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/resolveRule.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowUpServices/resolveRule.ts src/services/FollowUpServices/__tests__/resolveRule.spec.ts
git commit -m "Follow-up: régua mais específica para o ticket"
```

---

### Task 4: CRUD de réguas, API e upload de mídia

**Files:**
- Create: `whatsapp-api/src/services/FollowUpServices/FollowUpRuleService.ts`
- Create: `whatsapp-api/src/controllers/FollowUpController.ts`, `whatsapp-api/src/routes/followUpRoutes.ts`
- Modify: `whatsapp-api/src/routes/index.ts` (import + `routes.use(followUpRoutes);` depois de `routes.use(crmRoutes);`)
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/FollowUpRuleService.spec.ts`

**Interfaces:**
- Consumes: modelos (Task 1), `STEPS_INCLUDE`/`STEPS_ORDER` (Task 3).
- Produces: `listRules(companyId): Promise<RuleSummary[]>`, `showRule(companyId, id): Promise<FollowUpRule>`, `createRule(companyId, input: RuleInput): Promise<FollowUpRule>`, `updateRule(companyId, id, input: RuleInput): Promise<FollowUpRule>`, `deleteRule(companyId, id): Promise<void>`, `ruleStats(companyId, id): Promise<RuleStats>`, `saveStepMedia(companyId, file): Promise<{ mediaPath: string; mediaName: string }>`. Erros: `AppError("ERR_FOLLOWUP_INVALID", 400)`, `AppError("ERR_FOLLOWUP_NOT_FOUND", 404)`.
  - `RuleInput = { name?, active?, whatsappId?, queueId?, respectBusinessHours?, finalActions?: { closeTicket?, tagId? }, aiAgentId?, steps?: StepInput[] }`
  - `StepInput = { delayMinutes, mode, body, mediaPath?, mediaName?, aiInstruction? }` (a ordem é a posição no array).
  - `RuleSummary = FollowUpRule JSON + { stepCount: number; enrolled: number; replied: number }`.
  - `RuleStats = { byStatus: Record<string, number>; bySteps: { order: number; sent: number; replied: number }[] }`.

- [ ] **Step 1: Teste que falha**

```ts
const transaction = { id: "t" };
jest.mock("../../../database", () => ({ __esModule: true, default: { transaction: (fn: any) => fn(transaction), query: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), destroy: jest.fn() } }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/AiAgent", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../helpers/mediaStorage", () => ({ saveCompanyMedia: jest.fn(async () => "company4/123_ab_foto.jpg") }));

// eslint-disable-next-line import/first
import FollowUpRule from "../../../models/FollowUpRule";
// eslint-disable-next-line import/first
import FollowUpStep from "../../../models/FollowUpStep";
// eslint-disable-next-line import/first
import Whatsapp from "../../../models/Whatsapp";
// eslint-disable-next-line import/first
import Queue from "../../../models/Queue";
// eslint-disable-next-line import/first
import Tag from "../../../models/Tag";
// eslint-disable-next-line import/first
import AiAgent from "../../../models/AiAgent";
// eslint-disable-next-line import/first
import { createRule, updateRule, saveStepMedia } from "../FollowUpRuleService";

const step = (over: any = {}) => ({ delayMinutes: 60, mode: "text", body: "Oi {{firstName}}", ...over });
const saved = { id: 10, update: jest.fn(), reload: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  (Whatsapp.findOne as jest.Mock).mockResolvedValue({ id: 2 });
  (Queue.findOne as jest.Mock).mockResolvedValue({ id: 3 });
  (Tag.findOne as jest.Mock).mockResolvedValue({ id: 12 });
  (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5 });
  (FollowUpRule.create as jest.Mock).mockResolvedValue(saved);
  (FollowUpRule.findOne as jest.Mock).mockResolvedValue(saved);
});

describe("createRule", () => {
  it("saves the rule and its steps in order, in one transaction", async () => {
    await createRule(4, {
      name: " Orçamento ", whatsappId: 2, queueId: "" as any,
      finalActions: { closeTicket: true, tagId: 12 },
      steps: [step(), step({ delayMinutes: 1440, body: "Segue?" })]
    });
    expect(FollowUpRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4, name: "Orçamento", whatsappId: 2, queueId: null, trigger: "no_reply",
        respectBusinessHours: true, active: true, aiAgentId: null,
        finalActions: { closeTicket: true, tagId: 12 }
      }),
      { transaction }
    );
    expect(FollowUpStep.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({ ruleId: 10, order: 1, delayMinutes: 60, mode: "text", body: "Oi {{firstName}}" }),
        expect.objectContaining({ ruleId: 10, order: 2, delayMinutes: 1440, body: "Segue?" })
      ],
      { transaction }
    );
  });
  it("checks every id against the company", async () => {
    (Tag.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { name: "X", finalActions: { tagId: 99 }, steps: [step()] })).rejects.toMatchObject({
      message: "ERR_FOLLOWUP_INVALID", statusCode: 400
    });
    expect(Tag.findOne).toHaveBeenCalledWith({ where: { id: 99, companyId: 4 } });
    expect(FollowUpRule.create).not.toHaveBeenCalled();
  });
  it("refuses no name, no steps, a zero delay, an empty text and an AI step without instruction or agent", async () => {
    const bad = [
      { name: "", steps: [step()] },
      { name: "X", steps: [] },
      { name: "X", steps: [step({ delayMinutes: 0 })] },
      { name: "X", steps: [step({ body: "  " })] },
      { name: "X", aiAgentId: 5, steps: [step({ mode: "ai", aiInstruction: "" })] },
      { name: "X", steps: [step({ mode: "ai", aiInstruction: "Retome" })] },
      { name: "X", steps: [step({ mode: "robot" })] }
    ];
    for (const input of bad) {
      // eslint-disable-next-line no-await-in-loop
      await expect(createRule(4, input as any)).rejects.toMatchObject({ message: "ERR_FOLLOWUP_INVALID" });
    }
    expect(FollowUpRule.create).not.toHaveBeenCalled();
  });
  it("refuses media outside the company folder", async () => {
    await expect(
      createRule(4, { name: "X", steps: [step({ mediaPath: "company9/x.jpg", mediaName: "x.jpg" })] })
    ).rejects.toMatchObject({ message: "ERR_FOLLOWUP_INVALID" });
  });
});

describe("updateRule", () => {
  it("only touches this company's rule and replaces its steps", async () => {
    await updateRule(4, 10, { name: "Novo", steps: [step()] });
    expect(FollowUpRule.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10, companyId: 4 } }));
    expect(FollowUpStep.destroy).toHaveBeenCalledWith({ where: { ruleId: 10 }, transaction });
    expect(FollowUpStep.bulkCreate).toHaveBeenCalled();
  });
  it("can toggle active without resending steps", async () => {
    await updateRule(4, 10, { active: false });
    expect(saved.update).toHaveBeenCalledWith({ active: false }, { transaction });
    expect(FollowUpStep.destroy).not.toHaveBeenCalled();
  });
  it("answers 404 for another company's rule", async () => {
    (FollowUpRule.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 10, { active: false })).rejects.toMatchObject({ message: "ERR_FOLLOWUP_NOT_FOUND", statusCode: 404 });
  });
});

describe("saveStepMedia", () => {
  it("stores the file in the company folder", async () => {
    const out = await saveStepMedia(4, { buffer: Buffer.from("x"), originalname: "foto.jpg", mimetype: "image/jpeg" } as any);
    expect(out).toEqual({ mediaPath: "company4/123_ab_foto.jpg", mediaName: "foto.jpg" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/FollowUpRuleService.spec.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar o serviço**

```ts
import { QueryTypes } from "sequelize";
import AppError from "../../errors/AppError";
import sequelize from "../../database";
import FollowUpRule, { FollowUpFinalActions } from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";
import Whatsapp from "../../models/Whatsapp";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import AiAgent from "../../models/AiAgent";
import { saveCompanyMedia } from "../../helpers/mediaStorage";
import { STEPS_INCLUDE, STEPS_ORDER } from "./resolveRule";

export interface StepInput {
  delayMinutes: number;
  mode: string;
  body: string;
  mediaPath?: string | null;
  mediaName?: string | null;
  aiInstruction?: string | null;
}

export interface RuleInput {
  name?: string;
  active?: boolean;
  whatsappId?: number | null;
  queueId?: number | null;
  respectBusinessHours?: boolean;
  finalActions?: FollowUpFinalActions;
  aiAgentId?: number | null;
  steps?: StepInput[];
}

const MAX_STEPS = 10;
const MAX_DELAY_MINUTES = 60 * 24 * 90;

const invalid = () => new AppError("ERR_FOLLOWUP_INVALID", 400);
const notFound = () => new AppError("ERR_FOLLOWUP_NOT_FOUND", 404);

// Empty select values arrive as "" or null and mean "any".
const optionalId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw invalid();
  return n;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const cleanSteps = (companyId: number, steps: StepInput[] | undefined, hasAgent: boolean) => {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) throw invalid();
  return steps.map((s, index) => {
    const delayMinutes = Number(s.delayMinutes);
    if (!Number.isInteger(delayMinutes) || delayMinutes <= 0 || delayMinutes > MAX_DELAY_MINUTES) throw invalid();
    if (s.mode !== "text" && s.mode !== "ai") throw invalid();
    const body = text(s.body);
    if (!body) throw invalid();
    const aiInstruction = text(s.aiInstruction) || null;
    if (s.mode === "ai" && (!aiInstruction || !hasAgent)) throw invalid();
    const mediaPath = text(s.mediaPath) || null;
    // Files under /public are served by URL: only this company's folder.
    if (mediaPath && (!mediaPath.startsWith(`company${companyId}/`) || mediaPath.includes(".."))) throw invalid();
    return {
      order: index + 1,
      delayMinutes,
      mode: s.mode,
      body,
      mediaPath,
      mediaName: mediaPath ? text(s.mediaName) || null : null,
      aiInstruction: s.mode === "ai" ? aiInstruction : null
    };
  });
};

const assertOwned = async (companyId: number, ids: { whatsappId: number | null; queueId: number | null; tagId: number | null; aiAgentId: number | null }) => {
  const [whatsapp, queue, tag, agent] = await Promise.all([
    ids.whatsappId ? Whatsapp.findOne({ where: { id: ids.whatsappId, companyId } }) : true,
    ids.queueId ? Queue.findOne({ where: { id: ids.queueId, companyId } }) : true,
    ids.tagId ? Tag.findOne({ where: { id: ids.tagId, companyId } }) : true,
    ids.aiAgentId ? AiAgent.findOne({ where: { id: ids.aiAgentId, companyId } }) : true
  ]);
  if (!whatsapp || !queue || !tag || !agent) throw invalid();
};

const findOwned = async (companyId: number, id: number) => {
  const rule = await FollowUpRule.findOne({ where: { id, companyId }, include: [STEPS_INCLUDE], order: STEPS_ORDER });
  if (!rule) throw notFound();
  return rule;
};

const ruleFields = (input: RuleInput, current?: FollowUpRule) => {
  const name = input.name !== undefined ? text(input.name) : current?.name;
  if (!name) throw invalid();
  const finalActions = input.finalActions !== undefined ? input.finalActions || {} : current?.finalActions || {};
  return {
    name: name.slice(0, 120),
    active: input.active !== undefined ? input.active !== false : current?.active ?? true,
    whatsappId: input.whatsappId !== undefined ? optionalId(input.whatsappId) : current?.whatsappId ?? null,
    queueId: input.queueId !== undefined ? optionalId(input.queueId) : current?.queueId ?? null,
    respectBusinessHours:
      input.respectBusinessHours !== undefined ? input.respectBusinessHours !== false : current?.respectBusinessHours ?? true,
    aiAgentId: input.aiAgentId !== undefined ? optionalId(input.aiAgentId) : current?.aiAgentId ?? null,
    finalActions: { closeTicket: !!finalActions.closeTicket, tagId: optionalId(finalActions.tagId) }
  };
};

export const listRules = async (companyId: number) => {
  const rules = await FollowUpRule.findAll({ where: { companyId }, include: [STEPS_INCLUDE], order: [["id", "ASC"], ...STEPS_ORDER] });
  const counts: { ruleId: number; enrolled: string; replied: string }[] = await sequelize.query(
    `SELECT "ruleId", count(*) enrolled, count(*) FILTER (WHERE status = 'replied') replied
       FROM "FollowUpEnrollments" WHERE "companyId" = :companyId GROUP BY "ruleId"`,
    { replacements: { companyId }, type: QueryTypes.SELECT }
  );
  return rules.map(rule => {
    const c = counts.find(x => x.ruleId === rule.id);
    return { ...rule.toJSON(), stepCount: rule.steps?.length || 0, enrolled: Number(c?.enrolled || 0), replied: Number(c?.replied || 0) };
  });
};

export const showRule = findOwned;

export const createRule = async (companyId: number, input: RuleInput): Promise<FollowUpRule> => {
  const fields = ruleFields(input);
  const steps = cleanSteps(companyId, input.steps, !!fields.aiAgentId);
  await assertOwned(companyId, { ...fields, tagId: fields.finalActions.tagId });
  const id = await sequelize.transaction(async transaction => {
    const rule = await FollowUpRule.create({ companyId, trigger: "no_reply", ...fields } as any, { transaction });
    await FollowUpStep.bulkCreate(steps.map(s => ({ ...s, ruleId: rule.id })) as any, { transaction });
    return rule.id;
  });
  return findOwned(companyId, id);
};

export const updateRule = async (companyId: number, id: number, input: RuleInput): Promise<FollowUpRule> => {
  const rule = await findOwned(companyId, id);
  const onlyActive = Object.keys(input).length === 1 && input.active !== undefined;
  if (onlyActive) {
    await sequelize.transaction(transaction => rule.update({ active: input.active !== false }, { transaction }));
    return findOwned(companyId, id);
  }
  const fields = ruleFields(input, rule);
  const steps = input.steps !== undefined ? cleanSteps(companyId, input.steps, !!fields.aiAgentId) : null;
  if (!steps && !fields.aiAgentId && (rule.steps || []).some(s => s.mode === "ai")) throw invalid();
  await assertOwned(companyId, { ...fields, tagId: fields.finalActions.tagId });
  await sequelize.transaction(async transaction => {
    await rule.update(fields as any, { transaction });
    if (steps) {
      await FollowUpStep.destroy({ where: { ruleId: rule.id }, transaction });
      await FollowUpStep.bulkCreate(steps.map(s => ({ ...s, ruleId: rule.id })) as any, { transaction });
    }
  });
  return findOwned(companyId, id);
};

export const deleteRule = async (companyId: number, id: number): Promise<void> => {
  const rule = await findOwned(companyId, id);
  await rule.destroy();
};

export const ruleStats = async (companyId: number, id: number) => {
  await findOwned(companyId, id);
  const byStatusRows: { status: string; total: string }[] = await sequelize.query(
    `SELECT status, count(*) total FROM "FollowUpEnrollments" WHERE "ruleId" = :id AND "companyId" = :companyId GROUP BY status`,
    { replacements: { id, companyId }, type: QueryTypes.SELECT }
  );
  // A step "got a reply" when the enrollment stopped as replied right after it.
  const bySteps: { order: string; sent: string; replied: string }[] = await sequelize.query(
    `SELECT m.step "order", count(*) sent,
            count(*) FILTER (WHERE e.status = 'replied' AND e."currentStep" = m.step + 1) replied
       FROM (SELECT "followUpEnrollmentId",
                    row_number() OVER (PARTITION BY "followUpEnrollmentId" ORDER BY "createdAt") step
               FROM "Messages" WHERE "companyId" = :companyId AND "followUpEnrollmentId" IS NOT NULL) m
       JOIN "FollowUpEnrollments" e ON e.id = m."followUpEnrollmentId" AND e."ruleId" = :id
      GROUP BY m.step ORDER BY m.step`,
    { replacements: { id, companyId }, type: QueryTypes.SELECT }
  );
  return {
    byStatus: Object.fromEntries(byStatusRows.map(r => [r.status, Number(r.total)])),
    bySteps: bySteps.map(r => ({ order: Number(r.order), sent: Number(r.sent), replied: Number(r.replied) }))
  };
};

export const saveStepMedia = async (companyId: number, file: Express.Multer.File) => {
  if (!file?.buffer) throw invalid();
  const mediaPath = await saveCompanyMedia(companyId, file.buffer, file.originalname, file.mimetype);
  return { mediaPath, mediaName: file.originalname };
};
```

Observação para o executor: em `updateRule`, `findOwned` é chamado com o mock retornando `saved` (que tem `update`); no teste "only touches", `steps` é enviado, `fields.aiAgentId` vem de `current?.aiAgentId` (undefined → null) e os passos são `text`, então passa.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/FollowUpRuleService.spec.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Controller e rotas**

`controllers/FollowUpController.ts`:
```ts
import { Request, Response } from "express";
import {
  listRules, showRule, createRule, updateRule, deleteRule, ruleStats, saveStepMedia
} from "../services/FollowUpServices/FollowUpRuleService";
import { activeForTicket, cancelForTicket } from "../services/FollowUpServices/EnrollmentService";

const company = (req: Request) => Number(req.user.companyId);
const num = (value: unknown) => Number(value);

export const index = async (req: Request, res: Response): Promise<Response> => res.json(await listRules(company(req)));

export const show = async (req: Request, res: Response): Promise<Response> =>
  res.json(await showRule(company(req), num(req.params.id)));

export const store = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createRule(company(req), req.body));

export const update = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateRule(company(req), num(req.params.id), req.body));

export const remove = async (req: Request, res: Response): Promise<Response> => {
  await deleteRule(company(req), num(req.params.id));
  return res.status(204).send();
};

export const stats = async (req: Request, res: Response): Promise<Response> =>
  res.json(await ruleStats(company(req), num(req.params.id)));

export const uploadMedia = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await saveStepMedia(company(req), req.file as Express.Multer.File));

export const ticketFollowUp = async (req: Request, res: Response): Promise<Response> =>
  res.json(await activeForTicket(num(req.params.ticketId), company(req)));

export const cancelTicketFollowUp = async (req: Request, res: Response): Promise<Response> => {
  await cancelForTicket(num(req.params.ticketId), company(req), "manual");
  return res.status(204).send();
};
```

`routes/followUpRoutes.ts`:
```ts
import express from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import { memoryUpload } from "../config/upload";
import * as FollowUpController from "../controllers/FollowUpController";

const followUpRoutes = express.Router();

followUpRoutes.get("/followup-rules", isAuth, isAdmin, FollowUpController.index);
followUpRoutes.post("/followup-rules", isAuth, isAdmin, FollowUpController.store);
// Before /:id, otherwise "media" is read as an id.
followUpRoutes.post("/followup-rules/media", isAuth, isAdmin, memoryUpload.single("file"), FollowUpController.uploadMedia);
followUpRoutes.get("/followup-rules/:id", isAuth, isAdmin, FollowUpController.show);
followUpRoutes.put("/followup-rules/:id", isAuth, isAdmin, FollowUpController.update);
followUpRoutes.delete("/followup-rules/:id", isAuth, isAdmin, FollowUpController.remove);
followUpRoutes.get("/followup-rules/:id/stats", isAuth, isAdmin, FollowUpController.stats);

followUpRoutes.get("/tickets/:ticketId/followup", isAuth, FollowUpController.ticketFollowUp);
followUpRoutes.delete("/tickets/:ticketId/followup", isAuth, FollowUpController.cancelTicketFollowUp);

export default followUpRoutes;
```

O controller importa `EnrollmentService`, criado na Task 5. Para esta task compilar sozinha, criar já o arquivo `EnrollmentService.ts` com apenas os stubs abaixo — a Task 5 os substitui pela implementação real:
```ts
export const activeForTicket = async (_ticketId: number, _companyId: number): Promise<null> => null;
export const cancelForTicket = async (_ticketId: number, _companyId: number, _reason: string): Promise<void> => undefined;
```

Em `routes/index.ts`: `import followUpRoutes from "./followUpRoutes";` e `routes.use(followUpRoutes);` depois de `routes.use(crmRoutes);`.

- [ ] **Step 6: Compilar e rodar a suíte da pasta**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && NODE_ENV=test npx jest src/services/FollowUpServices`
Expected: sem erros de tipo; todos os testes PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/FollowUpServices src/controllers/FollowUpController.ts src/routes/followUpRoutes.ts src/routes/index.ts
git commit -m "Follow-up: cadastro de réguas, estatísticas e upload de mídia"
```

---

### Task 5: Inscrições (iniciar, reiniciar, parar)

**Files:**
- Modify (substituir stubs): `whatsapp-api/src/services/FollowUpServices/EnrollmentService.ts`
- Create: `whatsapp-api/src/services/FollowUpServices/hooks.ts`
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/EnrollmentService.spec.ts`

**Interfaces:**
- Consumes: `ResolveFollowUpRule` (Task 3), `nextBusinessSlot`, `getSchedulesForTicket` (Task 2), modelos (Task 1).
- Produces:
  - `type FollowUpTicket = { id: number; companyId: number; contactId: number | null; whatsappId: number | null; queueId: number | null; status: string; isGroup: boolean; flowId?: number | null; typebotStatus?: boolean }`
  - `startOrRestart(ticket: FollowUpTicket): Promise<FollowUpEnrollment | null>`
  - `markReplied(ticket: { id: number; companyId: number }): Promise<void>`
  - `cancelForTicket(ticketId: number, companyId: number, reason: string): Promise<void>`
  - `stopEnrollment(enrollment: FollowUpEnrollment, status: EnrollmentStatus, reason: string | null, extra?: Partial<FollowUpEnrollment>): Promise<void>`
  - `scheduleFor(rule: { respectBusinessHours: boolean }, ticket: { companyId: number; queueId: number | null }, date: Date): Promise<Date>`
  - `activeForTicket(ticketId: number, companyId: number): Promise<TicketFollowUp | null>` com `TicketFollowUp = { id: number; ruleId: number; ruleName: string; currentStep: number; totalSteps: number; nextRunAt: Date }`
  - `emitFollowUp(companyId: number, ticketId: number): Promise<void>` — emite `{ ticketId, followUp: TicketFollowUp | null }`.
  - `hooks.ts`: `followUpOnAgentMessage(ticket)`, `followUpOnCustomerMessage(ticket)`, `followUpOnTicketChanged(ticket, change: { closed: boolean; queueChanged: boolean })` — nunca lançam.

- [ ] **Step 1: Teste que falha**

```ts
const emit = jest.fn();
const to = jest.fn(() => ({ emit }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to }) }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: {} }));
jest.mock("../resolveRule", () => ({ ResolveFollowUpRule: jest.fn(), STEPS_INCLUDE: {}, STEPS_ORDER: [] }));
jest.mock("../businessHours", () => ({
  getSchedulesForTicket: jest.fn(async () => []),
  nextBusinessSlot: jest.fn((d: Date) => d)
}));

// eslint-disable-next-line import/first
import FollowUpEnrollment from "../../../models/FollowUpEnrollment";
// eslint-disable-next-line import/first
import { ResolveFollowUpRule } from "../resolveRule";
// eslint-disable-next-line import/first
import { nextBusinessSlot } from "../businessHours";
// eslint-disable-next-line import/first
import { startOrRestart, markReplied, cancelForTicket, activeForTicket } from "../EnrollmentService";
// eslint-disable-next-line import/first
import { followUpOnAgentMessage, followUpOnTicketChanged } from "../hooks";

const NOW = new Date(2026, 9, 5, 10, 0);
const ticket = (over: any = {}) => ({
  id: 50, companyId: 4, contactId: 9, whatsappId: 7, queueId: 3, status: "open", isGroup: false,
  flowId: null, typebotStatus: false, ...over
});
const rule = { id: 1, name: "Orçamento", respectBusinessHours: true, steps: [{ order: 1, delayMinutes: 120 }, { order: 2, delayMinutes: 60 }] };
const enrollment = (over: any = {}) => ({ id: 77, ticketId: 50, companyId: 4, ruleId: 1, currentStep: 2, status: "active", update: jest.fn(), ...over });

beforeAll(() => { jest.useFakeTimers("modern" as any); jest.setSystemTime(NOW); });
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  jest.clearAllMocks();
  (ResolveFollowUpRule as jest.Mock).mockResolvedValue(rule);
  (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(null);
  (FollowUpEnrollment.create as jest.Mock).mockImplementation(async (d: any) => ({ id: 77, ...d }));
});

describe("startOrRestart", () => {
  it("enrolls the ticket on step 1, delay counted from now and fitted to business hours", async () => {
    await startOrRestart(ticket());
    expect(FollowUpEnrollment.create).toHaveBeenCalledWith({
      companyId: 4, ruleId: 1, ticketId: 50, contactId: 9, currentStep: 1, attempts: 0,
      status: "active", nextRunAt: new Date(2026, 9, 5, 12, 0)
    });
    expect(nextBusinessSlot).toHaveBeenCalled();
    expect(emit).toHaveBeenCalled();
  });
  it("restarts an active enrollment from step 1", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await startOrRestart(ticket());
    expect(active.update).toHaveBeenCalledWith({ ruleId: 1, currentStep: 1, attempts: 0, nextRunAt: new Date(2026, 9, 5, 12, 0) });
    expect(FollowUpEnrollment.create).not.toHaveBeenCalled();
  });
  it("skips groups, closed tickets and tickets inside a flow or typebot", async () => {
    for (const t of [ticket({ isGroup: true }), ticket({ status: "closed" }), ticket({ flowId: 3 }), ticket({ typebotStatus: true })]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await startOrRestart(t)).toBeNull();
    }
    expect(ResolveFollowUpRule).not.toHaveBeenCalled();
  });
  it("stops the active enrollment when no rule applies anymore", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    (ResolveFollowUpRule as jest.Mock).mockResolvedValue(null);
    expect(await startOrRestart(ticket())).toBeNull();
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "no_rule" });
  });
  it("ignores business hours when the rule says so", async () => {
    (ResolveFollowUpRule as jest.Mock).mockResolvedValue({ ...rule, respectBusinessHours: false });
    await startOrRestart(ticket());
    expect(nextBusinessSlot).not.toHaveBeenCalled();
  });
});

describe("markReplied / cancelForTicket", () => {
  it("marks the active enrollment as replied", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await markReplied({ id: 50, companyId: 4 });
    expect(FollowUpEnrollment.findOne).toHaveBeenCalledWith({ where: { ticketId: 50, companyId: 4, status: "active" } });
    expect(active.update).toHaveBeenCalledWith({ status: "replied", stopReason: null });
  });
  it("cancels with a reason, scoped by company", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await cancelForTicket(50, 4, "manual");
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "manual" });
  });
  it("does nothing without an active enrollment", async () => {
    await expect(markReplied({ id: 50, companyId: 4 })).resolves.toBeUndefined();
  });
});

describe("activeForTicket", () => {
  it("returns step, total and next send", async () => {
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(
      enrollment({ nextRunAt: NOW, rule: { name: "Orçamento", steps: rule.steps } })
    );
    expect(await activeForTicket(50, 4)).toEqual({
      id: 77, ruleId: 1, ruleName: "Orçamento", currentStep: 2, totalSteps: 2, nextRunAt: NOW
    });
  });
});

describe("hooks", () => {
  it("never throw", async () => {
    (ResolveFollowUpRule as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(followUpOnAgentMessage(ticket() as any)).resolves.toBeUndefined();
  });
  it("cancel on close or queue change, without enrolling again", async () => {
    const active = enrollment();
    (FollowUpEnrollment.findOne as jest.Mock).mockResolvedValue(active);
    await followUpOnTicketChanged(ticket() as any, { closed: false, queueChanged: true });
    expect(active.update).toHaveBeenCalledWith({ status: "cancelled", stopReason: "queue_changed" });
    expect(ResolveFollowUpRule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/EnrollmentService.spec.ts`
Expected: FAIL — `startOrRestart is not a function` (stubs da Task 4).

- [ ] **Step 3: Implementar `EnrollmentService.ts`**

```ts
import { UniqueConstraintError } from "sequelize";
import { addMinutes } from "date-fns";
import { getIO } from "../../libs/socket";
import { companyRoom } from "../../libs/socketRooms";
import FollowUpEnrollment, { EnrollmentStatus } from "../../models/FollowUpEnrollment";
import FollowUpRule from "../../models/FollowUpRule";
import { ResolveFollowUpRule, STEPS_INCLUDE } from "./resolveRule";
import { getSchedulesForTicket, nextBusinessSlot } from "./businessHours";

export type FollowUpTicket = {
  id: number;
  companyId: number;
  contactId: number | null;
  whatsappId: number | null;
  queueId: number | null;
  status: string;
  isGroup: boolean;
  flowId?: number | null;
  typebotStatus?: boolean;
};

export interface TicketFollowUp {
  id: number;
  ruleId: number;
  ruleName: string;
  currentStep: number;
  totalSteps: number;
  nextRunAt: Date;
}

const eligible = (t: FollowUpTicket): boolean =>
  ["open", "pending"].includes(t.status) && !t.isGroup && !t.flowId && !t.typebotStatus;

const findActive = (ticketId: number, companyId: number) =>
  FollowUpEnrollment.findOne({ where: { ticketId, companyId, status: "active" } });

export const scheduleFor = async (
  rule: { respectBusinessHours: boolean },
  ticket: { companyId: number; queueId: number | null },
  date: Date
): Promise<Date> => (rule.respectBusinessHours ? nextBusinessSlot(date, await getSchedulesForTicket(ticket)) : date);

export const activeForTicket = async (ticketId: number, companyId: number): Promise<TicketFollowUp | null> => {
  const e = await FollowUpEnrollment.findOne({
    where: { ticketId, companyId, status: "active" },
    include: [{ model: FollowUpRule, as: "rule", attributes: ["id", "name"], include: [{ ...STEPS_INCLUDE, attributes: ["id"] }] }]
  });
  if (!e) return null;
  return {
    id: e.id,
    ruleId: e.ruleId,
    ruleName: e.rule?.name || "",
    currentStep: e.currentStep,
    totalSteps: e.rule?.steps?.length || 0,
    nextRunAt: e.nextRunAt
  };
};

export const emitFollowUp = async (companyId: number, ticketId: number): Promise<void> => {
  const followUp = await activeForTicket(ticketId, companyId);
  getIO().to(companyRoom(companyId)).emit(`company-${companyId}-followup`, { ticketId, followUp });
};

export const stopEnrollment = async (
  enrollment: FollowUpEnrollment,
  status: EnrollmentStatus,
  reason: string | null,
  extra: Partial<FollowUpEnrollment> = {}
): Promise<void> => {
  await enrollment.update({ ...extra, status, stopReason: reason } as any);
  await emitFollowUp(enrollment.companyId, enrollment.ticketId);
};

export const startOrRestart = async (ticket: FollowUpTicket): Promise<FollowUpEnrollment | null> => {
  if (!eligible(ticket)) return null;
  const rule = await ResolveFollowUpRule(ticket);
  const active = await findActive(ticket.id, ticket.companyId);
  if (!rule) {
    if (active) await stopEnrollment(active, "cancelled", "no_rule");
    return null;
  }
  const nextRunAt = await scheduleFor(rule, ticket, addMinutes(new Date(), rule.steps[0].delayMinutes));
  const restart = { ruleId: rule.id, currentStep: 1, attempts: 0, nextRunAt };
  let enrollment = active;
  if (enrollment) {
    await enrollment.update(restart);
  } else {
    try {
      enrollment = await FollowUpEnrollment.create({
        companyId: ticket.companyId, ticketId: ticket.id, contactId: ticket.contactId, status: "active", ...restart
      } as any);
    } catch (err) {
      // Another message of the same ticket enrolled it a moment ago.
      if (!(err instanceof UniqueConstraintError)) throw err;
      enrollment = await findActive(ticket.id, ticket.companyId);
      if (enrollment) await enrollment.update(restart);
    }
  }
  await emitFollowUp(ticket.companyId, ticket.id);
  return enrollment;
};

export const markReplied = async (ticket: { id: number; companyId: number }): Promise<void> => {
  const active = await findActive(ticket.id, ticket.companyId);
  if (active) await stopEnrollment(active, "replied", null);
};

export const cancelForTicket = async (ticketId: number, companyId: number, reason: string): Promise<void> => {
  const active = await findActive(ticketId, companyId);
  if (active) await stopEnrollment(active, "cancelled", reason);
};
```

Ordem dos campos no `create`: o teste usa `toHaveBeenCalledWith` com objeto — a ordem não importa.

- [ ] **Step 4: Implementar `hooks.ts`**

```ts
import * as Sentry from "@sentry/node";
import { logger } from "../../utils/logger";
import { cancelForTicket, FollowUpTicket, markReplied, startOrRestart } from "./EnrollmentService";

// Follow-up never gets in the way of a message or a ticket update.
const safely = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Follow-up ${what} failed: ${err}`);
  }
};

// Our attendant, the AI agent or the phone wrote: wait for the customer.
export const followUpOnAgentMessage = (ticket: FollowUpTicket): Promise<void> =>
  safely("start", () => startOrRestart(ticket));

export const followUpOnCustomerMessage = (ticket: { id: number; companyId: number }): Promise<void> =>
  safely("reply", () => markReplied(ticket));

// Queue or connection changed: the next message of the attendant starts the new queue's rule.
export const followUpOnTicketChanged = (
  ticket: { id: number; companyId: number },
  change: { closed: boolean; queueChanged: boolean }
): Promise<void> =>
  safely("ticket change", async () => {
    if (change.closed) await cancelForTicket(ticket.id, ticket.companyId, "ticket_closed");
    else if (change.queueChanged) await cancelForTicket(ticket.id, ticket.companyId, "queue_changed");
  });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices`
Expected: PASS (todas as suítes da pasta).

- [ ] **Step 6: Commit**

```bash
git add src/services/FollowUpServices
git commit -m "Follow-up: inscrição, reinício e parada por ticket"
```

---

### Task 6: Montagem da mensagem da etapa (texto, mídia, IA)

**Files:**
- Create: `whatsapp-api/src/services/FollowUpServices/buildStepMessage.ts`
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/buildStepMessage.spec.ts`

**Interfaces:**
- Consumes: `formatBody` (`helpers/Mustache`), `contentFromFile` (`channels/media`), `getProvider` (`AiAgentServices/providers`), `agentKey` (`AiAgentServices/keys`), `toHistory`/`trimHistory` (`AiAgentServices/RunAiAgentService`), `uploadConfig.directory`.
- Produces: `buildStepMessage(step: FollowUpStep, ticket: Ticket /* com contact */, rule: FollowUpRule): Promise<OutgoingContent>`; constante `AI_TIMEOUT_MS = 30000`.

- [ ] **Step 1: Teste que falha**

```ts
const runTurn = jest.fn();
jest.mock("../../AiAgentServices/providers", () => ({ getProvider: () => ({ runTurn }) }));
jest.mock("../../AiAgentServices/keys", () => ({ agentKey: (a: any) => a.apiKeyEncrypted || null }));
jest.mock("../../AiAgentServices/RunAiAgentService", () => ({
  toHistory: (ms: any[]) => ms.map(m => ({ role: m.fromMe ? "assistant" : "user", text: m.body })),
  trimHistory: (h: any) => h
}));
jest.mock("../../../models/AiAgent", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findAll: jest.fn(async () => [{ fromMe: true, body: "Segue o orçamento" }]) } }));
jest.mock("../../../config/upload", () => ({ __esModule: true, default: { directory: "/srv/public" } }));
jest.mock("../../../utils/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import AiAgent from "../../../models/AiAgent";
// eslint-disable-next-line import/first
import { buildStepMessage } from "../buildStepMessage";

const ticket: any = { id: 50, companyId: 4, contact: { name: "Maria Souza" } };
const rule: any = { aiAgentId: 5 };
const textStep: any = { mode: "text", body: "Oi {{firstName}}, conseguiu ver?", mediaPath: null };

beforeEach(() => jest.clearAllMocks());

describe("buildStepMessage", () => {
  it("fills the usual variables", async () => {
    expect(await buildStepMessage(textStep, ticket, rule)).toEqual({ type: "text", text: "Oi Maria, conseguiu ver?" });
  });
  it("sends the company's file with the text as caption", async () => {
    const out: any = await buildStepMessage({ ...textStep, mediaPath: "company4/1_ab_foto.jpg", mediaName: "foto.jpg" }, ticket, rule);
    expect(out).toMatchObject({ type: "image", path: "/srv/public/company4/1_ab_foto.jpg", caption: "Oi Maria, conseguiu ver?" });
  });
  it("ignores a file outside the company folder", async () => {
    const out = await buildStepMessage({ ...textStep, mediaPath: "company9/x.jpg", mediaName: "x.jpg" }, ticket, rule);
    expect(out).toEqual({ type: "text", text: "Oi Maria, conseguiu ver?" });
  });
  it("asks the rule's agent, without tools, for an AI step", async () => {
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "gpt-x", prompt: "Você é a Ana.", apiKeyEncrypted: "k" });
    runTurn.mockResolvedValue({ text: "Oi Maria! Ficou alguma dúvida?" });
    const out = await buildStepMessage({ mode: "ai", body: "reserva", aiInstruction: "Retome o orçamento" } as any, ticket, rule);
    expect(out).toEqual({ type: "text", text: "Oi Maria! Ficou alguma dúvida?" });
    expect(AiAgent.findOne).toHaveBeenCalledWith({ where: { id: 5, companyId: 4 } });
    const req = runTurn.mock.calls[0][0];
    expect(req.tools).toEqual([]);
    expect(req.maxSteps).toBe(1);
    expect(req.system).toContain("Você é a Ana.");
    expect(req.history[req.history.length - 1]).toMatchObject({ role: "user" });
    expect(req.history[req.history.length - 1].text).toContain("Retome o orçamento");
  });
  it("falls back to the fixed text when the AI fails, has no key or answers empty", async () => {
    const step: any = { mode: "ai", body: "Oi {{firstName}}", aiInstruction: "Retome" };
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "m", prompt: "", apiKeyEncrypted: "k" });
    runTurn.mockRejectedValue(new Error("429"));
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
    runTurn.mockResolvedValue({ text: "  " });
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
    (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5, provider: "openai", model: "m", apiKeyEncrypted: null });
    expect(await buildStepMessage(step, ticket, rule)).toEqual({ type: "text", text: "Oi Maria" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/buildStepMessage.spec.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```ts
import path from "path";
import uploadConfig from "../../config/upload";
import formatBody from "../../helpers/Mustache";
import { contentFromFile } from "../../channels/media";
import { OutgoingContent } from "../../channels/types";
import AiAgent from "../../models/AiAgent";
import Message from "../../models/Message";
import FollowUpRule from "../../models/FollowUpRule";
import FollowUpStep from "../../models/FollowUpStep";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { getProvider } from "../AiAgentServices/providers";
import { agentKey } from "../AiAgentServices/keys";
import { toHistory, trimHistory } from "../AiAgentServices/RunAiAgentService";

export const AI_TIMEOUT_MS = 30000;
const AI_HISTORY = 20;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

const fixedContent = (step: FollowUpStep, ticket: Ticket): OutgoingContent => {
  const text = formatBody(step.body, ticket.contact);
  const own = step.mediaPath && step.mediaPath.startsWith(`company${ticket.companyId}/`) && !step.mediaPath.includes("..");
  if (!own) {
    if (step.mediaPath) logger.warn(`Follow-up step ${step.id} has media outside company ${ticket.companyId}; sending text only`);
    return { type: "text", text };
  }
  return contentFromFile(step.mediaName || "", path.resolve(uploadConfig.directory, step.mediaPath), text);
};

const aiText = async (step: FollowUpStep, ticket: Ticket, rule: FollowUpRule): Promise<string | null> => {
  if (!rule.aiAgentId) return null;
  const agent = await AiAgent.findOne({ where: { id: rule.aiAgentId, companyId: ticket.companyId } });
  const apiKey = agent ? agentKey(agent) : null;
  if (!agent || !apiKey) return null;
  const recent = await Message.findAll({
    where: { ticketId: ticket.id, isPrivate: false },
    order: [["createdAt", "DESC"]],
    limit: AI_HISTORY
  });
  const history = trimHistory(toHistory(recent.reverse()));
  // The conversation ends with our message; the request to write the
  // follow-up goes as the last turn so every provider accepts it.
  history.push({
    role: "user",
    text:
      `[Instrução interna, não é do cliente] O cliente não respondeu à última mensagem. ${step.aiInstruction}\n` +
      "Escreva somente a mensagem que será enviada ao cliente, curta e natural, sem aspas."
  });
  const result = await withTimeout(
    getProvider(agent.provider as any).runTurn({
      apiKey,
      model: agent.model,
      system: agent.prompt || "",
      systemContext: `Contato: ${ticket.contact?.name || ""}`,
      history,
      tools: [],
      executeTool: async () => ({ result: "", error: true }),
      maxSteps: 1
    }),
    AI_TIMEOUT_MS
  );
  return result.text?.trim() || null;
};

export const buildStepMessage = async (step: FollowUpStep, ticket: Ticket, rule: FollowUpRule): Promise<OutgoingContent> => {
  if (step.mode === "ai") {
    try {
      const text = await aiText(step, ticket, rule);
      if (text) return { type: "text", text };
      logger.warn(`Follow-up step ${step.id}: AI unavailable, sending the fixed text`);
    } catch (err) {
      logger.warn(`Follow-up step ${step.id}: AI failed (${err}), sending the fixed text`);
    }
  }
  return fixedContent(step, ticket);
};
```

Conferir antes de rodar: o tipo do campo `role` em `ChatMessage` (`services/AiAgentServices/types.ts`) aceita `"user"`; e `getProvider` aceita `agent.provider` (se o parâmetro for `AiProviderName`, manter o `as any` como no código acima ou fazer o cast para `AiProviderName`).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/buildStepMessage.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/services/FollowUpServices/buildStepMessage.ts src/services/FollowUpServices/__tests__/buildStepMessage.spec.ts
git commit -m "Follow-up: mensagem da etapa com texto, mídia ou IA"
```

---

### Task 7: Monitor que envia as etapas vencidas

**Files:**
- Create: `whatsapp-api/src/services/FollowUpServices/FollowUpMonitor.ts`
- Modify: `whatsapp-api/src/services/MessageServices/CreateMessageService.ts` (interface `MessageData`), `SaveSentMessageService.ts`, `SendTicketMessageService.ts`, `whatsapp-api/src/queues.ts`
- Test: `whatsapp-api/src/services/FollowUpServices/__tests__/FollowUpMonitor.spec.ts`, ajustar `whatsapp-api/src/services/MessageServices/__tests__/SaveSentMessageService.spec.ts`

**Interfaces:**
- Consumes: `stopEnrollment`, `scheduleFor`, `emitFollowUp` (Task 5), `buildStepMessage` (Task 6), `STEPS_INCLUDE`/`STEPS_ORDER` (Task 3).
- Produces: `processDueFollowUps(now?: Date): Promise<number>` (quantas inscrições processou); `runEnrollment(id: number, now: Date): Promise<void>`; constantes `BATCH = 50`, `CLAIM_MINUTES = 5`, `RETRY_MINUTES = 15`, `MAX_ATTEMPTS = 3`. `SendTicketMessageService(ticket, content, { followUpEnrollmentId })` grava a mensagem com essa coluna.

- [ ] **Step 1: Passar `followUpEnrollmentId` até a mensagem gravada (teste primeiro)**

Adicionar em `SaveSentMessageService.spec.ts`:
```ts
  it("marks a message sent by a follow-up", async () => {
    const saved: any = await SaveSentMessageService({ ticket, sent, body: "Oi", followUpEnrollmentId: 77 });
    expect(saved.followUpEnrollmentId).toBe(77);
  });
```
Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/MessageServices/__tests__/SaveSentMessageService.spec.ts`
Expected: FAIL (erro de tipo do ts-jest: propriedade não existe).

Implementar:
- `CreateMessageService.ts`, em `interface MessageData`, após `whatsappId?: number;`: `/** Sent by a follow-up rule. */ followUpEnrollmentId?: number | null;`
- `SaveSentMessageService.ts`: em `interface Request` adicionar `/** Sent by a follow-up rule. */ followUpEnrollmentId?: number;`; desestruturar `followUpEnrollmentId` na assinatura; em `messageData` adicionar `followUpEnrollmentId: followUpEnrollmentId ?? null,`.
- `SendTicketMessageService.ts`: tipo das opções vira `SendOptions & { quotedMsgId?: string; followUpEnrollmentId?: number }`; `const { quotedMsgId, followUpEnrollmentId, ...sendOptions } = options;`; passar `followUpEnrollmentId` ao `SaveSentMessageService`.

Run de novo: PASS. Rodar também `NODE_ENV=test npx jest src/services/MessageServices` → PASS.

- [ ] **Step 2: Teste do monitor que falha**

```ts
const transaction = { LOCK: { UPDATE: "UPDATE" } };
jest.mock("../../../database", () => ({ __esModule: true, default: { transaction: (fn: any) => fn(transaction) } }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn(), update: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/TicketTag", () => ({ __esModule: true, default: { findOrCreate: jest.fn() } }));
jest.mock("../resolveRule", () => ({ STEPS_INCLUDE: {}, STEPS_ORDER: [] }));
jest.mock("../buildStepMessage", () => ({ buildStepMessage: jest.fn(async () => ({ type: "text", text: "Oi" })) }));
jest.mock("../EnrollmentService", () => ({
  stopEnrollment: jest.fn(),
  emitFollowUp: jest.fn(),
  scheduleFor: jest.fn(async (_r: any, _t: any, d: Date) => d)
}));
jest.mock("../../MessageServices/SendTicketMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

/* eslint-disable import/first */
import FollowUpEnrollment from "../../../models/FollowUpEnrollment";
import FollowUpRule from "../../../models/FollowUpRule";
import Ticket from "../../../models/Ticket";
import Message from "../../../models/Message";
import Whatsapp from "../../../models/Whatsapp";
import Tag from "../../../models/Tag";
import TicketTag from "../../../models/TicketTag";
import SendTicketMessageService from "../../MessageServices/SendTicketMessageService";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import { stopEnrollment } from "../EnrollmentService";
import { processDueFollowUps, runEnrollment } from "../FollowUpMonitor";
/* eslint-enable import/first */

const NOW = new Date(2026, 9, 5, 10, 0);
const steps = [{ id: 1, order: 1, delayMinutes: 60 }, { id: 2, order: 2, delayMinutes: 1440 }];
let enrollment: any;
const ticket = { id: 50, companyId: 4, whatsappId: 7, queueId: 3, status: "open", contact: { name: "Maria" } };

beforeEach(() => {
  jest.clearAllMocks();
  enrollment = { id: 77, companyId: 4, ticketId: 50, ruleId: 1, currentStep: 1, attempts: 0, status: "active", update: jest.fn() };
  (FollowUpEnrollment.findByPk as jest.Mock).mockResolvedValue(enrollment);
  (Ticket.findByPk as jest.Mock).mockResolvedValue(ticket);
  (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: true });
  (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({ id: 1, active: true, respectBusinessHours: true, finalActions: {}, steps });
  (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ status: "CONNECTED" });
});

describe("processDueFollowUps", () => {
  it("claims due enrollments inside a locked transaction before sending", async () => {
    (FollowUpEnrollment.findAll as jest.Mock).mockResolvedValue([{ id: 77 }, { id: 78 }]);
    (FollowUpEnrollment.findByPk as jest.Mock).mockResolvedValue(null);
    expect(await processDueFollowUps(NOW)).toBe(2);
    const query = (FollowUpEnrollment.findAll as jest.Mock).mock.calls[0][0];
    expect(query).toMatchObject({ limit: 50, lock: "UPDATE", skipLocked: true, transaction });
    expect(FollowUpEnrollment.update).toHaveBeenCalledWith(
      { nextRunAt: new Date(2026, 9, 5, 10, 5) },
      { where: { id: [77, 78] }, transaction }
    );
  });
  it("keeps going when one enrollment fails", async () => {
    (FollowUpEnrollment.findAll as jest.Mock).mockResolvedValue([{ id: 77 }, { id: 78 }]);
    (FollowUpEnrollment.findByPk as jest.Mock).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(null);
    await expect(processDueFollowUps(NOW)).resolves.toBe(2);
    expect(FollowUpEnrollment.findByPk).toHaveBeenCalledTimes(2);
  });
});

describe("runEnrollment", () => {
  it("sends the current step marked with the enrollment and schedules the next one", async () => {
    await runEnrollment(77, NOW);
    expect(SendTicketMessageService).toHaveBeenCalledWith(ticket, { type: "text", text: "Oi" }, { followUpEnrollmentId: 77 });
    expect(enrollment.update).toHaveBeenCalledWith({
      currentStep: 2, attempts: 0, lastSentAt: NOW, nextRunAt: new Date(2026, 9, 6, 10, 0)
    });
  });
  it("completes after the last step and runs the final actions", async () => {
    enrollment.currentStep = 2;
    (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({
      id: 1, active: true, respectBusinessHours: true, finalActions: { closeTicket: true, tagId: 12 }, steps
    });
    (Tag.findOne as jest.Mock).mockResolvedValue({ id: 12 });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "completed", null, { lastSentAt: NOW });
    expect(Tag.findOne).toHaveBeenCalledWith({ where: { id: 12, companyId: 4 } });
    expect(TicketTag.findOrCreate).toHaveBeenCalledWith({ where: { ticketId: 50, tagId: 12 } });
    expect(UpdateTicketService).toHaveBeenCalledWith({ ticketData: { status: "closed" }, ticketId: 50, companyId: 4 });
  });
  it("cancels without sending when the ticket closed or the customer wrote last", async () => {
    (Ticket.findByPk as jest.Mock).mockResolvedValue({ ...ticket, status: "closed" });
    await runEnrollment(77, NOW);
    (Ticket.findByPk as jest.Mock).mockResolvedValue(ticket);
    (Message.findOne as jest.Mock).mockResolvedValue({ fromMe: false });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenNthCalledWith(1, enrollment, "cancelled", "stale");
    expect(stopEnrollment).toHaveBeenNthCalledWith(2, enrollment, "cancelled", "stale");
    expect(SendTicketMessageService).not.toHaveBeenCalled();
  });
  it("completes without sending when the step was removed from the rule", async () => {
    enrollment.currentStep = 3;
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "completed", "rule_changed");
    expect(SendTicketMessageService).not.toHaveBeenCalled();
  });
  it("cancels when the rule was turned off", async () => {
    (FollowUpRule.findByPk as jest.Mock).mockResolvedValue({ id: 1, active: false, steps });
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "cancelled", "rule_inactive");
  });
  it("retries in 15 minutes while the connection is down, and fails on the third try", async () => {
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ status: "DISCONNECTED" });
    await runEnrollment(77, NOW);
    expect(enrollment.update).toHaveBeenCalledWith({ attempts: 1, nextRunAt: new Date(2026, 9, 5, 10, 15) });
    enrollment.attempts = 2;
    await runEnrollment(77, NOW);
    expect(stopEnrollment).toHaveBeenCalledWith(enrollment, "failed", "whatsapp_disconnected", { attempts: 3 });
  });
  it("retries when sending throws", async () => {
    (SendTicketMessageService as jest.Mock).mockRejectedValueOnce(new Error("socket closed"));
    await runEnrollment(77, NOW);
    expect(enrollment.update).toHaveBeenCalledWith({ attempts: 1, nextRunAt: new Date(2026, 9, 5, 10, 15) });
  });
  it("does nothing for an enrollment that is no longer active", async () => {
    enrollment.status = "replied";
    await runEnrollment(77, NOW);
    expect(Ticket.findByPk).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices/__tests__/FollowUpMonitor.spec.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar `FollowUpMonitor.ts`**

```ts
import * as Sentry from "@sentry/node";
import { Op } from "sequelize";
import { addMinutes } from "date-fns";
import sequelize from "../../database";
import FollowUpEnrollment from "../../models/FollowUpEnrollment";
import FollowUpRule from "../../models/FollowUpRule";
import Message from "../../models/Message";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { buildStepMessage } from "./buildStepMessage";
import { emitFollowUp, scheduleFor, stopEnrollment } from "./EnrollmentService";
import { STEPS_INCLUDE, STEPS_ORDER } from "./resolveRule";

export const BATCH = 50;
export const CLAIM_MINUTES = 5;
export const RETRY_MINUTES = 15;
export const MAX_ATTEMPTS = 3;

const lastMessageIsOurs = async (ticketId: number): Promise<boolean> => {
  const last = await Message.findOne({
    where: { ticketId, isPrivate: { [Op.not]: true } },
    order: [["createdAt", "DESC"]],
    attributes: ["fromMe"]
  });
  return !!last?.fromMe;
};

const retryLater = async (enrollment: FollowUpEnrollment, now: Date, reason: string): Promise<void> => {
  const attempts = enrollment.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await stopEnrollment(enrollment, "failed", reason, { attempts });
    return;
  }
  await enrollment.update({ attempts, nextRunAt: addMinutes(now, RETRY_MINUTES) });
};

const runFinalActions = async (rule: FollowUpRule, ticket: Ticket): Promise<void> => {
  const { tagId, closeTicket } = rule.finalActions || {};
  if (tagId) {
    const tag = await Tag.findOne({ where: { id: tagId, companyId: ticket.companyId } });
    if (tag) await TicketTag.findOrCreate({ where: { ticketId: ticket.id, tagId: tag.id } } as any);
  }
  if (closeTicket) {
    await UpdateTicketService({ ticketData: { status: "closed" }, ticketId: ticket.id, companyId: ticket.companyId });
  }
};

export const runEnrollment = async (id: number, now: Date): Promise<void> => {
  const enrollment = await FollowUpEnrollment.findByPk(id);
  if (!enrollment || enrollment.status !== "active") return;

  // Closed by rating or auto-close, or the customer wrote meanwhile.
  const ticket = await Ticket.findByPk(enrollment.ticketId, { include: ["contact"] });
  if (!ticket || !["open", "pending"].includes(ticket.status) || !(await lastMessageIsOurs(ticket.id))) {
    await stopEnrollment(enrollment, "cancelled", "stale");
    return;
  }

  const rule = await FollowUpRule.findByPk(enrollment.ruleId, { include: [STEPS_INCLUDE], order: STEPS_ORDER });
  if (!rule || !rule.active) {
    await stopEnrollment(enrollment, "cancelled", "rule_inactive");
    return;
  }
  const step = rule.steps[enrollment.currentStep - 1];
  if (!step) {
    await stopEnrollment(enrollment, "completed", "rule_changed");
    return;
  }

  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId, { attributes: ["id", "status"] });
  if (whatsapp?.status !== "CONNECTED") {
    await retryLater(enrollment, now, "whatsapp_disconnected");
    return;
  }

  try {
    const content = await buildStepMessage(step, ticket, rule);
    await SendTicketMessageService(ticket, content, { followUpEnrollmentId: enrollment.id });
  } catch (err) {
    logger.warn(`Follow-up ${enrollment.id} could not send step ${enrollment.currentStep}: ${err}`);
    await retryLater(enrollment, now, "send_error");
    return;
  }

  const next = rule.steps[enrollment.currentStep];
  if (next) {
    await enrollment.update({
      currentStep: enrollment.currentStep + 1,
      attempts: 0,
      lastSentAt: now,
      nextRunAt: await scheduleFor(rule, ticket, addMinutes(now, next.delayMinutes))
    });
    await emitFollowUp(enrollment.companyId, enrollment.ticketId);
    return;
  }
  await stopEnrollment(enrollment, "completed", null, { lastSentAt: now });
  await runFinalActions(rule, ticket);
};

/**
 * Sends the due steps. Rows are claimed (nextRunAt pushed ahead) inside a
 * SKIP LOCKED transaction, so a parallel run never sends the same step.
 */
export const processDueFollowUps = async (now: Date = new Date()): Promise<number> => {
  const due = await sequelize.transaction(async transaction => {
    const rows = await FollowUpEnrollment.findAll({
      where: { status: "active", nextRunAt: { [Op.lte]: now } },
      order: [["nextRunAt", "ASC"]],
      attributes: ["id"],
      limit: BATCH,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction
    });
    if (rows.length) {
      await FollowUpEnrollment.update(
        { nextRunAt: addMinutes(now, CLAIM_MINUTES) },
        { where: { id: rows.map(r => r.id) }, transaction }
      );
    }
    return rows;
  });

  for (const row of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await runEnrollment(row.id, now);
    } catch (err) {
      Sentry.captureException(err);
      logger.error(`Follow-up ${row.id} failed: ${err}`);
    }
  }
  return due.length;
};
```

Nota: se o processo morrer depois do claim, a inscrição volta a vencer em 5 minutos (não há envio perdido). Se o envio já tiver saído e o processo morrer antes do `update`, a etapa pode ser repetida uma vez — aceito.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/FollowUpServices`
Expected: PASS.

- [ ] **Step 6: Registrar o job em `queues.ts`**

Imports no topo, junto aos demais:
```ts
import { processDueFollowUps } from "./services/FollowUpServices/FollowUpMonitor";
```
Junto às outras filas (depois de `campaignQueue`):
```ts
export const followUpMonitor = new BullQueue("FollowUpMonitor", connection);
```
Handler (perto de `handleVerifySchedules`):
```ts
async function handleVerifyFollowUps() {
  try {
    const sent = await processDueFollowUps();
    if (sent > 0) logger.info(`Follow-ups processados: ${sent}`);
  } catch (e: any) {
    Sentry.captureException(e);
    logger.error("FollowUpMonitor -> Verify: error", e.message);
  }
}
```
Em `startQueueProcess`, depois de `userMonitor.process(...)`:
```ts
  followUpMonitor.process("Verify", handleVerifyFollowUps);
```
e depois do `userMonitor.add(...)`:
```ts
  followUpMonitor.add(
    "Verify",
    {},
    {
      repeat: { cron: "*/30 * * * * *", key: "verify-followups" },
      removeOnComplete: true
    }
  );
```

- [ ] **Step 7: Compilar e rodar toda a suíte**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && NODE_ENV=test npx jest`
Expected: sem erros de tipo; suíte inteira PASS (mesmo número de falhas pré-existentes que na `main`, se houver — anotar antes de começar com `git stash; npx jest; git stash pop` caso alguma falhe).

- [ ] **Step 8: Commit**

```bash
git add src/services/FollowUpServices src/services/MessageServices src/queues.ts
git commit -m "Follow-up: monitor que envia as etapas vencidas"
```

---

### Task 8: Ligar os ganchos ao atendimento

**Files:**
- Modify: `whatsapp-api/src/controllers/MessageController.ts` (handler `store`, linhas ~103-116)
- Modify: `whatsapp-api/src/services/InboundServices/ProcessInboundMessage.ts` (após `SaveInboundMessageService`, ~linha 343; e no `send` do agente de IA, ~linha 452)
- Modify: `whatsapp-api/src/services/TicketServices/UpdateTicketService.ts` (início do ramo `closed`, ~linha 112; depois de `ticket.reload()`, ~linha 365)
- Test: `whatsapp-api/src/services/InboundServices/__tests__/ProcessInboundMessage.spec.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `followUpOnAgentMessage`, `followUpOnCustomerMessage`, `followUpOnTicketChanged` (Task 5, `services/FollowUpServices/hooks.ts`).

- [ ] **Step 1: Ler o spec existente de `ProcessInboundMessage` para seguir os mocks dele**

Run: `sed -n 1,80p whatsapp-api/src/services/InboundServices/__tests__/ProcessInboundMessage.spec.ts`
Anotar como ele monta `inbound`, `ticket` e mocka `SaveInboundMessageService`/`provider`.

- [ ] **Step 2: Testes que falham** (acrescentar ao arquivo, reaproveitando os helpers dele; nomes `baseInbound`/`run` abaixo são os que o arquivo já usa ou os equivalentes encontrados no Step 1)

```ts
jest.mock("../../FollowUpServices/hooks", () => ({
  followUpOnAgentMessage: jest.fn(),
  followUpOnCustomerMessage: jest.fn()
}));
// eslint-disable-next-line import/first
import { followUpOnAgentMessage, followUpOnCustomerMessage } from "../../FollowUpServices/hooks";

describe("follow-up", () => {
  it("a customer message stops the follow-up", async () => {
    await run({ ...baseInbound, fromMe: false });
    expect(followUpOnCustomerMessage).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(Number) }));
    expect(followUpOnAgentMessage).not.toHaveBeenCalled();
  });
  it("a message typed on the phone starts the follow-up", async () => {
    await run({ ...baseInbound, fromMe: true });
    expect(followUpOnAgentMessage).toHaveBeenCalled();
  });
  it("history imports and groups never touch the follow-up", async () => {
    await run({ ...baseInbound, history: true });
    await run(groupInbound); // inbound de grupo, montado como o arquivo já monta os casos de grupo
    expect(followUpOnAgentMessage).not.toHaveBeenCalled();
    expect(followUpOnCustomerMessage).not.toHaveBeenCalled();
  });
});
```
Run: `cd whatsapp-api && NODE_ENV=test npx jest src/services/InboundServices/__tests__/ProcessInboundMessage.spec.ts`
Expected: FAIL nos três novos casos.

- [ ] **Step 3: Implementar em `ProcessInboundMessage.ts`**

Import: `import { followUpOnAgentMessage, followUpOnCustomerMessage } from "../FollowUpServices/hooks";`

Substituir:
```ts
    await SaveInboundMessageService(inbound, ticket, contact);

    // History import: answering hundreds of old conversations at once looks
    // like spam to WhatsApp and gets the number blocked.
    if (inbound.history) return;
```
por:
```ts
    await SaveInboundMessageService(inbound, ticket, contact);

    // History import: answering hundreds of old conversations at once looks
    // like spam to WhatsApp and gets the number blocked.
    if (inbound.history) return;

    // Follow-up: the customer answered, or we wrote from the phone.
    if (!isGroup) {
      if (inbound.fromMe) await followUpOnAgentMessage(ticket as any);
      else await followUpOnCustomerMessage(ticket);
    }
```
No bloco do agente de IA, trocar o `send`:
```ts
        send: async content => {
          const sent = await SendTicketMessageService(ticket, content);
          await followUpOnAgentMessage(ticket as any);
          return sent;
        }
```

Run: mesmo comando do Step 2 → PASS.

- [ ] **Step 4: `MessageController.store`**

Import: `import { followUpOnAgentMessage } from "../services/FollowUpServices/hooks";`
Depois do `if (medias) {...} else {...}` e antes de `return res.send();`:
```ts
  // The attendant wrote: wait for the customer (internal notes returned above).
  await followUpOnAgentMessage(ticket as any);
```
Conferir que `ticket` nesse handler é o `Ticket` carregado por `ShowTicketService` (tem `status`, `isGroup`, `queueId`, `whatsappId`, `contactId`, `flowId`, `typebotStatus`).

- [ ] **Step 5: `UpdateTicketService`**

Import: `import { followUpOnTicketChanged } from "../FollowUpServices/hooks";`
Primeira linha dentro de `if (status !== undefined && ["closed"].indexOf(status) > -1) {`:
```ts
      // Before the rating/closing messages: nothing more goes to this customer.
      await followUpOnTicketChanged(ticket, { closed: true, queueChanged: false });
```
Logo depois de `await ticket.reload();`:
```ts
    if (oldQueueId !== ticket.queueId || oldWhatsappIdForFollowUp !== ticket.whatsappId) {
      await followUpOnTicketChanged(ticket, { closed: false, queueChanged: true });
    }
```
e, junto de `const oldQueueId = ticket.queueId;` (~linha 79), guardar `const oldWhatsappIdForFollowUp = ticket.whatsappId;`.

- [ ] **Step 6: Compilar e rodar toda a suíte**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && NODE_ENV=test npx jest`
Expected: PASS (mesmas falhas pré-existentes, se houver).

- [ ] **Step 7: Commit**

```bash
git add src/controllers/MessageController.ts src/services/InboundServices src/services/TicketServices/UpdateTicketService.ts
git commit -m "Follow-up: iniciar com atendente, IA e celular; parar com cliente, fechamento e troca de fila"
```

---

### Task 9: Tela de réguas (`whatsapp-app`)

**Files:**
- Create: `whatsapp-app/src/pages/FollowUps/followUpHelpers.js`, `followUpHelpers.test.js`, `index.js`, `RuleEditor.js`
- Modify: `whatsapp-app/src/routes/index.js`, `whatsapp-app/src/layout/MainListItems.js`

**Interfaces:**
- Consumes: API da Task 4 (`/followup-rules`, `/followup-rules/media`), `/queue`, `/tags/list`, `/ai-agents`, `useWhatsApps`, `MessageVariablesPicker` (`onClick(value)`).
- Produces: `UNITS`, `toMinutes(amount, unit)`, `fromMinutes(minutes) -> { amount, unit }`, `delayLabel(minutes)`, `ruleScope(rule, whatsApps, queues)`, `ruleProblem(draft) -> string | null`, `toPayload(draft)`, `emptyStep()`, `responseRate(rule)`.

- [ ] **Step 1: Branch no app**

```bash
cd whatsapp-app && git checkout main && git pull --ff-only && git checkout -b feat/followup-reguas
```

- [ ] **Step 2: Teste dos helpers que falha**

```js
import { toMinutes, fromMinutes, delayLabel, ruleScope, ruleProblem, toPayload, emptyStep, responseRate } from "./followUpHelpers";

describe("tempo de espera", () => {
  it("converte para minutos e volta para a maior unidade exata", () => {
    expect(toMinutes(2, "hours")).toBe(120);
    expect(toMinutes(3, "days")).toBe(4320);
    expect(fromMinutes(4320)).toEqual({ amount: 3, unit: "days" });
    expect(fromMinutes(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(fromMinutes(120)).toEqual({ amount: 2, unit: "hours" });
  });
  it("descreve a espera", () => {
    expect(delayLabel(60)).toBe("1 hora");
    expect(delayLabel(2880)).toBe("2 dias");
    expect(delayLabel(30)).toBe("30 minutos");
  });
});

describe("ruleScope", () => {
  const whatsApps = [{ id: 2, name: "Comercial" }];
  const queues = [{ id: 3, name: "Vendas" }];
  it("mostra conexão e fila, ou todas", () => {
    expect(ruleScope({ whatsappId: 2, queueId: 3 }, whatsApps, queues)).toBe("Comercial · Vendas");
    expect(ruleScope({ whatsappId: null, queueId: 3 }, whatsApps, queues)).toBe("Qualquer conexão · Vendas");
    expect(ruleScope({ whatsappId: null, queueId: null }, whatsApps, queues)).toBe("Todas as conversas");
  });
});

describe("ruleProblem", () => {
  const ok = { name: "Orçamento", aiAgentId: "", steps: [{ ...emptyStep(), body: "Oi" }] };
  it("aceita uma régua válida", () => expect(ruleProblem(ok)).toBeNull());
  it("aponta o que falta", () => {
    expect(ruleProblem({ ...ok, name: " " })).toBe("Dê um nome à régua.");
    expect(ruleProblem({ ...ok, steps: [] })).toBe("Adicione pelo menos uma etapa.");
    expect(ruleProblem({ ...ok, steps: [{ ...emptyStep(), body: "" }] })).toBe("Etapa 1: escreva a mensagem.");
    expect(ruleProblem({ ...ok, steps: [{ ...emptyStep(), body: "Oi", amount: 0 }] })).toBe("Etapa 1: o tempo de espera precisa ser maior que zero.");
    expect(ruleProblem({ ...ok, steps: [{ ...emptyStep(), body: "Oi", mode: "ai", aiInstruction: "" }] })).toBe("Etapa 1: escreva a instrução para a IA.");
    expect(ruleProblem({ ...ok, steps: [{ ...emptyStep(), body: "Oi", mode: "ai", aiInstruction: "Retome" }] })).toBe("Escolha o agente de IA que vai escrever as mensagens.");
  });
});

describe("toPayload", () => {
  it("monta o corpo da API com minutos e ids vazios como null", () => {
    const draft = {
      name: " Orçamento ", active: true, whatsappId: "", queueId: 3, respectBusinessHours: true, aiAgentId: "",
      closeTicket: true, tagId: "",
      steps: [{ ...emptyStep(), amount: 2, unit: "hours", body: "Oi", mediaPath: null, mediaName: null }]
    };
    expect(toPayload(draft)).toEqual({
      name: "Orçamento", active: true, whatsappId: null, queueId: 3, respectBusinessHours: true, aiAgentId: null,
      finalActions: { closeTicket: true, tagId: null },
      steps: [{ delayMinutes: 120, mode: "text", body: "Oi", mediaPath: null, mediaName: null, aiInstruction: null }]
    });
  });
});

describe("responseRate", () => {
  it("calcula a taxa de resposta", () => {
    expect(responseRate({ enrolled: 0, replied: 0 })).toBe("—");
    expect(responseRate({ enrolled: 8, replied: 2 })).toBe("25%");
  });
});
```

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FollowUps`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `followUpHelpers.js`**

```js
export const UNITS = [
  { value: "minutes", label: "minutos", minutes: 1, one: "minuto" },
  { value: "hours", label: "horas", minutes: 60, one: "hora" },
  { value: "days", label: "dias", minutes: 1440, one: "dia" },
];

const unitOf = (value) => UNITS.find((u) => u.value === value) || UNITS[0];

export const toMinutes = (amount, unit) => Math.round(Number(amount) * unitOf(unit).minutes);

export const fromMinutes = (minutes) => {
  const unit = [...UNITS].reverse().find((u) => minutes % u.minutes === 0) || UNITS[0];
  return { amount: minutes / unit.minutes, unit: unit.value };
};

export const delayLabel = (minutes) => {
  const { amount, unit } = fromMinutes(minutes);
  const u = unitOf(unit);
  return `${amount} ${amount === 1 ? u.one : u.label}`;
};

export const emptyStep = () => ({
  amount: 1, unit: "hours", mode: "text", body: "", mediaPath: null, mediaName: null, aiInstruction: "",
});

const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name;

export const ruleScope = (rule, whatsApps, queues) => {
  if (!rule.whatsappId && !rule.queueId) return "Todas as conversas";
  const connection = rule.whatsappId ? nameOf(whatsApps, rule.whatsappId) || "Conexão removida" : "Qualquer conexão";
  const queue = rule.queueId ? nameOf(queues, rule.queueId) || "Fila removida" : "Qualquer fila";
  return `${connection} · ${queue}`;
};

export const ruleProblem = (draft) => {
  if (!String(draft.name || "").trim()) return "Dê um nome à régua.";
  if (!draft.steps || draft.steps.length === 0) return "Adicione pelo menos uma etapa.";
  for (let i = 0; i < draft.steps.length; i += 1) {
    const s = draft.steps[i];
    if (!(Number(s.amount) > 0)) return `Etapa ${i + 1}: o tempo de espera precisa ser maior que zero.`;
    if (!String(s.body || "").trim()) return `Etapa ${i + 1}: escreva a mensagem.`;
    if (s.mode === "ai" && !String(s.aiInstruction || "").trim()) return `Etapa ${i + 1}: escreva a instrução para a IA.`;
  }
  if (draft.steps.some((s) => s.mode === "ai") && !draft.aiAgentId) return "Escolha o agente de IA que vai escrever as mensagens.";
  return null;
};

const idOrNull = (v) => (v === "" || v === undefined || v === null ? null : v);

export const toPayload = (draft) => ({
  name: String(draft.name || "").trim(),
  active: draft.active !== false,
  whatsappId: idOrNull(draft.whatsappId),
  queueId: idOrNull(draft.queueId),
  respectBusinessHours: draft.respectBusinessHours !== false,
  aiAgentId: idOrNull(draft.aiAgentId),
  finalActions: { closeTicket: !!draft.closeTicket, tagId: idOrNull(draft.tagId) },
  steps: draft.steps.map((s) => ({
    delayMinutes: toMinutes(s.amount, s.unit),
    mode: s.mode,
    body: s.body,
    mediaPath: s.mediaPath || null,
    mediaName: s.mediaName || null,
    aiInstruction: s.mode === "ai" ? s.aiInstruction : null,
  })),
});

export const fromRule = (rule) => ({
  id: rule.id,
  name: rule.name,
  active: rule.active,
  whatsappId: rule.whatsappId || "",
  queueId: rule.queueId || "",
  respectBusinessHours: rule.respectBusinessHours,
  aiAgentId: rule.aiAgentId || "",
  closeTicket: !!(rule.finalActions || {}).closeTicket,
  tagId: (rule.finalActions || {}).tagId || "",
  steps: (rule.steps || []).map((s) => ({
    ...fromMinutes(s.delayMinutes), mode: s.mode, body: s.body,
    mediaPath: s.mediaPath, mediaName: s.mediaName, aiInstruction: s.aiInstruction || "",
  })),
});

export const emptyRule = () => ({
  name: "", active: true, whatsappId: "", queueId: "", respectBusinessHours: true, aiAgentId: "",
  closeTicket: false, tagId: "", steps: [emptyStep()],
});

export const responseRate = (rule) =>
  rule.enrolled > 0 ? `${Math.round((rule.replied / rule.enrolled) * 100)}%` : "—";
```

Run: mesmo comando → PASS.

- [ ] **Step 4: `RuleEditor.js`** (diálogo; usa `@material-ui/core`)

```js
import React, { useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import Checkbox from "@material-ui/core/Checkbox";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import ToggleButton from "@material-ui/lab/ToggleButton";
import ToggleButtonGroup from "@material-ui/lab/ToggleButtonGroup";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import ArrowUpwardIcon from "@material-ui/icons/ArrowUpward";
import ArrowDownwardIcon from "@material-ui/icons/ArrowDownward";
import AttachFileIcon from "@material-ui/icons/AttachFile";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import MessageVariablesPicker from "../../components/MessageVariablesPicker";
import { UNITS, emptyStep, ruleProblem, toPayload } from "./followUpHelpers";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    grid: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 },
    grow: { flex: 1, minWidth: 180 },
    section: { margin: "20px 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: t.textTertiary },
    step: { border: `1px solid ${t.border}`, borderRadius: theme.radii.control, padding: 12, marginBottom: 12 },
    stepHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
    stepTitle: { fontWeight: 700, color: t.textPrimary, marginRight: "auto" },
    amount: { width: 90 },
    unit: { width: 120 },
    file: { fontSize: 13, color: t.textSecondary, display: "flex", alignItems: "center", gap: 6, marginTop: 6 },
    warning: { fontSize: 13, color: t.warningText, background: t.warningSoft, padding: "8px 12px", borderRadius: 8 },
    hint: { fontSize: 13, color: t.textSecondary, margin: "4px 0 0" },
  };
});

const RuleEditor = ({ open, initial, rules, whatsApps, queues, tags, agents, onClose, onSaved }) => {
  const classes = useStyles();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setStep = (index, patch) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const moveStep = (index, delta) =>
    setDraft((d) => {
      const steps = [...d.steps];
      const [s] = steps.splice(index, 1);
      steps.splice(index + delta, 0, s);
      return { ...d, steps };
    });

  const upload = async (index, file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post("/followup-rules/media", form);
      setStep(index, data);
    } catch (err) {
      toastError(err);
    }
  };

  const problem = ruleProblem(draft);
  const duplicate = rules.find(
    (r) => r.id !== draft.id && r.active && (r.whatsappId || "") === (draft.whatsappId || "") && (r.queueId || "") === (draft.queueId || "")
  );

  const save = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const payload = toPayload(draft);
      if (draft.id) await api.put(`/followup-rules/${draft.id}`, payload);
      else await api.post("/followup-rules", payload);
      onSaved();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>{draft.id ? "Editar régua" : "Nova régua de follow-up"}</DialogTitle>
      <DialogContent dividers>
        <div className={classes.grid}>
          <TextField label="Nome" variant="outlined" size="small" className={classes.grow} value={draft.name}
            onChange={(e) => set({ name: e.target.value })} inputProps={{ maxLength: 120 }} />
          <TextField select label="Conexão" variant="outlined" size="small" className={classes.grow}
            value={draft.whatsappId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
            onChange={(e) => set({ whatsappId: e.target.value })}>
            <MenuItem value="">Qualquer conexão</MenuItem>
            {whatsApps.map((w) => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
          </TextField>
          <TextField select label="Fila" variant="outlined" size="small" className={classes.grow}
            value={draft.queueId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
            onChange={(e) => set({ queueId: e.target.value })}>
            <MenuItem value="">Qualquer fila</MenuItem>
            {queues.map((q) => <MenuItem key={q.id} value={q.id}>{q.name}</MenuItem>)}
          </TextField>
        </div>
        <FormControlLabel
          control={<Checkbox color="primary" checked={draft.respectBusinessHours}
            onChange={(e) => set({ respectBusinessHours: e.target.checked })} />}
          label="Respeitar horário de atendimento"
        />
        <p className={classes.hint}>
          Fora do horário, a mensagem espera a próxima abertura. Usa o horário da empresa ou da fila, conforme as configurações.
        </p>
        {duplicate && (
          <div className={classes.warning}>
            A régua "{duplicate.name}" já vale para esta mesma conexão e fila. Só uma delas será usada (a mais antiga).
          </div>
        )}

        <p className={classes.section}>Etapas</p>
        {draft.steps.map((step, index) => (
          <div key={index} className={classes.step}>
            <div className={classes.stepHead}>
              <span className={classes.stepTitle}>Etapa {index + 1}</span>
              <span>Aguardar</span>
              <TextField type="number" size="small" variant="outlined" className={classes.amount} value={step.amount}
                inputProps={{ min: 1, "aria-label": `Tempo de espera da etapa ${index + 1}` }}
                onChange={(e) => setStep(index, { amount: e.target.value })} />
              <TextField select size="small" variant="outlined" className={classes.unit} value={step.unit}
                onChange={(e) => setStep(index, { unit: e.target.value })}>
                {UNITS.map((u) => <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>)}
              </TextField>
              <span>{index === 0 ? "após a última mensagem nossa" : "após o envio anterior"}</span>
              <IconButton size="small" aria-label="Subir etapa" disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label="Descer etapa" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label="Remover etapa" disabled={draft.steps.length === 1}
                onClick={() => set({ steps: draft.steps.filter((_, i) => i !== index) })}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </div>
            <ToggleButtonGroup size="small" exclusive value={step.mode}
              onChange={(e, mode) => mode && setStep(index, { mode })} aria-label="Quem escreve a mensagem">
              <ToggleButton value="text">Texto fixo</ToggleButton>
              <ToggleButton value="ai">IA</ToggleButton>
            </ToggleButtonGroup>
            {step.mode === "ai" && (
              <TextField fullWidth multiline minRows={2} margin="dense" variant="outlined" label="Instrução para a IA"
                placeholder="Ex.: retome o orçamento enviado de forma leve e pergunte se ficou alguma dúvida"
                value={step.aiInstruction} onChange={(e) => setStep(index, { aiInstruction: e.target.value })} />
            )}
            <TextField fullWidth multiline minRows={3} margin="dense" variant="outlined"
              label={step.mode === "ai" ? "Texto fixo (enviado se a IA falhar)" : "Mensagem"}
              value={step.body} onChange={(e) => setStep(index, { body: e.target.value })} />
            <MessageVariablesPicker onClick={(value) => setStep(index, { body: `${step.body}${value}` })} disabled={false} />
            <div className={classes.file}>
              <Button size="small" component="label" startIcon={<AttachFileIcon />}>
                {step.mediaPath ? "Trocar anexo" : "Anexar arquivo"}
                <input hidden type="file" onChange={(e) => upload(index, e.target.files[0])} />
              </Button>
              {step.mediaPath && (
                <>
                  <span>{step.mediaName}</span>
                  <Button size="small" onClick={() => setStep(index, { mediaPath: null, mediaName: null })}>Remover</Button>
                </>
              )}
            </div>
          </div>
        ))}
        <Button size="small" disabled={draft.steps.length >= 10} onClick={() => set({ steps: [...draft.steps, emptyStep()] })}>
          + Adicionar etapa
        </Button>

        {draft.steps.some((s) => s.mode === "ai") && (
          <TextField select fullWidth margin="normal" size="small" variant="outlined" label="Agente de IA"
            helperText="A chave, o modelo e o prompt deste agente escrevem as etapas em modo IA."
            value={draft.aiAgentId} onChange={(e) => set({ aiAgentId: e.target.value })}>
            {agents.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
          </TextField>
        )}

        <p className={classes.section}>Quando terminar sem resposta</p>
        <FormControlLabel
          control={<Checkbox color="primary" checked={draft.closeTicket} onChange={(e) => set({ closeTicket: e.target.checked })} />}
          label="Fechar o ticket"
        />
        <TextField select size="small" variant="outlined" label="Aplicar tag" className={classes.grow} style={{ minWidth: 220 }}
          value={draft.tagId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
          onChange={(e) => set({ tagId: e.target.value })}>
          <MenuItem value="">Nenhuma</MenuItem>
          {tags.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions>
        {problem && <span className={classes.hint} style={{ marginRight: "auto", paddingLeft: 16 }}>{problem}</span>}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" color="primary" disabled={!!problem || saving} onClick={save}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RuleEditor;
```

Conferir antes: `@material-ui/lab` está no `package.json` do app (`grep '"@material-ui/lab"' whatsapp-app/package.json`); se não estiver, trocar o `ToggleButtonGroup` por dois `Button` com `variant={step.mode === "text" ? "contained" : "outlined"}`. Conferir também as props reais do `MessageVariablesPicker` (`sed -n 1,25p src/components/MessageVariablesPicker/index.js`) e ajustar `onClick`/`disabled` se necessário.

- [ ] **Step 5: Página `index.js`**

```js
import React, { useCallback, useContext, useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import Switch from "@material-ui/core/Switch";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import ConfirmationModal from "../../components/ConfirmationModal";
import { AuthContext } from "../../context/Auth/AuthContext";
import useWhatsApps from "../../hooks/useWhatsApps";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import RuleEditor from "./RuleEditor";
import { delayLabel, emptyRule, fromRule, responseRate, ruleScope } from "./followUpHelpers";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    panel: {
      flex: 1, minHeight: 0, overflowY: "auto", padding: 24, backgroundColor: t.surface,
      border: `1px solid ${t.border}`, borderRadius: theme.radii.panel, ...theme.scrollbarStylesSoft,
    },
    hint: { fontSize: 13, color: t.textSecondary, margin: "0 0 16px", maxWidth: 680 },
    list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, maxWidth: 820 },
    row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `1px solid ${t.border}`, borderRadius: theme.radii.control },
    text: { flex: 1, minWidth: 0 },
    name: { fontWeight: 600, color: t.textPrimary },
    meta: { fontSize: 13, color: t.textSecondary },
    rate: { fontSize: 13, color: t.textSecondary, minWidth: 110, textAlign: "right" },
    empty: { fontSize: 14, color: t.textTertiary },
    denied: { padding: 24, color: t.textSecondary },
  };
});

const FollowUps = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const { whatsApps } = useWhatsApps();
  const [rules, setRules] = useState([]);
  const [queues, setQueues] = useState([]);
  const [tags, setTags] = useState([]);
  const [agents, setAgents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/followup-rules");
      setRules(data);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => {
    if (user.profile !== "admin") return;
    load();
    api.get("/queue").then(({ data }) => setQueues(data)).catch(() => setQueues([]));
    api.get("/tags/list").then(({ data }) => setTags(data)).catch(() => setTags([]));
    // Agents are a plan feature: without it the list is just empty.
    api.get("/ai-agents").then(({ data }) => setAgents(Array.isArray(data) ? data : data.agents || [])).catch(() => setAgents([]));
  }, [load, user.profile]);

  if (user.profile !== "admin") {
    return (
      <MainContainer>
        <div className={classes.denied}>Somente administradores podem configurar o follow-up.</div>
      </MainContainer>
    );
  }

  const setActive = async (rule, active) => {
    setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, active } : r)));
    try {
      await api.put(`/followup-rules/${rule.id}`, { active });
    } catch (err) {
      toastError(err);
    }
    load();
  };

  const remove = async () => {
    const rule = removing;
    setRemoving(null);
    try {
      await api.delete(`/followup-rules/${rule.id}`);
    } catch (err) {
      toastError(err);
    }
    load();
  };

  return (
    <MainContainer>
      <MainHeader>
        <Title>Follow-up</Title>
        <MainHeaderButtonsWrapper>
          <Button variant="contained" color="primary" onClick={() => setEditing(emptyRule())}>Nova régua</Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>
      <div className={classes.panel}>
        <p className={classes.hint}>
          Quando o atendente ou o agente de IA manda a última mensagem e o cliente não responde, a régua envia as etapas
          nos tempos definidos. Se o cliente responder, a régua para. Mensagens automáticas (transferência, avaliação,
          fora de horário) não iniciam a régua.
        </p>
        {rules.length === 0 ? (
          <p className={classes.empty}>Nenhuma régua. Crie a primeira para retomar conversas paradas.</p>
        ) : (
          <ul className={classes.list}>
            {rules.map((rule) => (
              <li key={rule.id} className={classes.row}>
                <div className={classes.text}>
                  <div className={classes.name}>{rule.name}</div>
                  <div className={classes.meta}>
                    {ruleScope(rule, whatsApps, queues)} · {rule.stepCount} {rule.stepCount === 1 ? "etapa" : "etapas"}
                    {rule.steps?.length ? ` · primeira após ${delayLabel(rule.steps[0].delayMinutes)}` : ""}
                  </div>
                </div>
                <span className={classes.rate} title="Conversas em que o cliente respondeu a alguma etapa">
                  Resposta: {responseRate(rule)}
                </span>
                <Switch color="primary" checked={rule.active} onChange={(e) => setActive(rule, e.target.checked)}
                  inputProps={{ "aria-label": `Régua ${rule.name} ativa` }} />
                <Button size="small" onClick={() => setEditing(fromRule(rule))}>Editar</Button>
                <Button size="small" onClick={() => setRemoving(rule)}>Excluir</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <RuleEditor
          open
          initial={editing}
          rules={rules}
          whatsApps={whatsApps}
          queues={queues}
          tags={tags}
          agents={agents}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <ConfirmationModal title="Excluir esta régua?" open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove}>
        Conversas em andamento nesta régua param de receber as próximas etapas. Para pausar sem perder a régua, desligue a chave.
      </ConfirmationModal>
    </MainContainer>
  );
};

export default FollowUps;
```

Conferir o formato de `GET /ai-agents` (`grep -n "index" -A12 whatsapp-api/src/controllers/AiAgentController.ts`) e de `GET /tags/list`; ajustar o `setAgents`/`setTags` ao formato real. Conferir que `MainHeader`, `Title` e `MainHeaderButtonsWrapper` são usados assim em outra página (ex.: `pages/Tags/index.js`).

- [ ] **Step 6: Rota e menu**

`routes/index.js`: `import FollowUps from "../pages/FollowUps";` e, junto de `/schedules`:
```js
                <Route exact path="/followups" component={FollowUps} isPrivate />
```
`layout/MainListItems.js`, dentro do `<Can role={user.profile} perform="drawer-admin-items:view" yes={() => (<>` da seção "Ferramentas", antes de `showFlowBuilder`:
```js
              <NavItem to="/followups" primary="Follow-up" icon={<ReplayIcon />} />
```
com `import ReplayIcon from "@material-ui/icons/Replay";` (ou o ícone equivalente de `layout/icons` se o menu usar só ícones próprios — conferir os imports do topo do arquivo e seguir o padrão).

- [ ] **Step 7: Verificar no navegador**

Subir o app (preview/dev server do projeto apontando para a API local com as Tasks 1–8) e, logado como admin: abrir `/followups`, criar régua com 2 etapas (uma texto com `{{firstName}}` e anexo, uma IA), salvar, editar, desligar a chave, excluir. Conferir no console do navegador que não há erros e, no tema escuro, que os textos têm contraste. Tirar screenshot da lista e do editor.

- [ ] **Step 8: Rodar testes e commit**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FollowUps`
Expected: PASS.
```bash
git add src/pages/FollowUps src/routes/index.js src/layout/MainListItems.js
git commit -m "Follow-up: tela de réguas"
```

---

### Task 10: Selo de follow-up na conversa e marca nas mensagens

**Files:**
- Create: `whatsapp-app/src/components/TicketFollowUp/followUpLabel.js`, `followUpLabel.test.js`, `index.js`
- Modify: `whatsapp-app/src/components/Ticket/index.js` (ao lado de `<TicketDeals ticket={ticket} />`), `whatsapp-app/src/components/MessagesList/index.js` (perto de `renderForwardedLabel`, linhas ~667 e ~850/897)

**Interfaces:**
- Consumes: `GET/DELETE /tickets/:ticketId/followup`, evento `company-{id}-followup` `{ ticketId, followUp }` (Task 5); `message.followUpEnrollmentId`.
- Produces: `followUpLabel(followUp, now) -> string`.

- [ ] **Step 1: Teste que falha**

```js
import { followUpLabel } from "./followUpLabel";

const now = new Date(2026, 9, 5, 10, 0);

describe("followUpLabel", () => {
  it("mostra etapa e próximo envio hoje", () => {
    expect(followUpLabel({ currentStep: 2, totalSteps: 3, nextRunAt: new Date(2026, 9, 5, 14, 0).toISOString() }, now))
      .toBe("Follow-up: etapa 2 de 3 · próximo envio hoje 14:00");
  });
  it("usa amanhã e data para outros dias", () => {
    expect(followUpLabel({ currentStep: 1, totalSteps: 2, nextRunAt: new Date(2026, 9, 6, 8, 0).toISOString() }, now))
      .toBe("Follow-up: etapa 1 de 2 · próximo envio amanhã 08:00");
    expect(followUpLabel({ currentStep: 1, totalSteps: 2, nextRunAt: new Date(2026, 9, 12, 8, 0).toISOString() }, now))
      .toBe("Follow-up: etapa 1 de 2 · próximo envio 12/10 08:00");
  });
  it("diz em instantes quando já venceu", () => {
    expect(followUpLabel({ currentStep: 1, totalSteps: 1, nextRunAt: new Date(2026, 9, 5, 9, 0).toISOString() }, now))
      .toBe("Follow-up: etapa 1 de 1 · próximo envio em instantes");
  });
});
```
Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/components/TicketFollowUp`
Expected: FAIL.

- [ ] **Step 2: Implementar `followUpLabel.js`**

```js
const pad = (n) => String(n).padStart(2, "0");
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const followUpLabel = (followUp, now = new Date()) => {
  const at = new Date(followUp.nextRunAt);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  let when;
  if (at <= now) when = "em instantes";
  else if (sameDay(at, now)) when = `hoje ${time}`;
  else if (sameDay(at, tomorrow)) when = `amanhã ${time}`;
  else when = `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${time}`;
  return `Follow-up: etapa ${followUp.currentStep} de ${followUp.totalSteps} · próximo envio ${when}`;
};
```
Run: PASS.

- [ ] **Step 3: Componente `TicketFollowUp/index.js`**

```js
import React, { useCallback, useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import ScheduleIcon from "@material-ui/icons/Schedule";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import { socketConnection } from "../../services/socket";
import { followUpLabel } from "./followUpLabel";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    root: {
      display: "inline-flex", alignItems: "center", gap: 6, margin: "0 8px 4px", padding: "2px 4px 2px 10px",
      borderRadius: 999, border: `1px solid ${t.border}`, backgroundColor: t.surface, color: t.textSecondary, fontSize: 12,
    },
    icon: { fontSize: 14 },
    cancel: { textTransform: "none", fontSize: 12, padding: "0 6px", minWidth: 0 },
  };
});

const TicketFollowUp = ({ ticket }) => {
  const classes = useStyles();
  const [followUp, setFollowUp] = useState(null);

  const load = useCallback(async () => {
    if (!ticket?.id) return;
    try {
      const { data } = await api.get(`/tickets/${ticket.id}/followup`);
      setFollowUp(data || null);
    } catch (err) {
      setFollowUp(null);
    }
  }, [ticket?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ticket?.id) return undefined;
    const companyId = localStorage.getItem("companyId");
    const socket = socketConnection({ companyId });
    socket.on(`company-${companyId}-followup`, (data) => {
      if (data.ticketId === ticket.id) setFollowUp(data.followUp || null);
    });
    return () => socket.disconnect();
  }, [ticket?.id]);

  if (!followUp) return null;

  const cancel = async () => {
    try {
      await api.delete(`/tickets/${ticket.id}/followup`);
      setFollowUp(null);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <span className={classes.root} title={`Régua: ${followUp.ruleName}`}>
      <ScheduleIcon className={classes.icon} />
      {followUpLabel(followUp)}
      <Button size="small" className={classes.cancel} onClick={cancel} aria-label="Cancelar follow-up desta conversa">
        Cancelar
      </Button>
    </span>
  );
};

export default TicketFollowUp;
```

Em `components/Ticket/index.js`: `import TicketFollowUp from "../TicketFollowUp";` e dentro do `<Paper>`, depois de `<TicketDeals ticket={ticket} />`: `<TicketFollowUp ticket={ticket} />`.

- [ ] **Step 4: Marca nas mensagens**

Em `components/MessagesList/index.js`, junto de `renderForwardedLabel`:
```js
  const renderFollowUpLabel = () => (
    <span className={classes.forwardedLabel} title="Enviada pela régua de follow-up">
      <ScheduleIcon style={{ fontSize: 14 }} />
      Follow-up
    </span>
  );
```
com `import ScheduleIcon from "@material-ui/icons/Schedule";`, e ao lado das duas ocorrências de `{message.isForwarded && renderForwardedLabel()}` (só a da mensagem `fromMe` precisa, mas manter nas duas não faz mal): `{message.followUpEnrollmentId && renderFollowUpLabel()}`.

- [ ] **Step 5: Verificar no navegador**

Com uma régua de 1 minuto ativa no HM: mandar mensagem como atendente num ticket de teste → selo aparece com "etapa 1 de N"; ao chegar o envio, a mensagem mostra "Follow-up" e o selo avança; clicar Cancelar → selo some. Screenshot.

- [ ] **Step 6: Testes e commit**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/components/TicketFollowUp src/pages/FollowUps`
Expected: PASS.
```bash
git add src/components/TicketFollowUp src/components/Ticket/index.js src/components/MessagesList/index.js
git commit -m "Follow-up: selo na conversa e marca nas mensagens"
```

---

### Task 11: Homologação ponta a ponta (HM local)

**Files:** nenhum código; registrar resultado na memória do projeto ao final.

- [ ] **Step 1: Subir API e app das branches no Docker do HM** — fluxo do HM: build da API e do app, `npx sequelize db:migrate` no container da API, restart. Conferir no log da API `Iniciando processamento de filas` e, 30s depois, nenhum erro de `FollowUpMonitor`.
- [ ] **Step 2: Cenário "cliente responde"** — régua na fila de teste com etapas 1 min / 1 min; atendente responde; antes de 1 min o cliente (outro WhatsApp real) responde → inscrição `replied`, nada enviado. `SELECT status, "stopReason" FROM "FollowUpEnrollments" ORDER BY id DESC LIMIT 3;`
- [ ] **Step 3: Cenário "sem resposta até o fim"** — etapas saem em ~1 min cada (com tolerância de até 30s do ciclo), a última aplica a tag e fecha o ticket; a mensagem de encerramento da conexão sai normalmente; inscrição `completed`.
- [ ] **Step 4: Cenário "fora do horário"** — horário da empresa/fila fechado agora → `nextRunAt` vai para a próxima abertura.
- [ ] **Step 5: Cenário "mensagem automática"** — transferir o ticket para outra fila (gera aviso automático) → inscrição `cancelled`/`queue_changed`, nenhuma nova até o atendente escrever.
- [ ] **Step 6: Cenário IA** — etapa em modo IA com o agente do HM (a chave OpenAI do HM está inválida, então deve sair o **texto fixo** e o log deve registrar "AI failed"/"AI unavailable"); com chave válida, a mensagem gerada sai.
- [ ] **Step 7: Relatar ao usuário** com prints e o resultado de cada cenário; **não** fazer merge/push na `main` sem ok explícito.
