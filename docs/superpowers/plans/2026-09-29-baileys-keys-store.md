# Chaves do Baileys em tabela própria — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar as chaves de sinal do Baileys do JSON único em `Whatsapps.session`, guardando uma linha por chave em `BaileysKeys`, e parar os crons de minuto de carregar a conexão inteira por ticket.

**Architecture:** Um `SignalKeyStore` puro em `helpers/baileysKeyStore.ts` fala com um repositório injetável (`KeyRepo`); a implementação Sequelize do repositório vive no mesmo módulo que o modelo `BaileysKey`. `authState.ts` passa a montar creds a partir de `Whatsapps.session` (só creds) e as chaves a partir do store. Uma migration converte o JSON atual em linhas e preserva o original na tabela `WhatsappSessionBackups` (sem modelo). Os crons ganham regras puras e testadas que decidem se há algo a fazer antes de consultar tickets.

**Tech Stack:** Node 24, TypeScript, Sequelize + sequelize-typescript, Postgres 18, Baileys 7.0.0-rc14 (ESM; **não importar nos módulos testados**, o Jest 27 não carrega), Jest 27 + ts-jest.

**Spec:** `docs/superpowers/specs/2026-09-29-baileys-keys-store-design.md`

## Global Constraints

- Módulos com teste não importam `@whiskeysockets/baileys` (ESM); `authState.ts` e `wbot.ts` podem.
- Migrations em `src/database/migrations/` com prefixo `YYYYMMDDHHmmss`, `module.exports = { up, down }`, tipos de `sequelize`.
- Nomes de tipo de chave são os do Baileys: `pre-key`, `session`, `sender-key`, `app-state-sync-key`, `app-state-sync-version`, `sender-key-memory`, `lid-mapping`, `device-list`, `tctoken`, `identity-key`.
- Valores gravados com o mesmo formato do `BufferJSON` do Baileys (`{"type":"Buffer","data":"<base64>"}`), para a migration poder copiar o JSON antigo sem reprocessar.
- Rodar testes com `npm test -- <caminho>`; compilar com `npx tsc -p .`; migrar com `npx sequelize db:migrate` (HM: Postgres local na porta 5435, db/user `sweasy`).
- Commits em português, no imperativo, sem incluir `Dockerfile`, `.dockerignore` e `nginx.conf`.

## Review Focus

1. Chave com valor `null` no `keys.set` (o Baileys apaga assim) — deve remover a linha, não gravar `"null"`. Teste na Task 1.
2. `get` com lista vazia de ids — não deve ir ao banco e deve devolver `{}`. Teste na Task 1.
3. Valor com `Buffer` aninhado (pre-key `{ private, public }`) — deve voltar como `Buffer` depois de gravar e ler. Teste na Task 1.
4. Sessão antiga vazia ou inválida na migration — deve pular a conexão sem quebrar a migration. Coberto na Task 2 (migration ignora `session` vazia e captura erro de parse).
5. Empresa sem nenhuma conexão com expiração/transferência — cron não deve consultar tickets. Teste na Task 5.

---

### Task 1: Store puro de chaves com repositório injetável

**Files:**
- Create: `src/helpers/baileysKeyStore.ts`
- Test: `src/helpers/__tests__/baileysKeyStore.spec.ts`

**Interfaces:**
- Produces:
  - `type KeyRow = { type: string; keyId: string; value: string }`
  - `interface KeyRepo { find(type, ids): Promise<KeyRow[]>; upsert(rows: KeyRow[]): Promise<void>; remove(type, ids): Promise<void> }`
  - `bufferJson = { replacer, reviver }` (equivalente ao `BufferJSON` do Baileys)
  - `serializeKey(value: unknown): string`, `parseKey(value: string): unknown`
  - `makeSignalKeyStore(repo: KeyRepo, options?: { reviveAppStateSyncKey?: (v: unknown) => unknown })` devolvendo `{ get(type, ids), set(data) }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/helpers/__tests__/baileysKeyStore.spec.ts
import { KeyRepo, KeyRow, makeSignalKeyStore, parseKey, serializeKey } from "../baileysKeyStore";

const memoryRepo = () => {
  const rows = new Map<string, KeyRow>();
  const k = (type: string, id: string) => `${type}:${id}`;
  const repo: KeyRepo & { rows: Map<string, KeyRow>; finds: number } = {
    rows,
    finds: 0,
    async find(type, ids) {
      repo.finds += 1;
      return ids.map(id => rows.get(k(type, id))).filter(Boolean) as KeyRow[];
    },
    async upsert(list) {
      list.forEach(r => rows.set(k(r.type, r.keyId), r));
    },
    async remove(type, ids) {
      ids.forEach(id => rows.delete(k(type, id)));
    }
  };
  return repo;
};

describe("baileysKeyStore", () => {
  it("round-trips Buffers inside a key value", () => {
    const value = { private: Buffer.from("abc"), public: Buffer.from("xyz"), n: 1 };
    const back = parseKey(serializeKey(value)) as any;
    expect(Buffer.isBuffer(back.private)).toBe(true);
    expect(back.private.toString()).toBe("abc");
    expect(back.n).toBe(1);
    expect(serializeKey(value)).toContain('"type":"Buffer"');
  });

  it("stores only the keys that changed and returns only the ids found", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    await store.set({ "pre-key": { "1": { keyPair: { private: Buffer.from("p") } } as any, "2": { keyPair: {} } as any } });
    expect(repo.rows.size).toBe(2);

    const got = (await store.get("pre-key", ["1", "3"])) as any;
    expect(Object.keys(got)).toEqual(["1"]);
    expect(Buffer.isBuffer(got["1"].keyPair.private)).toBe(true);
  });

  it("removes a key when Baileys sets it to null", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    await store.set({ session: { "a@1": { x: 1 } as any } });
    await store.set({ session: { "a@1": null } });
    expect(repo.rows.size).toBe(0);
  });

  it("does not hit the repository for an empty id list", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    expect(await store.get("session", [])).toEqual({});
    expect(repo.finds).toBe(0);
  });

  it("revives app-state-sync-key values through the given hook", async () => {
    const repo = memoryRepo();
    const revive = jest.fn(v => ({ revived: v }));
    const store = makeSignalKeyStore(repo, { reviveAppStateSyncKey: revive });
    await store.set({ "app-state-sync-key": { k1: { keyData: Buffer.from("d") } as any } });
    const got = (await store.get("app-state-sync-key", ["k1"])) as any;
    expect(revive).toHaveBeenCalledTimes(1);
    expect(got.k1.revived.keyData.toString()).toBe("d");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/helpers/__tests__/baileysKeyStore.spec.ts`
Expected: FAIL, "Cannot find module '../baileysKeyStore'".

- [ ] **Step 3: Implementar**

```ts
// src/helpers/baileysKeyStore.ts
// Signal key store do Baileys sobre um repositório de linhas (type, keyId, value).
// Não importa o pacote do Baileys (ESM) para poder ser testado no Jest.

export type KeyRow = { type: string; keyId: string; value: string };

export interface KeyRepo {
  find(type: string, ids: string[]): Promise<KeyRow[]>;
  upsert(rows: KeyRow[]): Promise<void>;
  remove(type: string, ids: string[]): Promise<void>;
}

// Mesmo formato do BufferJSON do Baileys: { type: "Buffer", data: "<base64>" }.
export const bufferJson = {
  replacer: (_: string, value: any): unknown => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") };
    }
    return value;
  },
  reviver: (_: string, value: any): unknown => {
    if (typeof value === "object" && value !== null && value.type === "Buffer" && typeof value.data === "string") {
      return Buffer.from(value.data, "base64");
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every(k => !Number.isNaN(parseInt(k, 10)))) {
        const values = Object.values(value);
        if (values.every(v => typeof v === "number")) return Buffer.from(values as number[]);
      }
    }
    return value;
  }
};

export const serializeKey = (value: unknown): string => JSON.stringify(value, bufferJson.replacer);
export const parseKey = (value: string): unknown => JSON.parse(value, bufferJson.reviver);

type KeyData = { [type: string]: { [id: string]: unknown } };

export interface SignalKeyStoreLike {
  get(type: string, ids: string[]): Promise<{ [id: string]: any }>;
  set(data: KeyData): Promise<void>;
}

export const makeSignalKeyStore = (
  repo: KeyRepo,
  options: { reviveAppStateSyncKey?: (value: unknown) => unknown } = {}
): SignalKeyStoreLike => ({
  get: async (type, ids) => {
    if (!ids.length) return {};
    const rows = await repo.find(type, ids);
    const out: { [id: string]: unknown } = {};
    for (const row of rows) {
      let value = parseKey(row.value);
      if (type === "app-state-sync-key" && options.reviveAppStateSyncKey) {
        value = options.reviveAppStateSyncKey(value);
      }
      out[row.keyId] = value;
    }
    return out;
  },
  set: async data => {
    const upserts: KeyRow[] = [];
    const removals: { [type: string]: string[] } = {};
    for (const type of Object.keys(data)) {
      const entries = data[type] || {};
      for (const keyId of Object.keys(entries)) {
        const value = entries[keyId];
        if (value === null || value === undefined) {
          (removals[type] = removals[type] || []).push(keyId);
        } else {
          upserts.push({ type, keyId, value: serializeKey(value) });
        }
      }
    }
    if (upserts.length) await repo.upsert(upserts);
    for (const type of Object.keys(removals)) await repo.remove(type, removals[type]);
  }
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/helpers/__tests__/baileysKeyStore.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/helpers/baileysKeyStore.ts src/helpers/__tests__/baileysKeyStore.spec.ts
git commit -m "Cria o store de chaves do Baileys sobre um repositório"
```

---

### Task 2: Modelo `BaileysKey`, repositório Sequelize e migration de conversão

**Files:**
- Create: `src/models/BaileysKey.ts`
- Create: `src/database/migrations/20260929100000-create-baileys-keys.ts`
- Modify: `src/database/index.ts` (registrar o modelo na lista `models`)

**Interfaces:**
- Consumes: `KeyRepo`, `KeyRow` da Task 1.
- Produces:
  - modelo `BaileysKey` (`whatsappId`, `type`, `keyId`, `value`, timestamps; PK composta)
  - `sequelizeKeyRepo(whatsappId: number): KeyRepo`
  - `clearBaileysKeys(whatsappId: number): Promise<void>`
  - `readKeysOfType(whatsappId: number, type: string): Promise<{ [id: string]: unknown }>`

- [ ] **Step 1: Modelo**

```ts
// src/models/BaileysKey.ts
import { Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, ForeignKey, DataType } from "sequelize-typescript";
import { Op } from "sequelize";
import Whatsapp from "./Whatsapp";
import { KeyRepo, KeyRow, parseKey } from "../helpers/baileysKeyStore";

// Uma linha por chave de sinal do Baileys (pre-key, session, sender-key, ...).
@Table({ tableName: "BaileysKeys" })
class BaileysKey extends Model<BaileysKey> {
  @PrimaryKey
  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @PrimaryKey
  @Column
  type: string;

  @PrimaryKey
  @Column
  keyId: string;

  @Column(DataType.TEXT)
  value: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export const sequelizeKeyRepo = (whatsappId: number): KeyRepo => ({
  async find(type, ids) {
    const rows = await BaileysKey.findAll({
      where: { whatsappId, type, keyId: { [Op.in]: ids } },
      attributes: ["type", "keyId", "value"]
    });
    return rows.map(r => ({ type: r.type, keyId: r.keyId, value: r.value }));
  },
  async upsert(rows: KeyRow[]) {
    const now = new Date();
    await BaileysKey.bulkCreate(
      rows.map(r => ({ whatsappId, ...r, createdAt: now, updatedAt: now })) as any,
      { updateOnDuplicate: ["value", "updatedAt"] }
    );
  },
  async remove(type, ids) {
    await BaileysKey.destroy({ where: { whatsappId, type, keyId: { [Op.in]: ids } } });
  }
});

export const clearBaileysKeys = async (whatsappId: number): Promise<void> => {
  await BaileysKey.destroy({ where: { whatsappId } });
};

export const readKeysOfType = async (whatsappId: number, type: string): Promise<{ [id: string]: unknown }> => {
  const rows = await BaileysKey.findAll({ where: { whatsappId, type }, attributes: ["keyId", "value"] });
  const out: { [id: string]: unknown } = {};
  rows.forEach(r => { out[r.keyId] = parseKey(r.value); });
  return out;
};

export default BaileysKey;
```

- [ ] **Step 2: Registrar o modelo**

Em `src/database/index.ts`, importar `BaileysKey from "../models/BaileysKey"` e acrescentar na lista `models`. O backup do JSON antigo fica na tabela `WhatsappSessionBackups`, criada só pela migration, **sem modelo Sequelize**: se fosse coluna em Whatsapps, todo `findByPk` continuaria carregando 1,87 MB.

- [ ] **Step 3: Migration**

```ts
// src/database/migrations/20260929100000-create-baileys-keys.ts
import { QueryInterface, DataTypes, QueryTypes } from "sequelize";

// Nome no JSON antigo -> tipo de chave do Baileys.
const LEGACY_MAP: { [legacy: string]: string } = {
  preKeys: "pre-key",
  sessions: "session",
  senderKeys: "sender-key",
  appStateSyncKeys: "app-state-sync-key",
  appStateVersions: "app-state-sync-version",
  senderKeyMemory: "sender-key-memory",
  lidMapping: "lid-mapping",
  deviceList: "device-list",
  tctokens: "tctoken",
  identityKeys: "identity-key"
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("BaileysKeys", {
      whatsappId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      type: { type: DataTypes.STRING, primaryKey: true },
      keyId: { type: DataTypes.STRING, primaryKey: true },
      value: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    // Backup para rollback, fora de Whatsapps para não ser carregado pelo modelo.
    await queryInterface.createTable("WhatsappSessionBackups", {
      whatsappId: { type: DataTypes.INTEGER, primaryKey: true },
      session: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false }
    });

    const whatsapps: { id: number; session: string | null }[] = await queryInterface.sequelize.query(
      `SELECT id, session FROM "Whatsapps" WHERE session IS NOT NULL AND session <> ''`,
      { type: QueryTypes.SELECT }
    );
    const now = new Date();
    for (const w of whatsapps) {
      let parsed: any;
      try {
        parsed = JSON.parse(w.session as string);
      } catch (e) {
        continue; // sessão ilegível: fica como está, a conexão pede QR de novo
      }
      const rows: any[] = [];
      const keys = parsed?.keys || {};
      for (const legacy of Object.keys(keys)) {
        const type = LEGACY_MAP[legacy];
        if (!type) continue;
        for (const keyId of Object.keys(keys[legacy] || {})) {
          const value = keys[legacy][keyId];
          if (value === null || value === undefined) continue;
          rows.push({ whatsappId: w.id, type, keyId, value: JSON.stringify(value), createdAt: now, updatedAt: now });
        }
      }
      for (let i = 0; i < rows.length; i += 500) {
        await queryInterface.bulkInsert("BaileysKeys", rows.slice(i, i + 500));
      }
      await queryInterface.bulkInsert("WhatsappSessionBackups", [{ whatsappId: w.id, session: w.session, createdAt: now }]);
      await queryInterface.sequelize.query(
        `UPDATE "Whatsapps" SET session = :creds WHERE id = :id`,
        { replacements: { id: w.id, creds: JSON.stringify({ creds: parsed?.creds || null }) } }
      );
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Whatsapps" w SET session = b.session FROM "WhatsappSessionBackups" b WHERE b."whatsappId" = w.id`
    );
    await queryInterface.dropTable("WhatsappSessionBackups");
    await queryInterface.dropTable("BaileysKeys");
  }
};
```

- [ ] **Step 4: Compilar e migrar em HM**

Run: `npx tsc -p . && npx sequelize db:migrate`
Expected: migration `20260929100000-create-baileys-keys` aplicada. Conferir:

```bash
docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -Atc 'select type, count(*) from "BaileysKeys" group by 1; select id, length(session) from "Whatsapps"; select "whatsappId", length(session) from "WhatsappSessionBackups";'
```
Expected: linhas por tipo (pre-key, session, sender-key, lid-mapping, ...), `length(session)` de poucos KB em Whatsapps e o backup com os 248644 bytes antigos.

- [ ] **Step 5: Commit**

```bash
git add src/models/BaileysKey.ts src/database/index.ts src/database/migrations/20260929100000-create-baileys-keys.ts
git commit -m "Cria a tabela BaileysKeys e converte a sessão guardada"
```

---

### Task 3: `authState.ts` sobre a tabela e limpeza das chaves ao zerar a sessão

**Files:**
- Modify: `src/helpers/authState.ts` (reescrever)
- Modify: `src/libs/wbot.ts:189,207` (chamar `clearBaileysKeys`)
- Modify: `src/controllers/WhatsAppSessionController.ts:17-43` (chamar `clearBaileysKeys`)

**Interfaces:**
- Consumes: `makeSignalKeyStore`, `serializeKey`, `parseKey` (Task 1); `sequelizeKeyRepo`, `clearBaileysKeys` (Task 2).
- Produces: `authState(whatsapp)` com a mesma assinatura de hoje: `Promise<{ state: AuthenticationState; saveState: () => Promise<void> }>`.

- [ ] **Step 1: Reescrever `authState.ts`**

```ts
// src/helpers/authState.ts
import type { AuthenticationCreds, AuthenticationState } from "@whiskeysockets/baileys";
import { initAuthCreds, proto } from "@whiskeysockets/baileys";
import Whatsapp from "../models/Whatsapp";
import { sequelizeKeyRepo } from "../models/BaileysKey";
import { makeSignalKeyStore, parseKey, serializeKey } from "./baileysKeyStore";

// Creds ficam em Whatsapps.session como { creds }; as chaves de sinal ficam
// uma por linha em BaileysKeys, lidas e gravadas só quando o Baileys pede.
const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => Promise<void> }> => {
  let creds: AuthenticationCreds;

  const stored = whatsapp.session ? (parseKey(whatsapp.session) as any) : null;
  creds = stored?.creds || initAuthCreds();

  const saveState = async () => {
    try {
      await whatsapp.update({ session: serializeKey({ creds }) });
    } catch (error) {
      console.log(error);
    }
  };

  const keys = makeSignalKeyStore(sequelizeKeyRepo(whatsapp.id), {
    reviveAppStateSyncKey: value => proto.Message.AppStateSyncKeyData.create(value as any)
  });

  return {
    state: { creds, keys: keys as AuthenticationState["keys"] },
    saveState
  };
};

export default authState;
```

- [ ] **Step 2: Limpar as chaves onde a sessão é zerada**

Em `src/libs/wbot.ts`, importar `import { clearBaileysKeys } from "../models/BaileysKey";` e, nas duas ocorrências de `await whatsapp.update({ status: "PENDING", session: "" });` (linhas ~189 e ~207), acrescentar na linha seguinte `await clearBaileysKeys(whatsapp.id);`.

Em `src/controllers/WhatsAppSessionController.ts`, importar `import { clearBaileysKeys } from "../models/BaileysKey";` e:
- em `update`, entre o `UpdateWhatsAppService(...)` e o `StartWhatsAppSession(...)`: `await clearBaileysKeys(whatsapp.id);`
- em `remove`, dentro do `if (whatsapp.session)`, após o `whatsapp.update(...)`: `await clearBaileysKeys(whatsapp.id);`

- [ ] **Step 3: Compilar e subir em HM**

Run: `npx tsc -p .` e reiniciar o preview "backend". Nos logs: `Starting session Thiago Rodrigues` e `Connection Update open` sem QR. Enviar e receber uma mensagem no ticket de teste. Conferir gravação incremental:

```bash
docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -Atc 'select type, count(*), max("updatedAt") from "BaileysKeys" group by 1 order by 1; select length(session) from "Whatsapps";'
```
Expected: `max(updatedAt)` recente em `session`/`sender-key`; `length(session)` continua em poucos KB.

- [ ] **Step 4: Commit**

```bash
git add src/helpers/authState.ts src/libs/wbot.ts src/controllers/WhatsAppSessionController.ts
git commit -m "Lê e grava as chaves do Baileys na tabela BaileysKeys"
```

---

### Task 4: Mapeamento LID lido da tabela em `StartWhatsAppSession`

**Files:**
- Modify: `src/services/WbotServices/StartWhatsAppSession.ts:10-18,38-45`

**Interfaces:**
- Consumes: `readKeysOfType` (Task 2).

- [ ] **Step 1: Trocar o parse do JSON pela leitura da tabela**

Remover a função `sessionLidMapping` e o `await whatsapp.reload();`. Importar `import { readKeysOfType } from "../../models/BaileysKey";` e passar:

```ts
      await SyncSessionContactsService({
        whatsappId: whatsapp.id,
        companyId,
        me: wbot.user,
        lidMapping: await readKeysOfType(whatsapp.id, "lid-mapping")
      });
```

- [ ] **Step 2: Compilar e conferir em HM**

Run: `npx tsc -p .`, reiniciar o backend, e nos logs não deve haver `Could not sync session contacts`. Conferir `select count(*) from "Contacts" where lid is not null` antes e depois: não pode diminuir.

- [ ] **Step 3: Commit**

```bash
git add src/services/WbotServices/StartWhatsAppSession.ts
git commit -m "Lê o mapeamento LID da tabela de chaves ao iniciar a sessão"
```

---

### Task 5: Crons de fechamento e transferência só trabalham quando há regra configurada

**Files:**
- Create: `src/services/WbotServices/autoTicketRules.ts`
- Test: `src/services/WbotServices/__tests__/autoTicketRules.spec.ts`
- Modify: `src/services/WbotServices/wbotClosedTickets.ts:47-70`
- Modify: `src/wbotTransferTicketQueue.ts:17-40`

**Interfaces:**
- Produces:
  - `expiringWhatsapps<T extends { expiresTicket?: unknown }>(list: T[]): T[]` — só as conexões com `Number(expiresTicket) > 0`
  - `transferringWhatsapps<T extends { timeToTransfer?: unknown; transferQueueId?: unknown }>(list: T[]): T[]` — só as com `Number(timeToTransfer) > 0` e `transferQueueId` preenchido

- [ ] **Step 1: Teste que falha**

```ts
// src/services/WbotServices/__tests__/autoTicketRules.spec.ts
import { expiringWhatsapps, transferringWhatsapps } from "../autoTicketRules";

describe("autoTicketRules", () => {
  it("keeps only connections with an expiration in hours", () => {
    const list = [
      { id: 1, expiresTicket: 0 },
      { id: 2, expiresTicket: "" },
      { id: 3, expiresTicket: "2" },
      { id: 4, expiresTicket: null },
      { id: 5, expiresTicket: 24 }
    ];
    expect(expiringWhatsapps(list).map(w => w.id)).toEqual([3, 5]);
  });

  it("keeps only connections with transfer time and target queue", () => {
    const list = [
      { id: 1, timeToTransfer: 0, transferQueueId: 7 },
      { id: 2, timeToTransfer: 10, transferQueueId: null },
      { id: 3, timeToTransfer: 10, transferQueueId: 7 },
      { id: 4, timeToTransfer: null, transferQueueId: null }
    ];
    expect(transferringWhatsapps(list).map(w => w.id)).toEqual([3]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/services/WbotServices/__tests__/autoTicketRules.spec.ts`
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar**

```ts
// src/services/WbotServices/autoTicketRules.ts
// Regras dos crons de minuto: quais conexões realmente têm algo configurado.

export const expiringWhatsapps = <T extends { expiresTicket?: unknown }>(list: T[]): T[] =>
  list.filter(w => Number(w.expiresTicket) > 0);

export const transferringWhatsapps = <T extends { timeToTransfer?: unknown; transferQueueId?: unknown }>(
  list: T[]
): T[] => list.filter(w => Number(w.timeToTransfer) > 0 && w.transferQueueId !== null && w.transferQueueId !== undefined);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/services/WbotServices/__tests__/autoTicketRules.spec.ts`
Expected: PASS.

- [ ] **Step 5: Usar as regras em `wbotClosedTickets.ts`**

Substituir o trecho desde `let subtractHour` até o `const whatsapp = await Whatsapp.findByPk(...)` por:

```ts
    const whatsapps = expiringWhatsapps(
      await Whatsapp.findAll({
        where: { companyId },
        attributes: ["id", "expiresTicket", "expiresInactiveMessage"]
      })
    );
    if (whatsapps.length === 0) return;
    const byId = new Map(whatsapps.map(w => [w.id, w]));

    let subtractHour = moment().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss')

    const { rows: tickets } = await Ticket.findAndCountAll({
      where: {
        status: { [Op.in]: ["open", "pending"] },
        companyId,
        whatsappId: { [Op.in]: whatsapps.map(w => w.id) },
        updatedAt: { [Op.lte]: subtractHour }
      },
      order: [["updatedAt", "DESC"]]
    });

    if(!tickets || tickets.length == 0) return

    tickets.forEach(async ticket => {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = byId.get(showTicket?.whatsappId);
```

Importar `import { expiringWhatsapps } from "./autoTicketRules";`. O resto da função (TicketTraking, `if (!whatsapp) return;`, `expiresTicket` etc.) continua igual.

- [ ] **Step 6: Usar as regras em `wbotTransferTicketQueue.ts`**

Substituir do `const tickets = await Ticket.findAll({` até o `if (!wpp || ...) return;` por:

```ts
    const whatsapps = transferringWhatsapps(
      await Whatsapp.findAll({ attributes: ["id", "timeToTransfer", "transferQueueId"] })
    );
    if (whatsapps.length === 0) return;
    const byId = new Map(whatsapps.map(w => [w.id, w]));

    //buscar os tickets que em pendentes e sem fila
    const tickets = await Ticket.findAll({
      where: {
        status: "pending",
        queueId: { [Op.is]: null },
        whatsappId: { [Op.in]: whatsapps.map(w => w.id) }
      },
    });

    // varrer os tickets e verificar se algum deles está com o tempo estourado
    tickets.forEach(async ticket => {
      const wpp = byId.get(ticket.whatsappId);
      if (!wpp) return;
```

Importar `import { transferringWhatsapps } from "./services/WbotServices/autoTicketRules";`.

- [ ] **Step 7: Compilar, rodar todos os testes e conferir em HM**

Run: `npx tsc -p . && npm test`
Expected: tudo verde. Reiniciar o backend; nos logs a cada minuto continuam `Serviço de fechamento de tickets iniciado` e `Serviço de transferencia de tickets iniciado`, sem erro.

- [ ] **Step 8: Commit**

```bash
git add src/services/WbotServices/autoTicketRules.ts src/services/WbotServices/__tests__/autoTicketRules.spec.ts src/services/WbotServices/wbotClosedTickets.ts src/wbotTransferTicketQueue.ts
git commit -m "Só percorre tickets nos crons quando há expiração ou transferência configurada"
```

---

### Task 6: Índice em `TicketTraking(ticketId)`

**Files:**
- Create: `src/database/migrations/20260929100100-add-ticket-id-index-to-ticket-traking.ts`

- [ ] **Step 1: Migration**

```ts
import { QueryInterface } from "sequelize";

// Os crons e o fechamento de ticket buscam TicketTraking por ticketId;
// sem índice era varredura sequencial (112 mil em um dia de produção).
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addIndex("TicketTraking", ["ticketId"], { name: "idx_ticket_traking_ticket_id" });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("TicketTraking", "idx_ticket_traking_ticket_id");
  }
};
```

- [ ] **Step 2: Migrar e conferir**

Run: `npx tsc -p . && npx sequelize db:migrate`

```bash
docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -Atc "select indexname from pg_indexes where tablename='TicketTraking'"
```
Expected: inclui `idx_ticket_traking_ticket_id`.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/20260929100100-add-ticket-id-index-to-ticket-traking.ts
git commit -m "Indexa TicketTraking por ticketId"
```

---

### Task 7: Validação final em HM e entrega

- [ ] **Step 1:** `npm test` completo verde e `npx tsc -p .` sem erro.
- [ ] **Step 2:** Backend reiniciado em HM: sessão reconecta sem QR, mensagem recebida e enviada, `BaileysKeys` cresce por linha, `Whatsapps.session` fica pequeno.
- [ ] **Step 3:** Apresentar ao usuário o resumo e pedir confirmação antes de qualquer push na `main` (o push dispara o deploy em produção). Depois do deploy, conferir no Monitor do EasyPanel que o tráfego Postgres → API caiu.
- [ ] **Step 4:** Registrar na memória do projeto que a tabela `WhatsappSessionBackups` deve ser removida numa migration futura após validação.
