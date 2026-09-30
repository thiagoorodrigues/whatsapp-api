# CRM etapa 1 — Base (dados, API e plano) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar as tabelas, as regras e a API do CRM (funis, colunas, negócios, histórico, motivos de perda) e liberar o módulo por plano, sem telas de CRM ainda.

**Architecture:** Regras puras (visibilidade, posição, mudança de coluna, ordem das colunas) ficam em `src/services/CrmServices/*.ts` sem acesso ao banco e com testes jest. Serviços por agregado (`FunnelService`, `DealService`, `LossReasonService`) usam os models sequelize-typescript e chamam essas regras. Um controller e um arquivo de rotas expõem `/crm/...` com `isAuth` + `requirePlanFeature("useCrm")`.

**Tech Stack:** Node 24, Express, sequelize-typescript (Postgres 18), jest + ts-jest, socket.io; frontend React 17 + Material-UI 4 (só a tela de Planos nesta etapa).

**Spec:** `docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md` (passo 1 da "Ordem de entrega"). Esta etapa **não** inclui `FunnelRules` além da tabela (a API e a aplicação das regras são o passo 5), nem telas de funil (passos 2–4).

## Global Constraints

- Toda tabela nova tem `companyId` (FK `Companies`, `ON DELETE CASCADE`), `createdAt`, `updatedAt`.
- Toda consulta a Funnels/FunnelStages/Deals/DealEvents/LossReasons filtra por `companyId` do `req.user`; item de outra empresa ou fora da visão do usuário responde **404**, nunca 403.
- Todas as rotas `/crm/*`: `isAuth`, depois `requirePlanFeature("useCrm")`. Configuração (funis, colunas, motivos de perda) exige `req.user.profile === "admin"` → `ERR_NO_PERMISSION` (403).
- `Plans.useCrm` BOOLEAN padrão **false**; `Plans.crmFunnels` INTEGER padrão **1**; `0` = ilimitado.
- Colunas `kind`: `open` | `won` | `lost`; cada funil tem exatamente uma `won` e uma `lost`, sempre depois das `open`.
- Colunas padrão de funil novo: Lead, Qualificação, Proposta, Negociação (`open`), Ganho (`won`), Perdido (`lost`).
- Motivos de perda padrão: Preço, Concorrente, Sem resposta, Sem interesse, Outro.
- Origens (lista fixa): `ad` Anúncio, `instagram` Instagram, `site` Site, `referral` Indicação, `whatsapp` WhatsApp direto, `other` Outro.
- Códigos de erro: `ERR_CRM_FUNNEL_LIMIT` (403), `ERR_CRM_LOSS_REASON_REQUIRED` (400), `ERR_CRM_STAGE_NOT_EMPTY` (400), `ERR_CRM_STAGE_LOCKED` (400), `ERR_CRM_STAGE_ORDER` (400, novo: lista de reordenação não bate com as colunas abertas).
- Evento de tempo real: `company-${companyId}-deal` `{ action: "create" | "update" | "delete", deal }` e `company-${companyId}-funnel` `{ action: "update", funnelId }`, via `getIO().emit`.
- Comentários de código em inglês, curtos, como o resto do repositório; mensagens de commit em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Não dar push: push na `main` publica em produção. Commits locais; publicar só com o usuário.

## Review Focus

1. **Negócio de outra empresa por id** (`GET/PUT /crm/deals/:id`, `PUT .../move` com `stageId` de outro funil ou empresa) → 404. Coberto por `findVisibleDeal`/`findVisibleStage` sempre com `companyId` e pelo teste de `visibility.spec.ts`.
2. **Soltar em Perdido sem motivo, ou com motivo inativo/de outra empresa** → 400 `ERR_CRM_LOSS_REASON_REQUIRED`. Teste em `transition.spec.ts`; checagem do motivo em `DealService.moveDeal`.
3. **Muitos movimentos seguidos entre os mesmos dois cards** (posições colam) → a coluna é renumerada e a ordem se mantém. Teste em `position.spec.ts` (`needsRenumber`, `renumber`).
4. **Usuário sem fila, funil sem fila, e `ownDealsOnly`** → usuário sem fila não vê funil nenhum; funil sem fila só admin; com `ownDealsOnly` vê só os seus e os sem responsável. Testes em `visibility.spec.ts`.
5. **Plano desligado com a empresa já tendo dados** → toda rota `/crm` responde 403 `ERR_PLAN_FEATURE_NOT_AVAILABLE`, e os dados continuam no banco. Coberto pelo `requirePlanFeature` já testado; conferido no smoke test da Task 8.

---

## Estrutura de arquivos

**Backend (`whatsapp-api`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/database/migrations/20260930160000-create-crm.ts` | cria as 7 tabelas, colunas de plano e motivos padrão para empresas existentes |
| `src/models/Funnel.ts`, `FunnelStage.ts`, `FunnelQueue.ts`, `Deal.ts`, `DealEvent.ts`, `LossReason.ts`, `FunnelRule.ts` | models |
| `src/database/index.ts` | registrar os models |
| `src/models/Plan.ts`, `src/helpers/planFeature.ts`, `src/services/PlanService/CreatePlanService.ts`, `UpdatePlanService.ts`, `src/controllers/PlanController.ts` | `useCrm`, `crmFunnels` |
| `src/services/CrmServices/defaults.ts` | colunas, origens e motivos padrão |
| `src/services/CrmServices/visibility.ts` | regras puras de quem vê o quê |
| `src/services/CrmServices/position.ts` | posição entre vizinhos e renumeração |
| `src/services/CrmServices/transition.ts` | efeito de mudar de coluna |
| `src/services/CrmServices/stages.ts` | ordenar colunas e validar reordenação |
| `src/services/CrmServices/viewer.ts` | monta o `Viewer` a partir de `req.user` (consulta filas) |
| `src/services/CrmServices/LossReasonService.ts` | CRUD + `seedLossReasons` |
| `src/services/CrmServices/FunnelService.ts` | funis e colunas |
| `src/services/CrmServices/DealService.ts` | negócios, movimento, histórico, emissão de eventos |
| `src/services/CompanyService/CreateCompanyService.ts` | semear motivos na empresa nova |
| `src/controllers/CrmController.ts` | handlers HTTP |
| `src/routes/crmRoutes.ts`, `src/routes/index.ts` | rotas |
| `src/services/CrmServices/__tests__/*.spec.ts` | testes das regras puras |

**Frontend (`whatsapp-app`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/components/PlansManager/index.js` | item "CRM / Funil de vendas" e campo "Limite de funis" |

---

### Task 1: Tabelas, models e campos de plano

**Files:**
- Create: `whatsapp-api/src/database/migrations/20260930160000-create-crm.ts`
- Create: `whatsapp-api/src/models/Funnel.ts`, `FunnelStage.ts`, `FunnelQueue.ts`, `Deal.ts`, `DealEvent.ts`, `LossReason.ts`, `FunnelRule.ts`
- Modify: `whatsapp-api/src/database/index.ts` (imports e array `models`)
- Modify: `whatsapp-api/src/models/Plan.ts` (após `useAiAgents`)
- Modify: `whatsapp-api/src/helpers/planFeature.ts` (tipo `PlanFeature`)
- Modify: `whatsapp-api/src/services/PlanService/CreatePlanService.ts`, `UpdatePlanService.ts` (interface `PlanData`), `whatsapp-api/src/controllers/PlanController.ts` (tipos `StorePlanData`/`UpdatePlanData`)

**Interfaces:**
- Produces: models `Funnel`, `FunnelStage`, `FunnelQueue`, `Deal`, `DealEvent`, `LossReason`, `FunnelRule`; tipos `StageKind = "open" | "won" | "lost"`, `DealStatus = StageKind`, `DealEventType`; `PlanFeature` inclui `"useCrm"`; `Plan.crmFunnels: number`.

- [ ] **Step 1: Escrever a migration**

```ts
import { QueryInterface, DataTypes, QueryTypes } from "sequelize";

const company = {
  type: DataTypes.INTEGER,
  allowNull: false,
  references: { model: "Companies", key: "id" },
  onUpdate: "CASCADE",
  onDelete: "CASCADE"
};
const stamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};
const ref = (model: string, onDelete: "CASCADE" | "SET NULL", allowNull = false) => ({
  type: DataTypes.INTEGER,
  allowNull,
  references: { model, key: "id" },
  onUpdate: "CASCADE",
  onDelete
});

const LOSS_REASONS = ["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"];

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.createTable("Funnels", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        name: { type: DataTypes.STRING, allowNull: false },
        color: { type: DataTypes.STRING, allowNull: false, defaultValue: "#2070F8" },
        position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ownDealsOnly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps
      }, opts);
      await queryInterface.createTable("FunnelStages", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        name: { type: DataTypes.STRING, allowNull: false },
        color: { type: DataTypes.STRING, allowNull: false, defaultValue: "#64748B" },
        position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        kind: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "open" },
        archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps
      }, opts);
      await queryInterface.createTable("FunnelQueues", {
        funnelId: { ...ref("Funnels", "CASCADE"), primaryKey: true },
        queueId: { ...ref("Queues", "CASCADE"), primaryKey: true },
        ...stamps
      }, opts);
      await queryInterface.createTable("LossReasons", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        name: { type: DataTypes.STRING, allowNull: false },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps
      }, opts);
      await queryInterface.createTable("Deals", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        stageId: ref("FunnelStages", "CASCADE"),
        contactId: ref("Contacts", "CASCADE"),
        userId: ref("Users", "SET NULL", true),
        title: { type: DataTypes.STRING, allowNull: false },
        value: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        expectedCloseDate: { type: DataTypes.DATEONLY, allowNull: true },
        source: { type: DataTypes.STRING(16), allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        status: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "open" },
        lossReasonId: ref("LossReasons", "SET NULL", true),
        lossNote: { type: DataTypes.STRING, allowNull: true },
        position: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
        stageEnteredAt: { type: DataTypes.DATE, allowNull: false },
        closedAt: { type: DataTypes.DATE, allowNull: true },
        ...stamps
      }, opts);
      await queryInterface.addIndex("Deals", ["companyId", "funnelId", "stageId", "position"], opts);
      await queryInterface.addIndex("Deals", ["companyId", "contactId", "status"], opts);
      await queryInterface.createTable("DealEvents", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        dealId: ref("Deals", "CASCADE"),
        userId: ref("Users", "SET NULL", true),
        type: { type: DataTypes.STRING(16), allowNull: false },
        fromValue: { type: DataTypes.STRING, allowNull: true },
        toValue: { type: DataTypes.STRING, allowNull: true },
        ...stamps
      }, opts);
      await queryInterface.addIndex("DealEvents", ["dealId", "createdAt"], opts);
      await queryInterface.createTable("FunnelRules", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        stageId: ref("FunnelStages", "CASCADE"),
        whatsappId: ref("Whatsapps", "CASCADE", true),
        queueId: ref("Queues", "CASCADE", true),
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps
      }, opts);

      await queryInterface.addColumn("Plans", "useCrm", {
        type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false
      }, opts);
      await queryInterface.addColumn("Plans", "crmFunnels", {
        type: DataTypes.INTEGER, allowNull: false, defaultValue: 1
      }, opts);

      const companies: { id: number }[] = await queryInterface.sequelize.query(
        `SELECT id FROM "Companies"`, { type: QueryTypes.SELECT, transaction }
      );
      const now = new Date();
      const rows = companies.flatMap(c =>
        LOSS_REASONS.map(name => ({ companyId: c.id, name, active: true, createdAt: now, updatedAt: now }))
      );
      if (rows.length) await queryInterface.bulkInsert("LossReasons", rows, opts);
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.removeColumn("Plans", "crmFunnels", opts);
      await queryInterface.removeColumn("Plans", "useCrm", opts);
      for (const table of ["FunnelRules", "DealEvents", "Deals", "LossReasons", "FunnelQueues", "FunnelStages", "Funnels"]) {
        await queryInterface.dropTable(table, opts);
      }
    });
  }
};
```

- [ ] **Step 2: Escrever os models**

`src/models/Funnel.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, HasMany, BelongsToMany
} from "sequelize-typescript";
import Company from "./Company";
import Queue from "./Queue";
import FunnelStage from "./FunnelStage";
import FunnelQueue from "./FunnelQueue";

@Table({ tableName: "Funnels" })
class Funnel extends Model<Funnel> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @AllowNull(false)
  @Column
  name: string;

  @Default("#2070F8")
  @Column
  color: string;

  @Default(0)
  @Column
  position: number;

  // Sellers see only their own deals and the unassigned ones.
  @Default(false)
  @Column
  ownDealsOnly: boolean;

  @Default(false)
  @Column
  archived: boolean;

  @HasMany(() => FunnelStage)
  stages: FunnelStage[];

  @BelongsToMany(() => Queue, () => FunnelQueue)
  queues: Queue[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Funnel;
```

`src/models/FunnelStage.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";

export type StageKind = "open" | "won" | "lost";

@Table({ tableName: "FunnelStages" })
class FunnelStage extends Model<FunnelStage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @BelongsTo(() => Funnel)
  funnel: Funnel;

  @AllowNull(false)
  @Column
  name: string;

  @Default("#64748B")
  @Column
  color: string;

  @Default(0)
  @Column
  position: number;

  @Default("open")
  @Column(DataType.STRING(8))
  kind: StageKind;

  @Default(false)
  @Column
  archived: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelStage;
```

`src/models/FunnelQueue.ts`:

```ts
import { Table, Column, CreatedAt, UpdatedAt, Model, ForeignKey, PrimaryKey } from "sequelize-typescript";
import Funnel from "./Funnel";
import Queue from "./Queue";

@Table({ tableName: "FunnelQueues" })
class FunnelQueue extends Model<FunnelQueue> {
  @PrimaryKey
  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @PrimaryKey
  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelQueue;
```

`src/models/LossReason.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey
} from "sequelize-typescript";
import Company from "./Company";

@Table({ tableName: "LossReasons" })
class LossReason extends Model<LossReason> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @AllowNull(false)
  @Column
  name: string;

  @Default(true)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default LossReason;
```

`src/models/Deal.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, DataType, HasMany
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";
import FunnelStage, { StageKind } from "./FunnelStage";
import Contact from "./Contact";
import User from "./User";
import LossReason from "./LossReason";
import DealEvent from "./DealEvent";

export type DealStatus = StageKind;

@Table({ tableName: "Deals" })
class Deal extends Model<Deal> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @BelongsTo(() => Funnel)
  funnel: Funnel;

  @ForeignKey(() => FunnelStage)
  @Column
  stageId: number;

  @BelongsTo(() => FunnelStage)
  stage: FunnelStage;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  userId: number | null;

  @BelongsTo(() => User)
  user: User;

  @AllowNull(false)
  @Column
  title: string;

  // DECIMAL comes back from Postgres as a string; callers convert with Number().
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  value: string;

  @Column(DataType.DATEONLY)
  expectedCloseDate: string | null;

  @Column(DataType.STRING(16))
  source: string | null;

  @Column(DataType.TEXT)
  notes: string | null;

  @Default("open")
  @Column(DataType.STRING(8))
  status: DealStatus;

  @ForeignKey(() => LossReason)
  @Column(DataType.INTEGER)
  lossReasonId: number | null;

  @BelongsTo(() => LossReason)
  lossReason: LossReason;

  @Column(DataType.STRING)
  lossNote: string | null;

  @Default(0)
  @Column(DataType.DOUBLE)
  position: number;

  @AllowNull(false)
  @Column
  stageEnteredAt: Date;

  @Column(DataType.DATE)
  closedAt: Date | null;

  @HasMany(() => DealEvent)
  events: DealEvent[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Deal;
```

`src/models/DealEvent.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Deal from "./Deal";
import User from "./User";

export type DealEventType =
  | "created" | "stage_changed" | "owner_changed" | "won" | "lost" | "reopened" | "edited";

@Table({ tableName: "DealEvents" })
class DealEvent extends Model<DealEvent> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Deal)
  @Column
  dealId: number;

  @BelongsTo(() => Deal)
  deal: Deal;

  // Null when the system (an automatic rule) did it.
  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  userId: number | null;

  @BelongsTo(() => User)
  user: User;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  type: DealEventType;

  @Column(DataType.STRING)
  fromValue: string | null;

  @Column(DataType.STRING)
  toValue: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default DealEvent;
```

`src/models/FunnelRule.ts`:

```ts
import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";
import FunnelStage from "./FunnelStage";
import Whatsapp from "./Whatsapp";
import Queue from "./Queue";

// Creates deals automatically; applied in step 5 of the CRM rollout.
@Table({ tableName: "FunnelRules" })
class FunnelRule extends Model<FunnelRule> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @BelongsTo(() => Funnel)
  funnel: Funnel;

  @ForeignKey(() => FunnelStage)
  @Column
  stageId: number;

  @ForeignKey(() => Whatsapp)
  @Column(DataType.INTEGER)
  whatsappId: number | null;

  @ForeignKey(() => Queue)
  @Column(DataType.INTEGER)
  queueId: number | null;

  @Default(true)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelRule;
```

- [ ] **Step 3: Registrar os models e os campos de plano**

Em `src/database/index.ts`, depois de `import BaileysKey from "../models/BaileysKey";`:

```ts
import Funnel from "../models/Funnel";
import FunnelStage from "../models/FunnelStage";
import FunnelQueue from "../models/FunnelQueue";
import LossReason from "../models/LossReason";
import Deal from "../models/Deal";
import DealEvent from "../models/DealEvent";
import FunnelRule from "../models/FunnelRule";
```

e no array `models`, trocar `BaileysKey\n];` por:

```ts
  BaileysKey,
  Funnel,
  FunnelStage,
  FunnelQueue,
  LossReason,
  Deal,
  DealEvent,
  FunnelRule
];
```

Em `src/models/Plan.ts`, depois de `useAiAgents: boolean;`:

```ts

  @Column
  useCrm: boolean;

  // Max active sales funnels; 0 means unlimited.
  @Column
  crmFunnels: number;
```

Em `src/helpers/planFeature.ts`, trocar `| "useAiAgents";` por `| "useAiAgents"\n  | "useCrm";`.

Em `CreatePlanService.ts`, `UpdatePlanService.ts` (interface `PlanData`) e nos tipos `StorePlanData`/`UpdatePlanData` de `PlanController.ts`, depois de `useAiAgents?: boolean;`:

```ts
  useCrm?: boolean;
  crmFunnels?: number;
```

- [ ] **Step 4: Compilar e rodar a migration no HM**

Run: `cd whatsapp-api && npx tsc -p . && npx sequelize db:migrate`
Expected: `TypeScript: No errors found` e `20260930160000-create-crm: migrated`.

Run: `docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c 'select count(*) from "LossReasons"; select "useCrm","crmFunnels" from "Plans";'`
Expected: 5 motivos por empresa existente; planos com `f | 1`.

- [ ] **Step 5: Conferir o down e subir de novo**

Run: `npx sequelize db:migrate:undo && npx sequelize db:migrate`
Expected: undo sem erro (tabelas e colunas removidas) e migrate aplicado de novo.

- [ ] **Step 6: Commit**

```bash
git add src/database/migrations/20260930160000-create-crm.ts src/models/Funnel.ts src/models/FunnelStage.ts src/models/FunnelQueue.ts src/models/LossReason.ts src/models/Deal.ts src/models/DealEvent.ts src/models/FunnelRule.ts src/database/index.ts src/models/Plan.ts src/helpers/planFeature.ts src/services/PlanService/CreatePlanService.ts src/services/PlanService/UpdatePlanService.ts src/controllers/PlanController.ts
git commit -m "Cria as tabelas do CRM e os campos de plano useCrm e crmFunnels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras (padrões, visibilidade, posição, mudança de coluna, colunas)

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/defaults.ts`, `visibility.ts`, `position.ts`, `transition.ts`, `stages.ts`
- Test: `whatsapp-api/src/services/CrmServices/__tests__/visibility.spec.ts`, `position.spec.ts`, `transition.spec.ts`, `stages.spec.ts`

**Interfaces:**
- Consumes: `StageKind`, `DealStatus`, `DealEventType` (Task 1).
- Produces:
  - `DEFAULT_STAGES: { name: string; color: string; kind: StageKind }[]`, `DEAL_SOURCES: string[]`, `DEFAULT_LOSS_REASONS: string[]`
  - `interface Viewer { id: number; profile: string; companyId: number; queueIds: number[] }`
  - `isAdmin(v: Viewer): boolean`
  - `canSeeFunnel(v: Viewer, f: { archived: boolean; queueIds: number[] }): boolean`
  - `ownerScope(v: Viewer, f: { ownDealsOnly: boolean }): number[] | null` — `null` = sem filtro; senão lista de `userId` permitidos, onde `0` representa "sem responsável"
  - `canSeeDeal(v: Viewer, f: { ownDealsOnly: boolean }, d: { userId: number | null }): boolean`
  - `positionBetween(before: number | null, after: number | null): number`, `needsRenumber(before: number | null, after: number | null): boolean`, `renumber<T extends { id: number }>(ordered: T[]): { id: number; position: number }[]`, `POSITION_STEP = 1024`
  - `stageChange(deal: { stageId: number; status: DealStatus }, target: { id: number; kind: StageKind }, input: { lossReasonId?: number | null; lossNote?: string | null }, now: Date): { patch: Record<string, unknown>; events: { type: DealEventType; fromValue: string | null; toValue: string | null }[] }`
  - `sortStages<T extends { kind: StageKind; position: number }>(s: T[]): T[]`, `reorderOpen(stages: { id: number; kind: StageKind }[], openIds: number[]): { id: number; position: number }[]`, `canCreateFunnel(limit: number, activeCount: number): boolean`

- [ ] **Step 1: Escrever os testes que falham**

`__tests__/visibility.spec.ts`:

```ts
import { canSeeFunnel, ownerScope, canSeeDeal, Viewer } from "../visibility";

const admin: Viewer = { id: 1, profile: "admin", companyId: 1, queueIds: [] };
const seller: Viewer = { id: 2, profile: "user", companyId: 1, queueIds: [10] };
const noQueue: Viewer = { id: 3, profile: "user", companyId: 1, queueIds: [] };

describe("canSeeFunnel", () => {
  it("lets admin see every non-archived funnel, even without queues", () => {
    expect(canSeeFunnel(admin, { archived: false, queueIds: [] })).toBe(true);
    expect(canSeeFunnel(admin, { archived: false, queueIds: [99] })).toBe(true);
  });
  it("hides archived funnels from everyone", () => {
    expect(canSeeFunnel(admin, { archived: true, queueIds: [] })).toBe(false);
    expect(canSeeFunnel(seller, { archived: true, queueIds: [10] })).toBe(false);
  });
  it("shows a funnel to a user only when they share a queue", () => {
    expect(canSeeFunnel(seller, { archived: false, queueIds: [10, 11] })).toBe(true);
    expect(canSeeFunnel(seller, { archived: false, queueIds: [11] })).toBe(false);
  });
  it("hides funnels without queues from non-admins", () => {
    expect(canSeeFunnel(seller, { archived: false, queueIds: [] })).toBe(false);
  });
  it("gives users without queues no funnel at all", () => {
    expect(canSeeFunnel(noQueue, { archived: false, queueIds: [10] })).toBe(false);
  });
});

describe("ownerScope / canSeeDeal", () => {
  it("does not filter for admin or when the funnel shares deals", () => {
    expect(ownerScope(admin, { ownDealsOnly: true })).toBeNull();
    expect(ownerScope(seller, { ownDealsOnly: false })).toBeNull();
  });
  it("limits sellers to their own and unassigned deals", () => {
    expect(ownerScope(seller, { ownDealsOnly: true })).toEqual([2, 0]);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: 2 })).toBe(true);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: null })).toBe(true);
    expect(canSeeDeal(seller, { ownDealsOnly: true }, { userId: 5 })).toBe(false);
    expect(canSeeDeal(seller, { ownDealsOnly: false }, { userId: 5 })).toBe(true);
  });
});
```

`__tests__/position.spec.ts`:

```ts
import { positionBetween, needsRenumber, renumber, POSITION_STEP } from "../position";

describe("positionBetween", () => {
  it("starts an empty column at one step", () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
  });
  it("goes above the first card and below the last one", () => {
    expect(positionBetween(null, 2048)).toBe(1024);
    expect(positionBetween(2048, null)).toBe(3072);
  });
  it("takes the midpoint between neighbours", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});

describe("needsRenumber / renumber", () => {
  it("asks for renumbering when neighbours are too close", () => {
    expect(needsRenumber(1, 1 + 1e-7)).toBe(true);
    expect(needsRenumber(1, 2)).toBe(false);
    expect(needsRenumber(null, 1)).toBe(false);
  });
  it("keeps the order after many moves between the same two cards", () => {
    let a = 1024;
    const b = 2048;
    for (let i = 0; i < 60; i++) a = positionBetween(a, b);
    expect(needsRenumber(a, b)).toBe(true);
    expect(renumber([{ id: 7 }, { id: 3 }, { id: 9 }])).toEqual([
      { id: 7, position: 1024 },
      { id: 3, position: 2048 },
      { id: 9, position: 3072 }
    ]);
  });
});
```

`__tests__/transition.spec.ts`:

```ts
import { stageChange } from "../transition";

const now = new Date("2026-09-30T12:00:00Z");
const openDeal = { stageId: 1, status: "open" as const };

describe("stageChange", () => {
  it("returns nothing when the stage does not change", () => {
    expect(stageChange(openDeal, { id: 1, kind: "open" }, {}, now)).toEqual({ patch: {}, events: [] });
  });
  it("moves between open stages", () => {
    const r = stageChange(openDeal, { id: 2, kind: "open" }, {}, now);
    expect(r.patch).toEqual({ stageId: 2, status: "open", stageEnteredAt: now });
    expect(r.events).toEqual([{ type: "stage_changed", fromValue: "1", toValue: "2" }]);
  });
  it("closes as won", () => {
    const r = stageChange(openDeal, { id: 5, kind: "won" }, {}, now);
    expect(r.patch).toMatchObject({ stageId: 5, status: "won", closedAt: now, lossReasonId: null, lossNote: null });
    expect(r.events.map(e => e.type)).toEqual(["stage_changed", "won"]);
  });
  it("requires a loss reason to close as lost", () => {
    expect(() => stageChange(openDeal, { id: 6, kind: "lost" }, {}, now)).toThrow("ERR_CRM_LOSS_REASON_REQUIRED");
    expect(() => stageChange(openDeal, { id: 6, kind: "lost" }, { lossReasonId: null }, now)).toThrow(
      "ERR_CRM_LOSS_REASON_REQUIRED"
    );
  });
  it("closes as lost with reason and note", () => {
    const r = stageChange(openDeal, { id: 6, kind: "lost" }, { lossReasonId: 3, lossNote: "caro" }, now);
    expect(r.patch).toMatchObject({ status: "lost", closedAt: now, lossReasonId: 3, lossNote: "caro" });
    expect(r.events[1]).toEqual({ type: "lost", fromValue: null, toValue: "3" });
  });
  it("reopens a closed deal and clears the closing data", () => {
    const r = stageChange({ stageId: 6, status: "lost" }, { id: 2, kind: "open" }, {}, now);
    expect(r.patch).toEqual({
      stageId: 2, status: "open", stageEnteredAt: now, closedAt: null, lossReasonId: null, lossNote: null
    });
    expect(r.events.map(e => e.type)).toEqual(["stage_changed", "reopened"]);
  });
});
```

`__tests__/stages.spec.ts`:

```ts
import { sortStages, reorderOpen, canCreateFunnel } from "../stages";

const stages = [
  { id: 5, kind: "won" as const, position: 0 },
  { id: 2, kind: "open" as const, position: 2048 },
  { id: 6, kind: "lost" as const, position: 0 },
  { id: 1, kind: "open" as const, position: 1024 }
];

describe("sortStages", () => {
  it("puts open stages by position, then won, then lost", () => {
    expect(sortStages(stages).map(s => s.id)).toEqual([1, 2, 5, 6]);
  });
});

describe("reorderOpen", () => {
  it("renumbers the open stages in the given order", () => {
    expect(reorderOpen(stages, [2, 1])).toEqual([
      { id: 2, position: 1024 },
      { id: 1, position: 2048 }
    ]);
  });
  it("refuses won or lost stages in the list", () => {
    expect(() => reorderOpen(stages, [2, 1, 5])).toThrow("ERR_CRM_STAGE_LOCKED");
  });
  it("refuses a list that misses or repeats open stages", () => {
    expect(() => reorderOpen(stages, [2])).toThrow("ERR_CRM_STAGE_ORDER");
    expect(() => reorderOpen(stages, [2, 2])).toThrow("ERR_CRM_STAGE_ORDER");
    expect(() => reorderOpen(stages, [2, 99])).toThrow("ERR_CRM_STAGE_ORDER");
  });
});

describe("canCreateFunnel", () => {
  it("treats 0 as unlimited", () => {
    expect(canCreateFunnel(0, 50)).toBe(true);
  });
  it("blocks at the limit", () => {
    expect(canCreateFunnel(1, 0)).toBe(true);
    expect(canCreateFunnel(1, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/CrmServices --coverage=false`
Expected: FAIL com "Cannot find module '../visibility'" (e os outros).

- [ ] **Step 3: Implementar**

`defaults.ts`:

```ts
import { StageKind } from "../../models/FunnelStage";

export const DEFAULT_STAGES: { name: string; color: string; kind: StageKind }[] = [
  { name: "Lead", color: "#64748B", kind: "open" },
  { name: "Qualificação", color: "#2070F8", kind: "open" },
  { name: "Proposta", color: "#8B5CF6", kind: "open" },
  { name: "Negociação", color: "#F59E0B", kind: "open" },
  { name: "Ganho", color: "#16A34A", kind: "won" },
  { name: "Perdido", color: "#DC2626", kind: "lost" }
];

export const DEAL_SOURCES = ["ad", "instagram", "site", "referral", "whatsapp", "other"];

export const DEFAULT_LOSS_REASONS = ["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"];
```

`visibility.ts`:

```ts
export interface Viewer {
  id: number;
  profile: string;
  companyId: number;
  queueIds: number[];
}

export const isAdmin = (v: Viewer): boolean => v.profile === "admin";

// Admins see every active funnel; other users only funnels sharing a queue.
export const canSeeFunnel = (v: Viewer, f: { archived: boolean; queueIds: number[] }): boolean => {
  if (f.archived) return false;
  if (isAdmin(v)) return true;
  return f.queueIds.some(id => v.queueIds.includes(id));
};

// Allowed deal owners inside a funnel, or null for no filter. 0 stands for
// "no owner" so callers can map it to IS NULL.
export const ownerScope = (v: Viewer, f: { ownDealsOnly: boolean }): number[] | null =>
  isAdmin(v) || !f.ownDealsOnly ? null : [v.id, 0];

export const canSeeDeal = (v: Viewer, f: { ownDealsOnly: boolean }, d: { userId: number | null }): boolean => {
  const scope = ownerScope(v, f);
  return scope === null || scope.includes(d.userId ?? 0);
};
```

`position.ts`:

```ts
export const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

// Position for a card dropped between two neighbours (null = column edge).
export const positionBetween = (before: number | null, after: number | null): number => {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  return (before + after) / 2;
};

export const needsRenumber = (before: number | null, after: number | null): boolean =>
  before !== null && after !== null && after - before < MIN_GAP;

export const renumber = <T extends { id: number }>(ordered: T[]): { id: number; position: number }[] =>
  ordered.map((item, i) => ({ id: item.id, position: (i + 1) * POSITION_STEP }));
```

`transition.ts`:

```ts
import AppError from "../../errors/AppError";
import { StageKind } from "../../models/FunnelStage";
import { DealStatus } from "../../models/Deal";
import { DealEventType } from "../../models/DealEvent";

export interface StageChangeEvent {
  type: DealEventType;
  fromValue: string | null;
  toValue: string | null;
}

// What changes on a deal when it lands on another stage.
export const stageChange = (
  deal: { stageId: number; status: DealStatus },
  target: { id: number; kind: StageKind },
  input: { lossReasonId?: number | null; lossNote?: string | null },
  now: Date
): { patch: Record<string, unknown>; events: StageChangeEvent[] } => {
  if (deal.stageId === target.id) return { patch: {}, events: [] };
  if (target.kind === "lost" && !input.lossReasonId) {
    throw new AppError("ERR_CRM_LOSS_REASON_REQUIRED", 400);
  }

  const patch: Record<string, unknown> = { stageId: target.id, status: target.kind, stageEnteredAt: now };
  const events: StageChangeEvent[] = [
    { type: "stage_changed", fromValue: String(deal.stageId), toValue: String(target.id) }
  ];

  if (target.kind === "won") {
    Object.assign(patch, { closedAt: now, lossReasonId: null, lossNote: null });
    events.push({ type: "won", fromValue: null, toValue: null });
  } else if (target.kind === "lost") {
    Object.assign(patch, { closedAt: now, lossReasonId: input.lossReasonId, lossNote: input.lossNote ?? null });
    events.push({ type: "lost", fromValue: null, toValue: String(input.lossReasonId) });
  } else if (deal.status !== "open") {
    Object.assign(patch, { closedAt: null, lossReasonId: null, lossNote: null });
    events.push({ type: "reopened", fromValue: deal.status, toValue: null });
  }

  return { patch, events };
};
```

`stages.ts`:

```ts
import AppError from "../../errors/AppError";
import { StageKind } from "../../models/FunnelStage";
import { renumber } from "./position";

const RANK: Record<StageKind, number> = { open: 0, won: 1, lost: 2 };

// Open stages in their order, then won, then lost.
export const sortStages = <T extends { kind: StageKind; position: number }>(stages: T[]): T[] =>
  [...stages].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.position - b.position);

// New positions for the open stages; won and lost never move.
export const reorderOpen = (
  stages: { id: number; kind: StageKind }[],
  openIds: number[]
): { id: number; position: number }[] => {
  const byId = new Map(stages.map(s => [s.id, s]));
  if (openIds.some(id => byId.get(id) && byId.get(id)!.kind !== "open")) {
    throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  }
  const open = stages.filter(s => s.kind === "open").map(s => s.id);
  const unique = new Set(openIds);
  if (unique.size !== openIds.length || openIds.length !== open.length || openIds.some(id => !open.includes(id))) {
    throw new AppError("ERR_CRM_STAGE_ORDER", 400);
  }
  return renumber(openIds.map(id => ({ id })));
};

export const canCreateFunnel = (limit: number, activeCount: number): boolean =>
  limit === 0 || activeCount < limit;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/services/CrmServices --coverage=false`
Expected: PASS, 4 suites.

- [ ] **Step 5: Commit**

```bash
git add src/services/CrmServices/defaults.ts src/services/CrmServices/visibility.ts src/services/CrmServices/position.ts src/services/CrmServices/transition.ts src/services/CrmServices/stages.ts src/services/CrmServices/__tests__
git commit -m "Adiciona as regras do CRM: visibilidade, posição e mudança de coluna

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Viewer e motivos de perda

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/viewer.ts`
- Create: `whatsapp-api/src/services/CrmServices/LossReasonService.ts`
- Modify: `whatsapp-api/src/services/CompanyService/CreateCompanyService.ts` (depois de `Company.create`)
- Test: `whatsapp-api/src/services/CrmServices/__tests__/LossReasonService.spec.ts`

**Interfaces:**
- Consumes: `Viewer` (Task 2), `DEFAULT_LOSS_REASONS` (Task 2), models `LossReason`, `UserQueue`.
- Produces:
  - `getViewer(user: { id: string | number; profile: string; companyId: number }): Promise<Viewer>`
  - `seedLossReasons(companyId: number): Promise<void>`
  - `listLossReasons(companyId: number): Promise<LossReason[]>` (ativos e inativos, por nome)
  - `createLossReason(companyId: number, name: string): Promise<LossReason>`
  - `updateLossReason(companyId: number, id: number, data: { name?: string; active?: boolean }): Promise<LossReason>`
  - `findActiveLossReason(companyId: number, id: number): Promise<LossReason | null>`

- [ ] **Step 1: Teste que falha**

`__tests__/LossReasonService.spec.ts`:

```ts
import LossReason from "../../../models/LossReason";
import { seedLossReasons, updateLossReason } from "../LossReasonService";

jest.mock("../../../models/LossReason", () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn(), findOne: jest.fn() }
}));

describe("seedLossReasons", () => {
  it("creates the five default reasons for the company", async () => {
    await seedLossReasons(9);
    const rows = (LossReason.bulkCreate as jest.Mock).mock.calls[0][0];
    expect(rows.map((r: any) => r.name)).toEqual(["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"]);
    expect(rows.every((r: any) => r.companyId === 9 && r.active === true)).toBe(true);
  });
});

describe("updateLossReason", () => {
  it("looks the reason up inside the company and 404s otherwise", async () => {
    (LossReason.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateLossReason(9, 1, { active: false })).rejects.toMatchObject({ statusCode: 404 });
    expect(LossReason.findOne).toHaveBeenCalledWith({ where: { id: 1, companyId: 9 } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/CrmServices/__tests__/LossReasonService.spec.ts --coverage=false`
Expected: FAIL com "Cannot find module '../LossReasonService'".

- [ ] **Step 3: Implementar**

`viewer.ts`:

```ts
import UserQueue from "../../models/UserQueue";
import { Viewer } from "./visibility";

// The request user plus their queues, which decide what CRM data they see.
export const getViewer = async (user: { id: string | number; profile: string; companyId: number }): Promise<Viewer> => {
  const id = Number(user.id);
  const rows = await UserQueue.findAll({ where: { userId: id }, attributes: ["queueId"] });
  return { id, profile: user.profile, companyId: user.companyId, queueIds: rows.map(r => r.queueId) };
};
```

`LossReasonService.ts`:

```ts
import AppError from "../../errors/AppError";
import LossReason from "../../models/LossReason";
import { DEFAULT_LOSS_REASONS } from "./defaults";

export const seedLossReasons = async (companyId: number): Promise<void> => {
  await LossReason.bulkCreate(DEFAULT_LOSS_REASONS.map(name => ({ companyId, name, active: true })) as any);
};

export const listLossReasons = (companyId: number): Promise<LossReason[]> =>
  LossReason.findAll({ where: { companyId }, order: [["name", "ASC"]] });

export const createLossReason = (companyId: number, name: string): Promise<LossReason> => {
  if (!name || !name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  return LossReason.create({ companyId, name: name.trim(), active: true } as any);
};

export const updateLossReason = async (
  companyId: number,
  id: number,
  data: { name?: string; active?: boolean }
): Promise<LossReason> => {
  const reason = await LossReason.findOne({ where: { id, companyId } });
  if (!reason) throw new AppError("ERR_CRM_NOT_FOUND", 404);
  const patch: { name?: string; active?: boolean } = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.active !== undefined) patch.active = !!data.active;
  return reason.update(patch);
};

export const findActiveLossReason = (companyId: number, id: number): Promise<LossReason | null> =>
  LossReason.findOne({ where: { id, companyId, active: true } });
```

Em `CreateCompanyService.ts`, adicionar o import `import { seedLossReasons } from "../CrmServices/LossReasonService";` e, logo depois do bloco `const company = await Company.create({ ... });`:

```ts
  await seedLossReasons(company.id);
```

- [ ] **Step 4: Rodar e ver passar; compilar**

Run: `npx jest src/services/CrmServices --coverage=false && npx tsc --noEmit -p .`
Expected: PASS; `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/services/CrmServices/viewer.ts src/services/CrmServices/LossReasonService.ts src/services/CrmServices/__tests__/LossReasonService.spec.ts src/services/CompanyService/CreateCompanyService.ts
git commit -m "Adiciona motivos de perda do CRM e semeia os padrões em empresa nova

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Nota: `ERR_CRM_NAME_REQUIRED` (400) e `ERR_CRM_NOT_FOUND` (404) são códigos novos; entram na tabela de erros da Task 7 junto com os outros.

---

### Task 4: Serviço de funis e colunas

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/FunnelService.ts`
- Test: `whatsapp-api/src/services/CrmServices/__tests__/FunnelService.spec.ts`

**Interfaces:**
- Consumes: `Viewer`, `canSeeFunnel`, `isAdmin` (Task 2); `sortStages`, `reorderOpen`, `canCreateFunnel` (Task 2); `DEFAULT_STAGES` (Task 2); models (Task 1); `Company` com `plan`.
- Produces:
  - `type FunnelView = { id; name; color; position; ownDealsOnly; archived; queueIds: number[]; stages: FunnelStage[] }`
  - `listFunnels(v: Viewer, opts?: { includeArchived?: boolean }): Promise<FunnelView[]>` (arquivados só para admin com `includeArchived`)
  - `findVisibleFunnel(v: Viewer, funnelId: number): Promise<FunnelView>` → 404 `ERR_CRM_NOT_FOUND`
  - `createFunnel(v: Viewer, data: { name: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }): Promise<FunnelView>`
  - `updateFunnel(v: Viewer, funnelId: number, data: { name?: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }): Promise<FunnelView>`
  - `setFunnelArchived(v: Viewer, funnelId: number, archived: boolean): Promise<FunnelView>`
  - `createStage(v: Viewer, funnelId: number, data: { name: string; color?: string }): Promise<FunnelStage>`
  - `updateStage(v: Viewer, funnelId: number, stageId: number, data: { name?: string; color?: string; archived?: boolean }): Promise<FunnelStage>`
  - `deleteStage(v: Viewer, funnelId: number, stageId: number, moveToStageId?: number): Promise<void>`
  - `reorderStages(v: Viewer, funnelId: number, openIds: number[]): Promise<FunnelView>`
  - `findVisibleStage(v: Viewer, stageId: number): Promise<{ stage: FunnelStage; funnel: FunnelView }>` → 404 se a coluna é de funil invisível, arquivada ou de outra empresa
  - `emitFunnel(companyId: number, funnelId: number): void`

Todas as funções de escrita começam com `assertAdmin(v)` (403 `ERR_NO_PERMISSION`).

- [ ] **Step 1: Teste que falha (limite e bloqueios com models simulados)**

`__tests__/FunnelService.spec.ts`:

```ts
import Funnel from "../../../models/Funnel";
import FunnelStage from "../../../models/FunnelStage";
import Deal from "../../../models/Deal";
import Company from "../../../models/Company";
import { createFunnel, deleteStage, updateStage } from "../FunnelService";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: { count: jest.fn(), findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: (fn: any) => fn({}) } } }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: { findOne: jest.fn(), bulkCreate: jest.fn(), findAll: jest.fn() } }));
jest.mock("../../../models/FunnelQueue", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), destroy: jest.fn() } }));
jest.mock("../../../models/Deal", () => ({ __esModule: true, default: { count: jest.fn(), update: jest.fn() } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));

const admin = { id: 1, profile: "admin", companyId: 4, queueIds: [] };
const seller = { id: 2, profile: "user", companyId: 4, queueIds: [10] };

describe("createFunnel", () => {
  it("refuses non-admins", async () => {
    await expect(createFunnel(seller, { name: "X" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("blocks at the plan limit", async () => {
    (Company.findByPk as jest.Mock).mockResolvedValue({ plan: { crmFunnels: 1 } });
    (Funnel.count as jest.Mock).mockResolvedValue(1);
    await expect(createFunnel(admin, { name: "Vendas" })).rejects.toMatchObject({
      message: "ERR_CRM_FUNNEL_LIMIT",
      statusCode: 403
    });
    expect(Funnel.count).toHaveBeenCalledWith({ where: { companyId: 4, archived: false } });
  });
});

describe("stage locks", () => {
  const funnelRow = { id: 3, companyId: 4, archived: false, ownDealsOnly: false, queues: [], stages: [] };
  beforeEach(() => {
    (Funnel.findOne as jest.Mock).mockResolvedValue({ ...funnelRow, get: () => funnelRow });
  });
  it("does not delete or archive won/lost stages", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 8, funnelId: 3, kind: "won" });
    await expect(deleteStage(admin, 3, 8)).rejects.toMatchObject({ message: "ERR_CRM_STAGE_LOCKED" });
    await expect(updateStage(admin, 3, 8, { archived: true })).rejects.toMatchObject({ message: "ERR_CRM_STAGE_LOCKED" });
  });
  it("does not delete an open stage with deals unless told where to move them", async () => {
    (FunnelStage.findOne as jest.Mock).mockResolvedValue({ id: 7, funnelId: 3, kind: "open", destroy: jest.fn() });
    (Deal.count as jest.Mock).mockResolvedValue(2);
    await expect(deleteStage(admin, 3, 7)).rejects.toMatchObject({ message: "ERR_CRM_STAGE_NOT_EMPTY" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/CrmServices/__tests__/FunnelService.spec.ts --coverage=false`
Expected: FAIL com "Cannot find module '../FunnelService'".

- [ ] **Step 3: Implementar `FunnelService.ts`**

```ts
import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import Funnel from "../../models/Funnel";
import FunnelStage from "../../models/FunnelStage";
import FunnelQueue from "../../models/FunnelQueue";
import Queue from "../../models/Queue";
import Deal from "../../models/Deal";
import { DEFAULT_STAGES } from "./defaults";
import { POSITION_STEP } from "./position";
import { canCreateFunnel, reorderOpen, sortStages } from "./stages";
import { canSeeFunnel, isAdmin, Viewer } from "./visibility";

export interface FunnelView {
  id: number;
  name: string;
  color: string;
  position: number;
  ownDealsOnly: boolean;
  archived: boolean;
  queueIds: number[];
  stages: FunnelStage[];
}

const assertAdmin = (v: Viewer) => {
  if (!isAdmin(v)) throw new AppError("ERR_NO_PERMISSION", 403);
};

const notFound = () => new AppError("ERR_CRM_NOT_FOUND", 404);

const include = [
  { model: FunnelStage, as: "stages", where: { archived: false }, required: false },
  { model: Queue, as: "queues", attributes: ["id"], through: { attributes: [] } }
];

const toView = (f: Funnel): FunnelView => ({
  id: f.id,
  name: f.name,
  color: f.color,
  position: f.position,
  ownDealsOnly: f.ownDealsOnly,
  archived: f.archived,
  queueIds: (f.queues || []).map(q => q.id),
  stages: sortStages(f.stages || [])
});

export const emitFunnel = (companyId: number, funnelId: number): void => {
  getIO().emit(`company-${companyId}-funnel`, { action: "update", funnelId });
};

export const listFunnels = async (v: Viewer, opts: { includeArchived?: boolean } = {}): Promise<FunnelView[]> => {
  const withArchived = !!opts.includeArchived && isAdmin(v);
  const rows = await Funnel.findAll({
    where: { companyId: v.companyId, ...(withArchived ? {} : { archived: false }) },
    include,
    order: [["position", "ASC"], ["id", "ASC"]]
  });
  return rows.map(toView).filter(f => (withArchived && f.archived) || canSeeFunnel(v, f));
};

export const findVisibleFunnel = async (v: Viewer, funnelId: number): Promise<FunnelView> => {
  const row = await Funnel.findOne({ where: { id: funnelId, companyId: v.companyId }, include });
  if (!row) throw notFound();
  const view = toView(row);
  // Admins may still edit archived funnels (e.g. to unarchive them).
  if (!(isAdmin(v) || canSeeFunnel(v, view))) throw notFound();
  return view;
};

const assertQueues = async (companyId: number, queueIds: number[]) => {
  if (!queueIds.length) return;
  const count = await Queue.count({ where: { id: { [Op.in]: queueIds }, companyId } });
  if (count !== new Set(queueIds).size) throw notFound();
};

const setQueues = async (funnelId: number, queueIds: number[], transaction?: any) => {
  await FunnelQueue.destroy({ where: { funnelId }, transaction });
  if (queueIds.length) {
    await FunnelQueue.bulkCreate([...new Set(queueIds)].map(queueId => ({ funnelId, queueId })) as any, { transaction });
  }
};

export const createFunnel = async (
  v: Viewer,
  data: { name: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }
): Promise<FunnelView> => {
  assertAdmin(v);
  if (!data.name || !data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  const company = await Company.findByPk(v.companyId, { include: [{ model: Plan, as: "plan" }] });
  const limit = Number((company as any)?.plan?.crmFunnels ?? 0);
  const active = await Funnel.count({ where: { companyId: v.companyId, archived: false } });
  if (!canCreateFunnel(limit, active)) throw new AppError("ERR_CRM_FUNNEL_LIMIT", 403);
  const queueIds = data.queueIds || [];
  await assertQueues(v.companyId, queueIds);

  const funnelId = await Funnel.sequelize!.transaction(async transaction => {
    const funnel = await Funnel.create(
      {
        companyId: v.companyId,
        name: data.name.trim(),
        color: data.color || "#2070F8",
        ownDealsOnly: !!data.ownDealsOnly,
        position: active
      } as any,
      { transaction }
    );
    await FunnelStage.bulkCreate(
      DEFAULT_STAGES.map((s, i) => ({
        companyId: v.companyId,
        funnelId: funnel.id,
        name: s.name,
        color: s.color,
        kind: s.kind,
        position: s.kind === "open" ? (i + 1) * POSITION_STEP : 0
      })) as any,
      { transaction }
    );
    await setQueues(funnel.id, queueIds, transaction);
    return funnel.id;
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const updateFunnel = async (
  v: Viewer,
  funnelId: number,
  data: { name?: string; color?: string; ownDealsOnly?: boolean; queueIds?: number[] }
): Promise<FunnelView> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.color !== undefined) patch.color = data.color;
  if (data.ownDealsOnly !== undefined) patch.ownDealsOnly = !!data.ownDealsOnly;
  if (data.queueIds !== undefined) await assertQueues(v.companyId, data.queueIds);
  await Funnel.sequelize!.transaction(async transaction => {
    if (Object.keys(patch).length) {
      await Funnel.update(patch, { where: { id: funnelId, companyId: v.companyId }, transaction });
    }
    if (data.queueIds !== undefined) await setQueues(funnelId, data.queueIds, transaction);
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const setFunnelArchived = async (v: Viewer, funnelId: number, archived: boolean): Promise<FunnelView> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  if (!archived && funnel.archived) {
    const company = await Company.findByPk(v.companyId, { include: [{ model: Plan, as: "plan" }] });
    const limit = Number((company as any)?.plan?.crmFunnels ?? 0);
    const active = await Funnel.count({ where: { companyId: v.companyId, archived: false } });
    if (!canCreateFunnel(limit, active)) throw new AppError("ERR_CRM_FUNNEL_LIMIT", 403);
  }
  await Funnel.update({ archived }, { where: { id: funnelId, companyId: v.companyId } });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

const findStageInFunnel = async (v: Viewer, funnelId: number, stageId: number): Promise<FunnelStage> => {
  const stage = await FunnelStage.findOne({ where: { id: stageId, funnelId, companyId: v.companyId } });
  if (!stage) throw notFound();
  return stage;
};

export const createStage = async (
  v: Viewer,
  funnelId: number,
  data: { name: string; color?: string }
): Promise<FunnelStage> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  if (!data.name || !data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
  const lastOpen = funnel.stages.filter(s => s.kind === "open").pop();
  const stage = await FunnelStage.create({
    companyId: v.companyId,
    funnelId,
    name: data.name.trim(),
    color: data.color || "#64748B",
    kind: "open",
    position: (lastOpen ? lastOpen.position : 0) + POSITION_STEP
  } as any);
  emitFunnel(v.companyId, funnelId);
  return stage;
};

export const updateStage = async (
  v: Viewer,
  funnelId: number,
  stageId: number,
  data: { name?: string; color?: string; archived?: boolean }
): Promise<FunnelStage> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  const stage = await findStageInFunnel(v, funnelId, stageId);
  if (data.archived !== undefined && stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    if (!data.name.trim()) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    patch.name = data.name.trim();
  }
  if (data.color !== undefined) patch.color = data.color;
  if (data.archived !== undefined) patch.archived = !!data.archived;
  await stage.update(patch);
  emitFunnel(v.companyId, funnelId);
  return stage;
};

export const deleteStage = async (
  v: Viewer,
  funnelId: number,
  stageId: number,
  moveToStageId?: number
): Promise<void> => {
  assertAdmin(v);
  await findVisibleFunnel(v, funnelId);
  const stage = await findStageInFunnel(v, funnelId, stageId);
  if (stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  const deals = await Deal.count({ where: { stageId, companyId: v.companyId } });
  if (deals > 0) {
    if (!moveToStageId || moveToStageId === stageId) throw new AppError("ERR_CRM_STAGE_NOT_EMPTY", 400);
    const target = await findStageInFunnel(v, funnelId, moveToStageId);
    if (target.kind !== "open" || target.archived) throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
    await Deal.update(
      { stageId: target.id, stageEnteredAt: new Date() },
      { where: { stageId, companyId: v.companyId } }
    );
  }
  await stage.destroy();
  emitFunnel(v.companyId, funnelId);
};

export const reorderStages = async (v: Viewer, funnelId: number, openIds: number[]): Promise<FunnelView> => {
  assertAdmin(v);
  const funnel = await findVisibleFunnel(v, funnelId);
  const positions = reorderOpen(funnel.stages, openIds);
  await Funnel.sequelize!.transaction(async transaction => {
    for (const p of positions) {
      await FunnelStage.update(
        { position: p.position },
        { where: { id: p.id, funnelId, companyId: v.companyId }, transaction }
      );
    }
  });
  emitFunnel(v.companyId, funnelId);
  return findVisibleFunnel(v, funnelId);
};

export const findVisibleStage = async (
  v: Viewer,
  stageId: number
): Promise<{ stage: FunnelStage; funnel: FunnelView }> => {
  const stage = await FunnelStage.findOne({ where: { id: stageId, companyId: v.companyId, archived: false } });
  if (!stage) throw notFound();
  const funnel = await findVisibleFunnel(v, stage.funnelId);
  if (funnel.archived) throw notFound();
  return { stage, funnel };
};
```

Nota: `reorderStages` recebe a lista com as colunas abertas **não arquivadas**, porque `findVisibleFunnel` só inclui essas; colunas arquivadas mantêm a posição antiga.

- [ ] **Step 4: Rodar e ver passar; compilar**

Run: `npx jest src/services/CrmServices --coverage=false && npx tsc --noEmit -p .`
Expected: PASS; `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/services/CrmServices/FunnelService.ts src/services/CrmServices/__tests__/FunnelService.spec.ts
git commit -m "Adiciona o serviço de funis e colunas do CRM com limite do plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Serviço de negócios

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/DealService.ts`
- Test: `whatsapp-api/src/services/CrmServices/__tests__/DealService.spec.ts`

**Interfaces:**
- Consumes: `Viewer`, `canSeeDeal`, `ownerScope`, `isAdmin` (Task 2); `positionBetween`, `needsRenumber`, `renumber` (Task 2); `stageChange` (Task 2); `DEAL_SOURCES` (Task 2); `findVisibleFunnel`, `findVisibleStage`, `FunnelView` (Task 4); `findActiveLossReason` (Task 3).
- Produces:
  - `type DealInput = { title?: string; value?: number | string; userId?: number | null; expectedCloseDate?: string | null; source?: string | null; notes?: string | null }`
  - `listDeals(v, funnelId, q: { stageId?: number; page?: number; search?: string; userId?: number; source?: string; allClosed?: boolean }): Promise<{ stages: { stageId: number; count: number; total: number; deals: DealCard[]; hasMore: boolean }[] }>` (com `stageId`, só essa coluna)
  - `type DealCard = { id; title; value: number; userId; user: { id; name } | null; contact: { id; name; number; profilePicUrl }; stageId; position; status; stageEnteredAt; unread: number }`
  - `createDeal(v, data: DealInput & { funnelId: number; contactId: number; stageId?: number }): Promise<DealCard>`
  - `showDeal(v, id): Promise<{ deal: Deal; events: DealEvent[]; ticket: { id: number; uuid: string; status: string } | null }>`
  - `updateDeal(v, id, data: DealInput): Promise<DealCard>`
  - `moveDeal(v, id, data: { stageId: number; beforeId?: number | null; afterId?: number | null; lossReasonId?: number | null; lossNote?: string | null }): Promise<DealCard>`
  - `listContactDeals(v, contactId): Promise<{ id; title; value: number; funnelId; funnelName; stageId; stageName; stageColor }[]>`
  - `PAGE_SIZE = 50`, `CLOSED_WINDOW_DAYS = 30`

- [ ] **Step 1: Testes que falham (validação de entrada, pura)**

Extrair a validação para uma função exportada e testá-la: `sanitizeDealInput(data: DealInput): Record<string, unknown>`.

`__tests__/DealService.spec.ts`:

```ts
import { sanitizeDealInput } from "../DealService";

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit: jest.fn() }) }));

describe("sanitizeDealInput", () => {
  it("keeps only known fields and normalises them", () => {
    expect(
      sanitizeDealInput({
        title: "  Plano Pro ",
        value: "2400,50",
        source: "instagram",
        notes: " ligar depois ",
        expectedCloseDate: "2026-10-15",
        userId: 3,
        // @ts-expect-error unknown field is dropped
        status: "won"
      })
    ).toEqual({
      title: "Plano Pro",
      value: 2400.5,
      source: "instagram",
      notes: "ligar depois",
      expectedCloseDate: "2026-10-15",
      userId: 3
    });
  });
  it("refuses negative or non-numeric values", () => {
    expect(() => sanitizeDealInput({ value: -1 })).toThrow("ERR_CRM_INVALID_VALUE");
    expect(() => sanitizeDealInput({ value: "abc" })).toThrow("ERR_CRM_INVALID_VALUE");
  });
  it("refuses unknown sources and bad dates", () => {
    expect(() => sanitizeDealInput({ source: "tiktok" })).toThrow("ERR_CRM_INVALID_SOURCE");
    expect(() => sanitizeDealInput({ expectedCloseDate: "15/10/2026" })).toThrow("ERR_CRM_INVALID_DATE");
  });
  it("clears optional fields with empty values", () => {
    expect(sanitizeDealInput({ source: "", notes: "", expectedCloseDate: "", userId: null })).toEqual({
      source: null,
      notes: null,
      expectedCloseDate: null,
      userId: null
    });
  });
  it("refuses an empty title", () => {
    expect(() => sanitizeDealInput({ title: "   " })).toThrow("ERR_CRM_NAME_REQUIRED");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/services/CrmServices/__tests__/DealService.spec.ts --coverage=false`
Expected: FAIL com "Cannot find module '../DealService'".

- [ ] **Step 3: Implementar `DealService.ts`**

```ts
import { Op, fn, col, where as sqlWhere, WhereOptions } from "sequelize";
import { subDays } from "date-fns";
import AppError from "../../errors/AppError";
import { getIO } from "../../libs/socket";
import Deal from "../../models/Deal";
import DealEvent from "../../models/DealEvent";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Ticket from "../../models/Ticket";
import FunnelStage from "../../models/FunnelStage";
import Funnel from "../../models/Funnel";
import { DEAL_SOURCES } from "./defaults";
import { findVisibleFunnel, findVisibleStage, FunnelView } from "./FunnelService";
import { findActiveLossReason } from "./LossReasonService";
import { needsRenumber, positionBetween, renumber } from "./position";
import { stageChange } from "./transition";
import { canSeeDeal, ownerScope, Viewer } from "./visibility";

export const PAGE_SIZE = 50;
export const CLOSED_WINDOW_DAYS = 30;

export interface DealInput {
  title?: string;
  value?: number | string;
  userId?: number | null;
  expectedCloseDate?: string | null;
  source?: string | null;
  notes?: string | null;
}

export interface DealCard {
  id: number;
  title: string;
  value: number;
  userId: number | null;
  user: { id: number; name: string } | null;
  contact: { id: number; name: string; number: string; profilePicUrl: string };
  funnelId: number;
  stageId: number;
  position: number;
  status: string;
  stageEnteredAt: Date;
  unread: number;
}

const notFound = () => new AppError("ERR_CRM_NOT_FOUND", 404);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const blank = (s: unknown) => s === null || s === undefined || String(s).trim() === "";

// Whitelists and normalises editable deal fields.
export const sanitizeDealInput = (data: DealInput): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (data.title !== undefined) {
    if (blank(data.title)) throw new AppError("ERR_CRM_NAME_REQUIRED", 400);
    out.title = String(data.title).trim();
  }
  if (data.value !== undefined) {
    const n = typeof data.value === "number" ? data.value : parseFloat(String(data.value).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new AppError("ERR_CRM_INVALID_VALUE", 400);
    out.value = Math.round(n * 100) / 100;
  }
  if (data.source !== undefined) {
    if (blank(data.source)) out.source = null;
    else if (!DEAL_SOURCES.includes(String(data.source))) throw new AppError("ERR_CRM_INVALID_SOURCE", 400);
    else out.source = data.source;
  }
  if (data.notes !== undefined) out.notes = blank(data.notes) ? null : String(data.notes).trim();
  if (data.expectedCloseDate !== undefined) {
    if (blank(data.expectedCloseDate)) out.expectedCloseDate = null;
    else if (!DATE_RE.test(String(data.expectedCloseDate))) throw new AppError("ERR_CRM_INVALID_DATE", 400);
    else out.expectedCloseDate = data.expectedCloseDate;
  }
  if (data.userId !== undefined) out.userId = data.userId === null ? null : Number(data.userId);
  return out;
};

const cardInclude = [
  { model: Contact, as: "contact", attributes: ["id", "name", "number", "profilePicUrl"] },
  { model: User, as: "user", attributes: ["id", "name"] }
];

const unreadByContact = async (companyId: number, contactIds: number[]): Promise<Map<number, number>> => {
  if (!contactIds.length) return new Map();
  const rows: any[] = await Ticket.findAll({
    where: { companyId, contactId: { [Op.in]: contactIds } },
    attributes: ["contactId", [fn("SUM", col("unreadMessages")), "unread"]],
    group: ["contactId"],
    raw: true
  });
  return new Map(rows.map(r => [Number(r.contactId), Number(r.unread) || 0]));
};

const toCard = (d: Deal, unread: Map<number, number>): DealCard => ({
  id: d.id,
  title: d.title,
  value: Number(d.value),
  userId: d.userId,
  user: d.user ? { id: d.user.id, name: d.user.name } : null,
  contact: {
    id: d.contact.id,
    name: d.contact.name,
    number: d.contact.number,
    profilePicUrl: d.contact.profilePicUrl
  },
  funnelId: d.funnelId,
  stageId: d.stageId,
  position: d.position,
  status: d.status,
  stageEnteredAt: d.stageEnteredAt,
  unread: unread.get(d.contactId) || 0
});

const loadCard = async (companyId: number, id: number): Promise<DealCard> => {
  const deal = await Deal.findOne({ where: { id, companyId }, include: cardInclude });
  if (!deal) throw notFound();
  return toCard(deal, await unreadByContact(companyId, [deal.contactId]));
};

const emitDeal = (companyId: number, action: "create" | "update" | "delete", deal: DealCard) => {
  getIO().emit(`company-${companyId}-deal`, { action, deal });
};

const ownerWhere = (v: Viewer, funnel: FunnelView): WhereOptions | undefined => {
  const scope = ownerScope(v, funnel);
  if (scope === null) return undefined;
  return { [Op.or]: [{ userId: v.id }, { userId: null }] };
};

const assertUserInCompany = async (companyId: number, userId: unknown) => {
  if (userId === null || userId === undefined) return;
  const user = await User.findOne({ where: { id: userId as number, companyId }, attributes: ["id"] });
  if (!user) throw notFound();
};

const findVisibleDeal = async (v: Viewer, id: number): Promise<{ deal: Deal; funnel: FunnelView }> => {
  const deal = await Deal.findOne({ where: { id, companyId: v.companyId } });
  if (!deal) throw notFound();
  const funnel = await findVisibleFunnel(v, deal.funnelId);
  if (!canSeeDeal(v, funnel, deal)) throw notFound();
  return { deal, funnel };
};

export const listDeals = async (
  v: Viewer,
  funnelId: number,
  q: { stageId?: number; page?: number; search?: string; userId?: number; source?: string; allClosed?: boolean }
) => {
  const funnel = await findVisibleFunnel(v, funnelId);
  const stages = q.stageId ? funnel.stages.filter(s => s.id === q.stageId) : funnel.stages;
  if (q.stageId && !stages.length) throw notFound();
  const page = Math.max(1, Number(q.page) || 1);

  const base: any[] = [{ companyId: v.companyId, funnelId }];
  const owner = ownerWhere(v, funnel);
  if (owner) base.push(owner);
  if (q.userId) base.push({ userId: q.userId });
  if (q.source) base.push({ source: q.source });
  if (q.search && q.search.trim()) {
    const term = `%${q.search.trim().toLowerCase()}%`;
    base.push({
      [Op.or]: [
        sqlWhere(fn("LOWER", col("Deal.title")), "LIKE", term),
        sqlWhere(fn("LOWER", col("contact.name")), "LIKE", term),
        { "$contact.number$": { [Op.like]: `%${q.search.trim()}%` } }
      ]
    });
  }
  const since = subDays(new Date(), CLOSED_WINDOW_DAYS);

  const result = [];
  for (const stage of stages) {
    const conds = [...base, { stageId: stage.id }];
    if (stage.kind !== "open" && !q.allClosed) conds.push({ closedAt: { [Op.gte]: since } });
    const whereStage = { [Op.and]: conds };
    const [{ count, rows }, total] = await Promise.all([
      Deal.findAndCountAll({
        where: whereStage,
        include: cardInclude,
        order: [["position", "ASC"], ["id", "ASC"]],
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        distinct: true,
        subQuery: false
      }),
      Deal.sum("value", { where: whereStage, include: [{ model: Contact, as: "contact", attributes: [] }] } as any)
    ]);
    const unread = await unreadByContact(v.companyId, rows.map(r => r.contactId));
    result.push({
      stageId: stage.id,
      count,
      total: Number(total) || 0,
      deals: rows.map(r => toCard(r, unread)),
      hasMore: count > page * PAGE_SIZE
    });
  }
  return { stages: result };
};

const topPosition = async (companyId: number, stageId: number): Promise<number> => {
  const first = await Deal.findOne({
    where: { companyId, stageId },
    order: [["position", "ASC"]],
    attributes: ["position"]
  });
  return positionBetween(null, first ? first.position : null);
};

export const createDeal = async (
  v: Viewer,
  data: DealInput & { funnelId: number; contactId: number; stageId?: number }
): Promise<DealCard> => {
  const funnel = await findVisibleFunnel(v, Number(data.funnelId));
  if (funnel.archived) throw notFound();
  const stage = data.stageId
    ? funnel.stages.find(s => s.id === Number(data.stageId))
    : funnel.stages.find(s => s.kind === "open");
  if (!stage) throw notFound();
  if (stage.kind !== "open") throw new AppError("ERR_CRM_STAGE_LOCKED", 400);
  const contact = await Contact.findOne({ where: { id: data.contactId, companyId: v.companyId } });
  if (!contact) throw notFound();

  const fields = sanitizeDealInput(data);
  if (fields.userId === undefined) fields.userId = v.id;
  // Sellers limited to their own deals cannot hand new deals to others.
  if (ownerScope(v, funnel) !== null && fields.userId !== v.id && fields.userId !== null) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  await assertUserInCompany(v.companyId, fields.userId);

  const now = new Date();
  const id = await Deal.sequelize!.transaction(async transaction => {
    const deal = await Deal.create(
      {
        companyId: v.companyId,
        funnelId: funnel.id,
        stageId: stage.id,
        contactId: contact.id,
        title: (fields.title as string) || contact.name,
        value: fields.value ?? 0,
        userId: fields.userId,
        expectedCloseDate: fields.expectedCloseDate ?? null,
        source: fields.source ?? null,
        notes: fields.notes ?? null,
        status: "open",
        position: await topPosition(v.companyId, stage.id),
        stageEnteredAt: now
      } as any,
      { transaction }
    );
    await DealEvent.create(
      { companyId: v.companyId, dealId: deal.id, userId: v.id, type: "created", toValue: String(stage.id) } as any,
      { transaction }
    );
    return deal.id;
  });
  const card = await loadCard(v.companyId, id);
  emitDeal(v.companyId, "create", card);
  return card;
};

export const showDeal = async (v: Viewer, id: number) => {
  const { deal } = await findVisibleDeal(v, id);
  const [full, events, ticket] = await Promise.all([
    Deal.findOne({
      where: { id: deal.id, companyId: v.companyId },
      include: [...cardInclude, { model: FunnelStage, as: "stage" }, { model: Funnel, as: "funnel", attributes: ["id", "name"] }]
    }),
    DealEvent.findAll({
      where: { dealId: deal.id, companyId: v.companyId },
      include: [{ model: User, as: "user", attributes: ["id", "name"] }],
      order: [["createdAt", "DESC"]],
      limit: 100
    }),
    Ticket.findOne({
      where: { contactId: deal.contactId, companyId: v.companyId },
      attributes: ["id", "uuid", "status"],
      order: [["updatedAt", "DESC"]]
    })
  ]);
  return { deal: full, events, ticket: ticket ? { id: ticket.id, uuid: ticket.uuid, status: ticket.status } : null };
};

export const updateDeal = async (v: Viewer, id: number, data: DealInput): Promise<DealCard> => {
  const { deal, funnel } = await findVisibleDeal(v, id);
  const fields = sanitizeDealInput(data);
  if (fields.userId !== undefined) {
    if (ownerScope(v, funnel) !== null && fields.userId !== v.id && fields.userId !== null) {
      throw new AppError("ERR_NO_PERMISSION", 403);
    }
    await assertUserInCompany(v.companyId, fields.userId);
  }
  const changed = Object.keys(fields).filter(k => {
    const before = (deal as any)[k];
    const after = fields[k];
    return k === "value" ? Number(before) !== after : (before ?? null) !== after;
  });
  if (!changed.length) return loadCard(v.companyId, deal.id);

  await Deal.sequelize!.transaction(async transaction => {
    const events: any[] = [];
    if (changed.includes("userId")) {
      events.push({ type: "owner_changed", fromValue: deal.userId === null ? null : String(deal.userId), toValue: fields.userId === null ? null : String(fields.userId) });
    }
    const others = changed.filter(k => k !== "userId");
    if (others.length) events.push({ type: "edited", fromValue: null, toValue: others.join(",") });
    await deal.update(Object.fromEntries(changed.map(k => [k, fields[k]])), { transaction });
    await DealEvent.bulkCreate(
      events.map(e => ({ ...e, companyId: v.companyId, dealId: deal.id, userId: v.id })) as any,
      { transaction }
    );
  });
  const card = await loadCard(v.companyId, deal.id);
  emitDeal(v.companyId, "update", card);
  return card;
};

const neighbourPosition = async (companyId: number, stageId: number, dealId: number | null | undefined) => {
  if (!dealId) return null;
  const n = await Deal.findOne({ where: { id: dealId, companyId, stageId }, attributes: ["position"] });
  if (!n) throw notFound();
  return n.position;
};

export const moveDeal = async (
  v: Viewer,
  id: number,
  data: { stageId: number; beforeId?: number | null; afterId?: number | null; lossReasonId?: number | null; lossNote?: string | null }
): Promise<DealCard> => {
  const { deal } = await findVisibleDeal(v, id);
  const { stage, funnel: target } = await findVisibleStage(v, Number(data.stageId));
  if (!canSeeDeal(v, target, deal)) throw notFound();
  if (stage.kind === "lost") {
    if (!data.lossReasonId || !(await findActiveLossReason(v.companyId, Number(data.lossReasonId)))) {
      throw new AppError("ERR_CRM_LOSS_REASON_REQUIRED", 400);
    }
  }
  const { patch, events } = stageChange(
    deal,
    { id: stage.id, kind: stage.kind },
    { lossReasonId: data.lossReasonId ? Number(data.lossReasonId) : null, lossNote: data.lossNote ?? null },
    new Date()
  );
  if (target.id !== deal.funnelId) patch.funnelId = target.id;

  await Deal.sequelize!.transaction(async transaction => {
    let before = await neighbourPosition(v.companyId, stage.id, data.beforeId);
    let after = await neighbourPosition(v.companyId, stage.id, data.afterId);
    if (needsRenumber(before, after)) {
      const ordered = await Deal.findAll({
        where: { companyId: v.companyId, stageId: stage.id, id: { [Op.ne]: deal.id } },
        order: [["position", "ASC"], ["id", "ASC"]],
        attributes: ["id"],
        transaction
      });
      for (const p of renumber(ordered)) {
        await Deal.update({ position: p.position }, { where: { id: p.id, companyId: v.companyId }, transaction });
      }
      before = await neighbourPosition(v.companyId, stage.id, data.beforeId);
      after = await neighbourPosition(v.companyId, stage.id, data.afterId);
    }
    await deal.update({ ...patch, position: positionBetween(before, after) }, { transaction });
    if (events.length) {
      await DealEvent.bulkCreate(
        events.map(e => ({ ...e, companyId: v.companyId, dealId: deal.id, userId: v.id })) as any,
        { transaction }
      );
    }
  });
  const card = await loadCard(v.companyId, deal.id);
  emitDeal(v.companyId, "update", card);
  return card;
};

export const listContactDeals = async (v: Viewer, contactId: number) => {
  const deals = await Deal.findAll({
    where: { companyId: v.companyId, contactId, status: "open" },
    include: [
      { model: FunnelStage, as: "stage", attributes: ["id", "name", "color"] },
      { model: Funnel, as: "funnel", attributes: ["id", "name"] }
    ],
    order: [["updatedAt", "DESC"]]
  });
  const visible = [];
  for (const d of deals) {
    try {
      const funnel = await findVisibleFunnel(v, d.funnelId);
      if (!funnel.archived && canSeeDeal(v, funnel, d)) visible.push(d);
    } catch (e) {
      // funnel hidden from this user
    }
  }
  return visible.map(d => ({
    id: d.id,
    title: d.title,
    value: Number(d.value),
    funnelId: d.funnelId,
    funnelName: d.funnel.name,
    stageId: d.stageId,
    stageName: d.stage.name,
    stageColor: d.stage.color
  }));
};
```

Nota: `ERR_CRM_INVALID_VALUE`, `ERR_CRM_INVALID_SOURCE`, `ERR_CRM_INVALID_DATE` (400) são códigos novos; entram na tabela de erros da Task 7.

- [ ] **Step 4: Rodar e ver passar; compilar**

Run: `npx jest src/services/CrmServices --coverage=false && npx tsc --noEmit -p .`
Expected: PASS; `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/services/CrmServices/DealService.ts src/services/CrmServices/__tests__/DealService.spec.ts
git commit -m "Adiciona o serviço de negócios do CRM com movimento e histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Controller e rotas `/crm`

**Files:**
- Create: `whatsapp-api/src/controllers/CrmController.ts`
- Create: `whatsapp-api/src/routes/crmRoutes.ts`
- Modify: `whatsapp-api/src/routes/index.ts` (import e `routes.use(crmRoutes);` depois de `routes.use(aiAgentRoutes);`)
- Test: `whatsapp-api/src/routes/__tests__/crmRoutes.spec.ts`

**Interfaces:**
- Consumes: tudo de Tasks 3–5; `getViewer`.
- Produces: rotas HTTP da tabela abaixo (usadas pelos passos 2–4 do frontend).

| Método e rota | Handler | Serviço |
|---|---|---|
| `GET /crm/funnels?includeArchived` | `listFunnelsHandler` | `listFunnels` |
| `POST /crm/funnels` | `createFunnelHandler` | `createFunnel` |
| `PUT /crm/funnels/:funnelId` | `updateFunnelHandler` | `updateFunnel` |
| `POST /crm/funnels/:funnelId/archive` body `{ archived }` | `archiveFunnelHandler` | `setFunnelArchived` |
| `POST /crm/funnels/:funnelId/stages` | `createStageHandler` | `createStage` |
| `PUT /crm/funnels/:funnelId/stages/order` body `{ stageIds }` | `reorderStagesHandler` | `reorderStages` |
| `PUT /crm/funnels/:funnelId/stages/:stageId` | `updateStageHandler` | `updateStage` |
| `DELETE /crm/funnels/:funnelId/stages/:stageId?moveTo` | `deleteStageHandler` | `deleteStage` |
| `GET /crm/funnels/:funnelId/deals?stageId&page&search&userId&source&allClosed` | `listDealsHandler` | `listDeals` |
| `POST /crm/deals` | `createDealHandler` | `createDeal` |
| `GET /crm/deals/:dealId` | `showDealHandler` | `showDeal` |
| `PUT /crm/deals/:dealId` | `updateDealHandler` | `updateDeal` |
| `PUT /crm/deals/:dealId/move` | `moveDealHandler` | `moveDeal` |
| `GET /crm/contacts/:contactId/deals` | `contactDealsHandler` | `listContactDeals` |
| `GET /crm/loss-reasons` | `listLossReasonsHandler` | `listLossReasons` |
| `POST /crm/loss-reasons` (admin) | `createLossReasonHandler` | `createLossReason` |
| `PUT /crm/loss-reasons/:id` (admin) | `updateLossReasonHandler` | `updateLossReason` |

- [ ] **Step 1: Teste que falha (proteção das rotas)**

`src/routes/__tests__/crmRoutes.spec.ts`:

```ts
import crmRoutes from "../crmRoutes";
import requirePlanFeature from "../../middleware/requirePlanFeature";

jest.mock("../../middleware/requirePlanFeature", () => {
  const guard = jest.fn((_req: any, _res: any, next: any) => next());
  return { __esModule: true, default: jest.fn(() => guard) };
});

describe("crmRoutes", () => {
  it("guards every route with isAuth and the useCrm plan feature", () => {
    expect(requirePlanFeature).toHaveBeenCalledWith("useCrm");
    const stacks = (crmRoutes as any).stack.map((layer: any) => ({
      path: layer.route.path,
      handlers: layer.route.stack.map((s: any) => s.handle)
    }));
    expect(stacks.length).toBe(17);
    const guard = (requirePlanFeature as jest.Mock).mock.results[0].value;
    for (const s of stacks) {
      expect(s.handlers[0].name).toBe("isAuth");
      expect(s.handlers[1]).toBe(guard);
    }
  });
  it("declares stages/order before stages/:stageId", () => {
    const paths = (crmRoutes as any).stack.map((l: any) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(paths.indexOf("put /crm/funnels/:funnelId/stages/order")).toBeLessThan(
      paths.indexOf("put /crm/funnels/:funnelId/stages/:stageId")
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/routes/__tests__/crmRoutes.spec.ts --coverage=false`
Expected: FAIL com "Cannot find module '../crmRoutes'".

- [ ] **Step 3: Implementar controller e rotas**

`src/controllers/CrmController.ts`:

```ts
import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { getViewer } from "../services/CrmServices/viewer";
import {
  listFunnels, createFunnel, updateFunnel, setFunnelArchived,
  createStage, updateStage, deleteStage, reorderStages
} from "../services/CrmServices/FunnelService";
import {
  listDeals, createDeal, showDeal, updateDeal, moveDeal, listContactDeals
} from "../services/CrmServices/DealService";
import { listLossReasons, createLossReason, updateLossReason } from "../services/CrmServices/LossReasonService";

const viewer = (req: Request) => getViewer(req.user as any);
const num = (value: unknown) => Number(value);
const admin = (req: Request) => {
  if (req.user.profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403);
};

export const listFunnelsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listFunnels(await viewer(req), { includeArchived: req.query.includeArchived === "true" }));

export const createFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createFunnel(await viewer(req), req.body));

export const updateFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateFunnel(await viewer(req), num(req.params.funnelId), req.body));

export const archiveFunnelHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await setFunnelArchived(await viewer(req), num(req.params.funnelId), req.body.archived !== false));

export const createStageHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createStage(await viewer(req), num(req.params.funnelId), req.body));

export const reorderStagesHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await reorderStages(await viewer(req), num(req.params.funnelId), (req.body.stageIds || []).map(num)));

export const updateStageHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateStage(await viewer(req), num(req.params.funnelId), num(req.params.stageId), req.body));

export const deleteStageHandler = async (req: Request, res: Response): Promise<Response> => {
  const moveTo = req.query.moveTo ? num(req.query.moveTo) : undefined;
  await deleteStage(await viewer(req), num(req.params.funnelId), num(req.params.stageId), moveTo);
  return res.status(204).send();
};

export const listDealsHandler = async (req: Request, res: Response): Promise<Response> => {
  const q = req.query as Record<string, string>;
  return res.json(
    await listDeals(await viewer(req), num(req.params.funnelId), {
      stageId: q.stageId ? num(q.stageId) : undefined,
      page: q.page ? num(q.page) : 1,
      search: q.search,
      userId: q.userId ? num(q.userId) : undefined,
      source: q.source || undefined,
      allClosed: q.allClosed === "true"
    })
  );
};

export const createDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.status(201).json(await createDeal(await viewer(req), req.body));

export const showDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await showDeal(await viewer(req), num(req.params.dealId)));

export const updateDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await updateDeal(await viewer(req), num(req.params.dealId), req.body));

export const moveDealHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await moveDeal(await viewer(req), num(req.params.dealId), req.body));

export const contactDealsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listContactDeals(await viewer(req), num(req.params.contactId)));

export const listLossReasonsHandler = async (req: Request, res: Response): Promise<Response> =>
  res.json(await listLossReasons(req.user.companyId));

export const createLossReasonHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.status(201).json(await createLossReason(req.user.companyId, req.body.name));
};

export const updateLossReasonHandler = async (req: Request, res: Response): Promise<Response> => {
  admin(req);
  return res.json(await updateLossReason(req.user.companyId, num(req.params.id), req.body));
};
```

`src/routes/crmRoutes.ts`:

```ts
import express from "express";
import isAuth from "../middleware/isAuth";
import requirePlanFeature from "../middleware/requirePlanFeature";
import * as CrmController from "../controllers/CrmController";

// The CRM is sold per plan.
const crmInPlan = requirePlanFeature("useCrm");

const crmRoutes = express.Router();

crmRoutes.get("/crm/funnels", isAuth, crmInPlan, CrmController.listFunnelsHandler);
crmRoutes.post("/crm/funnels", isAuth, crmInPlan, CrmController.createFunnelHandler);
crmRoutes.put("/crm/funnels/:funnelId", isAuth, crmInPlan, CrmController.updateFunnelHandler);
crmRoutes.post("/crm/funnels/:funnelId/archive", isAuth, crmInPlan, CrmController.archiveFunnelHandler);
crmRoutes.post("/crm/funnels/:funnelId/stages", isAuth, crmInPlan, CrmController.createStageHandler);
// Before /stages/:stageId, otherwise "order" is read as a stageId.
crmRoutes.put("/crm/funnels/:funnelId/stages/order", isAuth, crmInPlan, CrmController.reorderStagesHandler);
crmRoutes.put("/crm/funnels/:funnelId/stages/:stageId", isAuth, crmInPlan, CrmController.updateStageHandler);
crmRoutes.delete("/crm/funnels/:funnelId/stages/:stageId", isAuth, crmInPlan, CrmController.deleteStageHandler);
crmRoutes.get("/crm/funnels/:funnelId/deals", isAuth, crmInPlan, CrmController.listDealsHandler);

crmRoutes.post("/crm/deals", isAuth, crmInPlan, CrmController.createDealHandler);
crmRoutes.get("/crm/deals/:dealId", isAuth, crmInPlan, CrmController.showDealHandler);
crmRoutes.put("/crm/deals/:dealId", isAuth, crmInPlan, CrmController.updateDealHandler);
crmRoutes.put("/crm/deals/:dealId/move", isAuth, crmInPlan, CrmController.moveDealHandler);
crmRoutes.get("/crm/contacts/:contactId/deals", isAuth, crmInPlan, CrmController.contactDealsHandler);

crmRoutes.get("/crm/loss-reasons", isAuth, crmInPlan, CrmController.listLossReasonsHandler);
crmRoutes.post("/crm/loss-reasons", isAuth, crmInPlan, CrmController.createLossReasonHandler);
crmRoutes.put("/crm/loss-reasons/:id", isAuth, crmInPlan, CrmController.updateLossReasonHandler);

export default crmRoutes;
```

Em `src/routes/index.ts`: `import crmRoutes from "./crmRoutes";` junto dos outros imports e `routes.use(crmRoutes);` logo depois de `routes.use(aiAgentRoutes);`.

- [ ] **Step 4: Rodar e ver passar; compilar**

Run: `npx jest src/routes/__tests__/crmRoutes.spec.ts src/services/CrmServices --coverage=false && npx tsc --noEmit -p .`
Expected: PASS; `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/CrmController.ts src/routes/crmRoutes.ts src/routes/index.ts src/routes/__tests__/crmRoutes.spec.ts
git commit -m "Expõe a API do CRM em /crm, liberada pelo plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CRM na tela de Planos e mensagens de erro

**Files:**
- Modify: `whatsapp-app/src/components/PlansManager/index.js` (lista `FEATURES`, `emptyPlan`, `PlanSchema`, campos numéricos, `handleSubmit`)
- Modify: `whatsapp-app/src/translate/languages/pt.js` (bloco dos erros do backend, onde está `ERR_PLAN_FEATURE_NOT_AVAILABLE`)
- Modify: `whatsapp-api/docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md` (tabela de erros)

**Interfaces:**
- Consumes: `Plans.useCrm`, `Plans.crmFunnels` (Task 1).
- Produces: planos editáveis com CRM; textos dos erros `ERR_CRM_*` para o `toastError`.

- [ ] **Step 1: Editar `PlansManager`**

Na lista `FEATURES`, depois do item `useAiAgents`:

```js
    { key: "useCrm", label: "CRM / Funil de vendas", defaultOn: false },
```

Em `emptyPlan`, depois de `value: 0,`:

```js
    crmFunnels: 1,
```

Em `PlanSchema`, depois de `value: ...`:

```js
    crmFunnels: Yup.number().min(0, "Não pode ser negativo").required("Obrigatório"),
```

Depois da linha `<Grid item xs={4}>{numberField("queues", "Filas")}</Grid>`:

```js
                                <Grid item xs={4}>
                                    {numberField("crmFunnels", "Limite de funis", {
                                        helperText: "0 = ilimitado",
                                        disabled: !values.useCrm,
                                    })}
                                </Grid>
```

O `numberField` hoje só repassa `inputProps` e `InputProps`. Nele, trocar
`helperText={meta.touched && meta.error}` por
`helperText={(meta.touched && meta.error) || extra.helperText}` e acrescentar
`disabled={extra.disabled}` logo abaixo.

Em `handleSubmit`, no objeto `data`, depois de `queues: ...`:

```js
            crmFunnels: Math.max(0, Math.floor(Number(values.crmFunnels) || 0)),
```

- [ ] **Step 2: Textos dos erros**

No bloco de erros do backend em `pt.js`, junto de `ERR_PLAN_FEATURE_NOT_AVAILABLE`:

```js
      ERR_CRM_NOT_FOUND: "Item do CRM não encontrado.",
      ERR_CRM_NAME_REQUIRED: "Informe um nome.",
      ERR_CRM_FUNNEL_LIMIT: "O plano da sua empresa chegou ao limite de funis.",
      ERR_CRM_LOSS_REASON_REQUIRED: "Escolha o motivo da perda.",
      ERR_CRM_STAGE_NOT_EMPTY: "Mova os negócios desta coluna antes de apagá-la.",
      ERR_CRM_STAGE_LOCKED: "As colunas Ganho e Perdido não podem ser alteradas assim.",
      ERR_CRM_STAGE_ORDER: "A ordem das colunas está desatualizada. Recarregue a página.",
      ERR_CRM_INVALID_VALUE: "Valor inválido.",
      ERR_CRM_INVALID_SOURCE: "Origem inválida.",
      ERR_CRM_INVALID_DATE: "Data inválida.",
```

- [ ] **Step 3: Atualizar a tabela de erros da spec**

Acrescentar à tabela "Erros" da spec: `ERR_CRM_STAGE_ORDER` (400), `ERR_CRM_NOT_FOUND` (404), `ERR_CRM_NAME_REQUIRED` (400), `ERR_CRM_INVALID_VALUE`/`ERR_CRM_INVALID_SOURCE`/`ERR_CRM_INVALID_DATE` (400), `ERR_NO_PERMISSION` (403, configuração sem ser admin ou vendedor com `ownDealsOnly` passando negócio para outro).

- [ ] **Step 4: Lint e conferência visual**

Run: `cd whatsapp-app && npx eslint src/components/PlansManager/index.js src/translate`
Expected: sem erros novos.

No navegador (preview "frontend"), abrir Planos → editar o plano: aparece o interruptor "CRM / Funil de vendas" desligado e "Limite de funis" desabilitado; ligar, pôr 2, salvar, reabrir e ver os valores mantidos.

- [ ] **Step 5: Commit (dois repositórios)**

```bash
cd whatsapp-app && git add src/components/PlansManager/index.js src/translate/languages/pt.js && git commit -m "Adiciona o CRM e o limite de funis na tela de Planos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd ../whatsapp-api && git add docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md && git commit -m "Completa a tabela de erros da spec do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Smoke test da API no HM

**Files:**
- Create: `whatsapp-api/scripts/crm-smoke.sh` (roteiro reutilizável nas próximas etapas)

**Interfaces:**
- Consumes: a API das Tasks 1–7 rodando no HM (preview "backend", porta 3001).

- [ ] **Step 1: Escrever o roteiro**

```bash
#!/usr/bin/env bash
# CRM API smoke test against a running backend. Usage:
#   TOKEN=<jwt> API=http://localhost:3001 CONTACT_ID=<id> scripts/crm-smoke.sh
set -euo pipefail
API=${API:-http://localhost:3001}
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
call() { curl -s -o /tmp/crm-smoke.json -w "%{http_code}" -X "$1" "${H[@]}" "$API$2" ${3:+-d "$3"}; }
expect() { local got; got=$(call "$1" "$2" "${4:-}"); if [ "$got" != "$3" ]; then echo "FAIL $1 $2 -> $got (esperado $3)"; cat /tmp/crm-smoke.json; exit 1; fi; echo "ok   $1 $2 -> $got"; }
jqv() { node -e "const d=require('/tmp/crm-smoke.json');console.log($1)"; }

expect POST /crm/funnels 201 '{"name":"Smoke"}'
FUNNEL=$(jqv 'd.id'); OPEN1=$(jqv 'd.stages[0].id'); OPEN2=$(jqv 'd.stages[1].id')
WON=$(jqv 'd.stages.find(s=>s.kind==="won").id'); LOST=$(jqv 'd.stages.find(s=>s.kind==="lost").id')
expect GET /crm/funnels 200
expect POST /crm/deals 201 "{\"funnelId\":$FUNNEL,\"contactId\":$CONTACT_ID,\"value\":\"1200,50\"}"
DEAL=$(jqv 'd.id')
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$OPEN2}"
expect PUT /crm/deals/$DEAL/move 400 "{\"stageId\":$LOST}"
expect GET /crm/loss-reasons 200
REASON=$(jqv 'd[0].id')
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$LOST,\"lossReasonId\":$REASON}"
expect PUT /crm/deals/$DEAL/move 200 "{\"stageId\":$OPEN1}"
expect GET /crm/deals/$DEAL 200
jqv 'd.events.map(e=>e.type).join(",")'
expect GET "/crm/funnels/$FUNNEL/deals" 200
expect GET /crm/deals/999999 404
expect PUT /crm/funnels/$FUNNEL/stages/$WON 400 '{"archived":true}'
expect DELETE /crm/funnels/$FUNNEL/stages/$OPEN1 400
expect POST /crm/funnels 403 '{"name":"Passa do limite"}'
expect POST /crm/funnels/$FUNNEL/archive 200 '{"archived":true}'
echo "smoke ok (funil $FUNNEL arquivado)"
```

- [ ] **Step 2: Preparar o HM e rodar**

1. `cd whatsapp-api && npx tsc -p .`; parar o preview "backend" (`preview_stop`), conferir `ps aux | grep "dist/server"` sem processo, iniciar de novo (`preview_start` "backend").
2. Ligar o CRM no plano do HM com limite 1: `docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c 'update "Plans" set "useCrm"=true, "crmFunnels"=1 where id=1;'`
3. Pegar o token pelo navegador logado (`JSON.parse(localStorage.getItem("token"))`) e um contato: `docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -t -c 'select id from "Contacts" where "companyId"=1 and "isGroup"=false limit 1;'`

Run: `TOKEN=<token> CONTACT_ID=<id> bash scripts/crm-smoke.sh`
Expected: todas as linhas `ok`; a linha de eventos contém `created`, `lost` e `reopened` e três `stage_changed` (eventos do mesmo movimento têm o mesmo horário, então a ordem entre eles pode variar); termina com `smoke ok`.

- [ ] **Step 3: Conferir o bloqueio por plano**

Run: `docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c 'update "Plans" set "useCrm"=false where id=1;'` e `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" http://localhost:3001/crm/funnels`
Expected: `403`. Depois deixar `useCrm=true` no HM para as próximas etapas.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `cd whatsapp-api && npx jest --coverage=false`
Expected: todas as suítes passam (as antigas e as novas).

- [ ] **Step 5: Commit**

```bash
git add scripts/crm-smoke.sh
git commit -m "Adiciona roteiro de smoke test da API do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Publicação em produção fica para quando o passo 2 (tela do funil) estiver pronto, e só com o usuário: a migration roda sozinha no deploy da api (Dockerfile) e o CRM nasce desligado em todos os planos.
