# Marcações recebidas com nome — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mostrar `@Nome` destacado no lugar de `@<número|LID>` nas marcações de grupo, com nomes vindos dos contatos do sistema e de uma tabela nova com os contatos que o WhatsApp envia.

**Architecture:** o backend lê `contextInfo.mentionedJid` (no recebimento e, para mensagens antigas, do `Messages.dataJson`). Na listagem e no envio pelo socket, `ResolveMentionsService` junta as marcações da página e resolve os nomes com no máximo três consultas. O resultado vai num atributo virtual `mentions` da mensagem. O app troca cada `@token` por um link interno `#mention-<token>`, e o `MarkdownWrapper` desenha esse link como um trecho destacado.

**Tech Stack:** Node 24, TypeScript, Sequelize 5 + sequelize-typescript, Postgres 18, Baileys 7.0.0-rc14, Jest 27 (ts-jest), React 16 (CRA 3.4.3), markdown-to-jsx, Material UI v4.

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-09-28-group-mentions-display-design.md`

## Global Constraints

- Nada na regra de negócio (`src/services`, `src/helpers`) importa `@whiskeysockets/baileys`: o pacote é ESM e o Jest 27 não o carrega. Só `src/channels/baileys/*` e `src/libs/*` importam.
- `Messages.body` continua com o texto original. Nenhuma migration altera `Messages`.
- O payload bruto enviado ao n8n/webhook não muda. Só `normalized` ganha `mentions`.
- Nomes editados à mão nunca são sobrescritos. O nome só é trocado quando é vazio ou igual ao número.
- Os registros de `WhatsappContacts` não aparecem em Contatos nem em campanhas.
- Trabalhar na branch `feat/mencoes-grupo` nos dois repositórios. Push na `main` dispara deploy em produção: só juntar e dar push depois do teste em HM e com confirmação do usuário.
- Comentários de código em inglês, mensagens de commit em português, e cada commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes do backend: `npx jest <arquivo>` dentro de `whatsapp-api`. Testes do app: `CI=true npx react-scripts test <arquivo>` dentro de `whatsapp-app`.

## Review Focus

- Uma marcação dentro da legenda de mídia ou de uma mensagem temporária/"ver uma vez" (conteúdo embrulhado) também é encontrada. Teste na Task 1.
- Um `@5511999…` digitado no texto sem ser marcação de verdade não vira destaque. Teste na Task 7.
- Um nome com caracteres de markdown (`[`, `]`, `*`, `_`, `~`, `(`, `)`) não quebra a mensagem. Teste na Task 7.
- Uma atualização de ack ou uma edição (evento `update`/`create` pelo socket sem `mentions`) não apaga os nomes já exibidos. Teste na Task 7 (reducer).
- `contacts.update` trazendo só `notify` não apaga o `name` já salvo. Teste na Task 3.

---

## File Structure

**Backend (`whatsapp-api`)**
- Create `src/helpers/mentions.ts`: `getMentionedJids(message)` e `mentionToken(jid)`, puros e sem Baileys.
- Modify `src/channels/inbound.ts`: campo `mentions` e `normalizedForWebhook`.
- Modify `src/channels/baileys/toInbound.ts`: preenche `mentions`.
- Create `src/database/migrations/20260928120000-create-whatsapp-contacts.ts`.
- Create `src/models/WhatsappContact.ts`. Modify `src/database/index.ts` para registrar o modelo.
- Create `src/services/WhatsappContactServices/UpsertWhatsappContactsService.ts`.
- Modify `src/services/WbotServices/wbotMessageListener.ts`: eventos de contatos.
- Modify `src/services/WbotServices/wbotMonitor.ts`: remove a gravação antiga.
- Modify `src/services/WbotServices/ImportContactsService.ts`: lê a tabela nova e não grava mais arquivos.
- Modify `src/services/ContactServices/CreateOrUpdateContactService.ts`: regra do nome.
- Create `src/services/MessageServices/ResolveMentionsService.ts`.
- Modify `src/models/Message.ts`: atributo virtual `mentions`.
- Modify `src/services/MessageServices/ListMessagesService.ts`, `CreateMessageService.ts` e `UpdateMessageService.ts`.

**App (`whatsapp-app`)**
- Create `src/utils/mentions.js` (+ `src/utils/mentions.test.js`).
- Modify `src/components/MarkdownWrapper/index.js`.
- Modify `src/components/MessagesList/index.js`: passa `mentions` e o reducer preserva `mentions`.

---

### Task 0: Branches

- [ ] **Step 1: Criar as branches**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api && git checkout -b feat/mencoes-grupo
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app && git checkout -b feat/mencoes-grupo
```

Expected: `Switched to a new branch 'feat/mencoes-grupo'` nos dois.

---

### Task 1: Leitura das marcações (helper puro)

**Files:**
- Create: `whatsapp-api/src/helpers/mentions.ts`
- Test: `whatsapp-api/src/helpers/__tests__/mentions.spec.ts`

**Interfaces:**
- Produces: `getMentionedJids(message: unknown): string[]` recebe o objeto `message` da mensagem do WhatsApp (o campo `message` de `WAMessage`) e devolve os JIDs marcados, sem repetição, na ordem em que aparecem. `mentionToken(jid: string): string` devolve os dígitos do usuário (`"5511…:3@s.whatsapp.net"` → `"5511…"`, `"140716…@lid"` → `"140716…"`).

- [ ] **Step 1: Escrever o teste**

```ts
import { getMentionedJids, mentionToken } from "../mentions";

describe("getMentionedJids", () => {
  it("reads mentions of an extended text", () => {
    expect(
      getMentionedJids({
        extendedTextMessage: {
          text: "oi @5511999999999 e @140716097450191",
          contextInfo: { mentionedJid: ["5511999999999@s.whatsapp.net", "140716097450191@lid"] }
        }
      })
    ).toEqual(["5511999999999@s.whatsapp.net", "140716097450191@lid"]);
  });

  it("reads mentions in a media caption", () => {
    expect(
      getMentionedJids({ imageMessage: { caption: "@5511999999999", contextInfo: { mentionedJid: ["5511999999999@s.whatsapp.net"] } } })
    ).toEqual(["5511999999999@s.whatsapp.net"]);
  });

  it("reads mentions inside wrapped content (ephemeral / view once / document with caption)", () => {
    expect(
      getMentionedJids({
        ephemeralMessage: {
          message: { extendedTextMessage: { text: "@1", contextInfo: { mentionedJid: ["1@lid"] } } }
        }
      })
    ).toEqual(["1@lid"]);
    expect(
      getMentionedJids({
        documentWithCaptionMessage: {
          message: { documentMessage: { caption: "@2", contextInfo: { mentionedJid: ["2@s.whatsapp.net"] } } }
        }
      })
    ).toEqual(["2@s.whatsapp.net"]);
  });

  it("drops duplicates and ignores missing or invalid input", () => {
    expect(
      getMentionedJids({
        extendedTextMessage: { contextInfo: { mentionedJid: ["1@lid", "1@lid", "", null] } }
      })
    ).toEqual(["1@lid"]);
    expect(getMentionedJids({ conversation: "oi" })).toEqual([]);
    expect(getMentionedJids(null)).toEqual([]);
    expect(getMentionedJids("texto")).toEqual([]);
  });
});

describe("mentionToken", () => {
  it("returns the user digits of a jid", () => {
    expect(mentionToken("5511999999999:3@s.whatsapp.net")).toBe("5511999999999");
    expect(mentionToken("140716097450191@lid")).toBe("140716097450191");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/helpers/__tests__/mentions.spec.ts`
Expected: FAIL com `Cannot find module '../mentions'`.

- [ ] **Step 3: Implementar**

```ts
/**
 * WhatsApp mentions ("@name" in a group). The text only carries "@<digits>"
 * (phone or LID); who was mentioned comes in contextInfo.mentionedJid of
 * the message content, which may be wrapped (ephemeral, view once, document
 * with caption, edits). Free of Baileys imports so business services and
 * Jest can use it on Message.dataJson.
 */
const MAX_DEPTH = 6;

const collect = (node: unknown, depth: number, out: string[]): void => {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
  const obj = node as Record<string, unknown>;
  const context = obj.contextInfo as { mentionedJid?: unknown } | undefined;
  if (context && Array.isArray(context.mentionedJid)) {
    context.mentionedJid.forEach(jid => {
      if (typeof jid === "string" && jid && !out.includes(jid)) out.push(jid);
    });
  }
  Object.keys(obj).forEach(key => {
    if (key !== "contextInfo") collect(obj[key], depth + 1, out);
  });
};

export const getMentionedJids = (message: unknown): string[] => {
  const out: string[] = [];
  collect(message, 0, out);
  return out;
};

/** "5511...:3@s.whatsapp.net" -> "5511..."; "1407...@lid" -> "1407...". */
export const mentionToken = (jid: string): string =>
  jid.split("@")[0].split(":")[0].replace(/\D/g, "");
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && npx jest src/helpers/__tests__/mentions.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
cd whatsapp-api && git add src/helpers/mentions.ts src/helpers/__tests__/mentions.spec.ts
git commit -m "Lê as marcações de uma mensagem do WhatsApp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `mentions` no `InboundMessage` e no webhook

**Files:**
- Modify: `whatsapp-api/src/channels/inbound.ts`
- Modify: `whatsapp-api/src/channels/baileys/toInbound.ts:142-150`
- Test: `whatsapp-api/src/channels/baileys/__tests__/toInbound.spec.ts`

**Interfaces:**
- Consumes: `getMentionedJids` (Task 1).
- Produces: `InboundMessage.mentions: string[]` (sempre presente, vazia quando não há marcação). `normalizedForWebhook(inbound).mentions: string[]`.

- [ ] **Step 1: Escrever o teste** (acrescentar ao `describe("toInbound")` existente)

```ts
  it("lists the mentioned jids of a group message", async () => {
    const inbound = await toInbound(
      {
        key: { id: "M1", fromMe: false, remoteJid: "120363430882999421@g.us", participant: "5531991147761@s.whatsapp.net" } as any,
        message: {
          extendedTextMessage: {
            text: "@140716097450191 olha isso",
            contextInfo: { mentionedJid: ["140716097450191@lid"] }
          }
        },
        messageTimestamp: 1700000000,
        pushName: "Thiago"
      },
      wbot,
      1
    );
    expect(inbound.mentions).toEqual(["140716097450191@lid"]);
    expect(normalizedForWebhook(inbound).mentions).toEqual(["140716097450191@lid"]);
  });

  it("has no mentions on a plain text", async () => {
    const inbound = await toInbound(
      { key: { id: "M2", fromMe: false, remoteJid: "5531991147761@s.whatsapp.net" } as any, message: { conversation: "Oi" }, messageTimestamp: 1 },
      wbot,
      1
    );
    expect(inbound.mentions).toEqual([]);
  });
```

No topo do arquivo, junto do `import toInbound`, acrescentar:

```ts
// eslint-disable-next-line import/first
import { normalizedForWebhook } from "../../inbound";
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/channels/baileys/__tests__/toInbound.spec.ts`
Expected: FAIL (`expected [...] received undefined`).

- [ ] **Step 3: Implementar**

Em `src/channels/inbound.ts`, dentro de `InboundMessage`, logo depois de `editOf?: string;`:

```ts
  /** Channel-native ids of the people mentioned ("@name" in groups). */
  mentions: string[];
```

E em `normalizedForWebhook`, depois de `editOf: inbound.editOf || null,`:

```ts
  mentions: inbound.mentions || [],
```

Em `src/channels/baileys/toInbound.ts`, acrescentar o import:

```ts
import { getMentionedJids } from "../../helpers/mentions";
```

E no objeto devolvido, depois de `editOf: editedMessageId(msg),`:

```ts
    mentions: getMentionedJids(msg.message),
```

- [ ] **Step 4: Rodar e ver passar, junto com os testes que montam `InboundMessage`**

Run: `cd whatsapp-api && npx jest src/channels src/services/InboundServices && npx tsc -p . --noEmit`
Expected: PASS. O `tsc` não mostra erros. Se algum teste ou fixture montar um `InboundMessage` literal e o `tsc` reclamar da falta de `mentions`, acrescentar `mentions: []` na fixture.

- [ ] **Step 5: Commit**

```bash
cd whatsapp-api && git add src/channels src/services/InboundServices
git commit -m "Leva as marcações no InboundMessage e no webhook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tabela `WhatsappContacts` e serviço de upsert

**Files:**
- Create: `whatsapp-api/src/database/migrations/20260928120000-create-whatsapp-contacts.ts`
- Create: `whatsapp-api/src/models/WhatsappContact.ts`
- Modify: `whatsapp-api/src/database/index.ts` (import e lista `models`)
- Create: `whatsapp-api/src/services/WhatsappContactServices/UpsertWhatsappContactsService.ts`
- Test: `whatsapp-api/src/services/WhatsappContactServices/__tests__/UpsertWhatsappContactsService.spec.ts`

**Interfaces:**
- Produces:
  - modelo `WhatsappContact` com os campos `id`, `whatsappId`, `companyId`, `jid`, `lid`, `number`, `name`, `notify` e `verifiedName`;
  - `UpsertWhatsappContactsService({ whatsappId, companyId, contacts }: { whatsappId: number; companyId: number; contacts: SyncedContact[] }): Promise<number>`, que devolve quantos registros foram gravados;
  - `SyncedContact = { id: string; lid?: string; phoneNumber?: string; name?: string; notify?: string; verifiedName?: string }`, com o mesmo formato do `Contact` do Baileys, mas declarado localmente.

- [ ] **Step 1: Migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Contacts WhatsApp sends to a connection (address book names, profile
// names). Used to show names in group mentions and by "Importar contatos";
// never listed as platform contacts.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("WhatsappContacts", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      whatsappId: {
        type: DataTypes.INTEGER,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      jid: { type: DataTypes.STRING, allowNull: false },
      lid: { type: DataTypes.STRING, allowNull: true },
      number: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      notify: { type: DataTypes.STRING, allowNull: true },
      verifiedName: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("WhatsappContacts", ["whatsappId", "jid"], {
      unique: true,
      name: "whatsapp_contacts_whatsapp_jid"
    });
    await queryInterface.addIndex("WhatsappContacts", ["companyId", "number"], { name: "whatsapp_contacts_company_number" });
    await queryInterface.addIndex("WhatsappContacts", ["companyId", "lid"], { name: "whatsapp_contacts_company_lid" });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("WhatsappContacts");
  }
};
```

- [ ] **Step 2: Modelo**

`src/models/WhatsappContact.ts`:

```ts
import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import Whatsapp from "./Whatsapp";

// A contact WhatsApp sent to a connection (see the migration).
@Table({ tableName: "WhatsappContacts" })
class WhatsappContact extends Model<WhatsappContact> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column
  jid: string;

  @Column
  lid: string | null;

  /** Phone digits, when known. */
  @Column
  number: string | null;

  /** Name saved in the phone's address book. */
  @Column
  name: string | null;

  /** Name the person set on their WhatsApp profile. */
  @Column
  notify: string | null;

  @Column
  verifiedName: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsappContact;
```

Em `src/database/index.ts`, acrescentar `import WhatsappContact from "../models/WhatsappContact";` junto dos outros imports e `WhatsappContact` ao fim do array `models`.

- [ ] **Step 3: Escrever o teste do serviço**

```ts
const findAll = jest.fn();
const bulkCreate = jest.fn();

jest.mock("../../../models/WhatsappContact", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => findAll(...a), bulkCreate: (...a: any[]) => bulkCreate(...a) }
}));

// eslint-disable-next-line import/first
import UpsertWhatsappContactsService from "../UpsertWhatsappContactsService";

beforeEach(() => {
  findAll.mockReset().mockResolvedValue([]);
  bulkCreate.mockReset().mockResolvedValue([]);
});

describe("UpsertWhatsappContactsService", () => {
  it("creates phone and LID contacts and skips groups and broadcasts", async () => {
    const saved = await UpsertWhatsappContactsService({
      whatsappId: 3,
      companyId: 1,
      contacts: [
        { id: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", name: "Maria Agenda", notify: "Mari" },
        { id: "222@lid", phoneNumber: "5521988887777@s.whatsapp.net", notify: "João" },
        { id: "120363430882999421@g.us", name: "Grupo" },
        { id: "status@broadcast" }
      ]
    });

    expect(saved).toBe(2);
    expect(bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({ whatsappId: 3, companyId: 1, jid: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Mari" }),
        expect.objectContaining({ jid: "222@lid", lid: "222@lid", number: "5521988887777", notify: "João" })
      ],
      { ignoreDuplicates: true }
    );
  });

  it("keeps saved fields when an update brings only some of them", async () => {
    const update = jest.fn();
    findAll.mockResolvedValue([
      { jid: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Mari", verifiedName: null, update }
    ]);

    await UpsertWhatsappContactsService({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "5511999999999@s.whatsapp.net", notify: "Maria S." }]
    });

    expect(update).toHaveBeenCalledWith({ lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Maria S.", verifiedName: null });
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  it("does not write when nothing changed", async () => {
    const update = jest.fn();
    findAll.mockResolvedValue([{ jid: "1@lid", lid: "1@lid", number: null, name: null, notify: "Ana", verifiedName: null, update }]);
    await UpsertWhatsappContactsService({ whatsappId: 3, companyId: 1, contacts: [{ id: "1@lid", notify: "Ana" }] });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 0 for an empty list", async () => {
    expect(await UpsertWhatsappContactsService({ whatsappId: 3, companyId: 1, contacts: [] })).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/WhatsappContactServices`
Expected: FAIL com `Cannot find module '../UpsertWhatsappContactsService'`.

- [ ] **Step 5: Implementar o serviço**

`src/services/WhatsappContactServices/UpsertWhatsappContactsService.ts`:

```ts
import { Op } from "sequelize";
import WhatsappContact from "../../models/WhatsappContact";
import { isLidJid, toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";

/** Contact as WhatsApp sends it (same shape as Baileys' Contact). */
export interface SyncedContact {
  id: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

interface Request {
  whatsappId: number;
  companyId: number;
  contacts: SyncedContact[];
}

type Fields = Pick<WhatsappContact, "lid" | "number" | "name" | "notify" | "verifiedName">;

const FIELDS: (keyof Fields)[] = ["lid", "number", "name", "notify", "verifiedName"];
const CHUNK = 500;

const isPersonJid = (jid?: string): boolean =>
  !!jid && (jid.endsWith("@s.whatsapp.net") || isLidJid(jid));

const fieldsOf = (c: SyncedContact): Fields => {
  const lid = isLidJid(c.id) ? toUserLid(c.id) : toUserLid(c.lid);
  const phone = isLidJid(c.id) ? c.phoneNumber : c.id;
  return {
    lid: lid || null,
    number: toPhoneNumber(phone) || null,
    name: c.name || null,
    notify: c.notify || null,
    verifiedName: c.verifiedName || null
  };
};

// A later event may carry only some fields (e.g. contacts.update with just
// the profile name): empty values never erase what is already saved.
const merge = (saved: Fields, incoming: Fields): Fields =>
  FIELDS.reduce((acc, key) => ({ ...acc, [key]: incoming[key] || saved[key] || null }), {} as Fields);

const UpsertWhatsappContactsService = async ({ whatsappId, companyId, contacts }: Request): Promise<number> => {
  const byJid = new Map<string, Fields>();
  contacts
    .filter(c => isPersonJid(c?.id))
    .forEach(c => {
      const jid = c.id.replace(/:\d+@/, "@");
      const previous = byJid.get(jid);
      const fields = fieldsOf(c);
      byJid.set(jid, previous ? merge(previous, fields) : fields);
    });

  const jids = [...byJid.keys()];
  let written = 0;

  for (let i = 0; i < jids.length; i += CHUNK) {
    const chunk = jids.slice(i, i + CHUNK);
    const existing = await WhatsappContact.findAll({ where: { whatsappId, jid: { [Op.in]: chunk } } });
    const existingByJid = new Map(existing.map(row => [row.jid, row]));

    const toCreate = [];
    for (const jid of chunk) {
      const incoming = byJid.get(jid) as Fields;
      const row = existingByJid.get(jid);
      if (!row) {
        toCreate.push({ whatsappId, companyId, jid, ...incoming });
        continue;
      }
      const merged = merge(row, incoming);
      if (FIELDS.some(key => (row[key] || null) !== merged[key])) {
        await row.update(merged);
        written += 1;
      }
    }

    if (toCreate.length) {
      await WhatsappContact.bulkCreate(toCreate, { ignoreDuplicates: true });
      written += toCreate.length;
    }
  }

  return written;
};

export default UpsertWhatsappContactsService;
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd whatsapp-api && npx jest src/services/WhatsappContactServices && npx tsc -p . --noEmit`
Expected: PASS (4 testes). O `tsc` não mostra erros.

- [ ] **Step 7: Rodar a migration em HM**

Run: `cd whatsapp-api && npx tsc -p . && npx sequelize db:migrate`
Expected: `== 20260928120000-create-whatsapp-contacts: migrated`.

- [ ] **Step 8: Commit**

```bash
cd whatsapp-api && git add src/database/migrations/20260928120000-create-whatsapp-contacts.ts src/models/WhatsappContact.ts src/database/index.ts src/services/WhatsappContactServices
git commit -m "Cria a tabela dos contatos enviados pelo WhatsApp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gravar os contatos enviados pelo WhatsApp e consertar a importação

**Files:**
- Modify: `whatsapp-api/src/services/WbotServices/wbotMessageListener.ts` (junto de `lid-mapping.update`, linha ~74, e em `messaging-history.set`, linha ~125)
- Modify: `whatsapp-api/src/services/WbotServices/wbotMonitor.ts:15,112-117`
- Modify: `whatsapp-api/src/services/WbotServices/ImportContactsService.ts`
- Test: `whatsapp-api/src/services/WbotServices/__tests__/ImportContactsService.spec.ts`

**Interfaces:**
- Consumes: `UpsertWhatsappContactsService`, `SyncedContact` e o modelo `WhatsappContact` (Task 3).

- [ ] **Step 1: Escrever o teste da importação**

```ts
const findAllSynced = jest.fn();
const findContact = jest.fn();
const createContact = jest.fn();

jest.mock("../../../channels", () => ({ getDefaultChannel: async () => ({ connectionId: 3 }) }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAllSynced(...a) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findContact(...a) } }));
jest.mock("../../ContactServices/CreateContactService", () => ({ __esModule: true, default: (a: any) => createContact(a) }));

// eslint-disable-next-line import/first
import ImportContactsService from "../ImportContactsService";

beforeEach(() => {
  findAllSynced.mockReset();
  findContact.mockReset().mockResolvedValue(null);
  createContact.mockReset();
});

describe("ImportContactsService", () => {
  it("creates platform contacts from the phone numbers WhatsApp sent", async () => {
    findAllSynced.mockResolvedValue([
      { number: "5511999999999", name: "Maria Agenda", notify: "Mari", verifiedName: null },
      { number: "5521988887777", name: null, notify: "João", verifiedName: null }
    ]);

    await ImportContactsService(1);

    expect(findAllSynced).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ whatsappId: 3 }) }));
    expect(createContact).toHaveBeenCalledWith({ number: "5511999999999", name: "Maria Agenda", companyId: 1 });
    expect(createContact).toHaveBeenCalledWith({ number: "5521988887777", name: "João", companyId: 1 });
  });

  it("renames an existing contact only when its name is the number", async () => {
    const save = jest.fn();
    const numbered: any = { name: "5511999999999", number: "5511999999999", save };
    const renamed: any = { name: "Cliente VIP", number: "5521988887777", save: jest.fn() };
    findAllSynced.mockResolvedValue([
      { number: "5511999999999", name: "Maria Agenda" },
      { number: "5521988887777", name: "João" }
    ]);
    findContact.mockImplementation(async ({ where }: any) => (where.number === "5511999999999" ? numbered : renamed));

    await ImportContactsService(1);

    expect(numbered.name).toBe("Maria Agenda");
    expect(save).toHaveBeenCalled();
    expect(renamed.name).toBe("Cliente VIP");
    expect(renamed.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/WbotServices/__tests__/ImportContactsService.spec.ts`
Expected: FAIL (o serviço ainda lê `ShowBaileysService`).

- [ ] **Step 3: Reescrever `ImportContactsService.ts`**

```ts
import * as Sentry from "@sentry/node";
import { Op } from "sequelize";
import { getDefaultChannel } from "../../channels";
import Contact from "../../models/Contact";
import WhatsappContact from "../../models/WhatsappContact";
import { logger } from "../../utils/logger";
import CreateContactService from "../ContactServices/CreateContactService";

// "Importar contatos": turns the phone contacts WhatsApp sent to the default
// connection (WhatsappContacts) into platform contacts. Names typed in the
// platform are kept; only contacts still named after their number are
// renamed.
const ImportContactsService = async (companyId: number): Promise<void> => {
  const channel = await getDefaultChannel(companyId);

  const synced = await WhatsappContact.findAll({
    where: { whatsappId: channel.connectionId, number: { [Op.ne]: null } }
  });

  for (const item of synced) {
    const number = `${item.number}`;
    const name = item.name || item.verifiedName || item.notify || number;

    try {
      const existing = await Contact.findOne({ where: { number, companyId } });
      if (existing) {
        if ((!existing.name || existing.name === existing.number) && name !== number) {
          existing.name = name;
          await existing.save();
        }
      } else {
        await CreateContactService({ number, name, companyId });
      }
    } catch (error) {
      Sentry.captureException(error);
      logger.warn(`Could not import WhatsApp contact ${number}: ${error}`);
    }
  }
};

export default ImportContactsService;
```

- [ ] **Step 4: Ligar os eventos no listener**

Em `wbotMessageListener.ts`, acrescentar o import:

```ts
import UpsertWhatsappContactsService, { SyncedContact } from "../WhatsappContactServices/UpsertWhatsappContactsService";
```

Logo depois do bloco `wbot.ev.on("lid-mapping.update", ...)`:

```ts
    // Contacts WhatsApp sends (address book and profile names): kept per
    // connection to show names in group mentions and for "Importar contatos".
    const saveSyncedContacts = async (contacts: SyncedContact[] | undefined) => {
      if (!contacts?.length) return;
      try {
        await UpsertWhatsappContactsService({ whatsappId: wbot.id, companyId, contacts });
      } catch (err) {
        logger.warn(`Could not save WhatsApp contacts: ${err}`);
      }
    };
    wbot.ev.on("contacts.upsert", contacts => saveSyncedContacts(contacts as SyncedContact[]));
    wbot.ev.on("contacts.update", contacts => saveSyncedContacts(contacts.filter(c => c.id) as SyncedContact[]));
```

Em `messaging-history.set`, como primeira linha do handler (antes de `logger.info("Chamado para serviço de importação de messages;")`):

```ts
      await saveSyncedContacts(contacts as SyncedContact[]);
```

- [ ] **Step 5: Remover a gravação antiga em `wbotMonitor.ts`**

Apagar o import da linha 15 (`import createOrUpdateBaileysService ...`) e o bloco:

```ts
    wbot.ev.on("contacts.upsert", async (contacts: BContact[]) => {

      await createOrUpdateBaileysService({
        whatsappId: whatsapp.id,
        contacts,
      });
    });
```

Se `BContact` deixar de ser usado no arquivo, remova-o do import de `@whiskeysockets/baileys`.

- [ ] **Step 6: Rodar os testes e o tsc**

Run: `cd whatsapp-api && npx jest src/services/WbotServices src/services/WhatsappContactServices && npx tsc -p . --noEmit`
Expected: PASS, e o `tsc` não mostra erros. Conferir com `grep -rn "createOrUpdateBaileysService\|contatos_antes" src` que nada sobrou.

- [ ] **Step 7: Commit**

```bash
cd whatsapp-api && git add src/services/WbotServices src/services/WhatsappContactServices
git commit -m "Grava os contatos enviados pelo WhatsApp e conserta a importação

A gravação antiga na tabela Baileys falhava sempre e a importação de
contatos não encontrava nada. Remove também os arquivos de depuração
contatos_antes.txt e contatos_depois.txt.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Nome do contato que ficou igual ao número

**Files:**
- Modify: `whatsapp-api/src/services/ContactServices/CreateOrUpdateContactService.ts:47-58`
- Test: `whatsapp-api/src/services/ContactServices/__tests__/CreateOrUpdateContactService.spec.ts`

- [ ] **Step 1: Escrever o teste**

```ts
const findOne = jest.fn();
const create = jest.fn();
const emit = jest.fn();

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit }) }));
jest.mock("../../../models/Contact", () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => findOne(...a), create: (...a: any[]) => create(...a) }
}));
jest.mock("../../../models/ContactCustomField", () => ({}));

// eslint-disable-next-line import/first
import CreateOrUpdateContactService from "../CreateOrUpdateContactService";

const existing = (name: string): any => ({ name, number: "5511999999999", lid: null, whatsappId: 3, update: jest.fn() });

describe("CreateOrUpdateContactService name", () => {
  it("names a contact still named after its number", async () => {
    const contact = existing("5511999999999");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "Maria", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).toHaveBeenCalledWith({ name: "Maria" });
  });

  it("keeps a name typed in the platform", async () => {
    const contact = existing("Cliente VIP");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "Maria", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).not.toHaveBeenCalledWith({ name: "Maria" });
  });

  it("does not rename to the number itself", async () => {
    const contact = existing("5511999999999");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "5511999999999", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).not.toHaveBeenCalledWith({ name: "5511999999999" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/ContactServices/__tests__/CreateOrUpdateContactService.spec.ts`
Expected: FAIL no primeiro teste (`update` não chamado com `{ name: "Maria" }`).

- [ ] **Step 3: Implementar**

Em `CreateOrUpdateContactService.ts`, dentro de `if (contact) {`, logo depois de `contact.update({ profilePicUrl });`:

```ts
    // Contacts created without a name got the number as name; take the
    // WhatsApp name when it arrives. Names typed in the platform stay.
    if (!isGroup && name && name !== number && (!contact.name || contact.name === contact.number)) {
      contact.update({ name });
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-api && npx jest src/services/ContactServices`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
cd whatsapp-api && git add src/services/ContactServices
git commit -m "Dá nome ao contato que ficou com o número no lugar do nome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Resolver os nomes das marcações

**Files:**
- Create: `whatsapp-api/src/services/MessageServices/ResolveMentionsService.ts`
- Modify: `whatsapp-api/src/models/Message.ts` (atributo virtual)
- Modify: `whatsapp-api/src/services/MessageServices/ListMessagesService.ts` (antes do `return`)
- Modify: `whatsapp-api/src/services/MessageServices/CreateMessageService.ts` (antes do `io.to(...)`)
- Modify: `whatsapp-api/src/services/MessageServices/UpdateMessageService.ts` (antes do loop que emite)
- Test: `whatsapp-api/src/services/MessageServices/__tests__/ResolveMentionsService.spec.ts`

**Interfaces:**
- Consumes: `getMentionedJids` e `mentionToken` (Task 1), `WhatsappContact` (Task 3).
- Produces:
  - `MentionView = { token: string; name: string | null; phone: string | null }`;
  - `ResolveMentionsService(messages: Message[], companyId: number): Promise<void>` preenche `message.mentions` em cada mensagem (lista vazia quando não há marcação) e nunca lança erro;
  - `Message.mentions: MentionView[]` é um atributo virtual e sai no JSON da API e do socket.

- [ ] **Step 1: Escrever o teste**

```ts
const findContacts = jest.fn();
const findSynced = jest.fn();
const findConnections = jest.fn();

jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findContacts(...a) } }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findSynced(...a) } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findConnections(...a) } }));
jest.mock("../../../models/Message", () => ({}));

// eslint-disable-next-line import/first
import ResolveMentionsService from "../ResolveMentionsService";

const msg = (mentioned: string[]): any => ({
  dataJson: JSON.stringify({
    key: { id: "X" },
    message: { extendedTextMessage: { text: "oi", contextInfo: { mentionedJid: mentioned } } }
  })
});

beforeEach(() => {
  findContacts.mockReset().mockResolvedValue([]);
  findSynced.mockReset().mockResolvedValue([]);
  findConnections.mockReset().mockResolvedValue([]);
});

describe("ResolveMentionsService", () => {
  it("uses the platform contact found by phone or by LID", async () => {
    findContacts.mockResolvedValue([
      { name: "Maria", number: "5511999999999", lid: null },
      { name: "João", number: "5521988887777", lid: "222@lid" }
    ]);
    const m = msg(["5511999999999@s.whatsapp.net", "222@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([
      { token: "5511999999999", name: "Maria", phone: "5511999999999" },
      { token: "222", name: "João", phone: "5521988887777" }
    ]);
  });

  it("falls back to WhatsApp names when the contact is named after its number", async () => {
    findContacts.mockResolvedValue([{ name: "5511999999999", number: "5511999999999", lid: null }]);
    findSynced.mockResolvedValue([{ jid: "5511999999999@s.whatsapp.net", lid: null, number: "5511999999999", name: null, verifiedName: null, notify: "Mari" }]);
    const m = msg(["5511999999999@s.whatsapp.net"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "5511999999999", name: "Mari", phone: "5511999999999" }]);
  });

  it("prefers the address book name over the profile name", async () => {
    findSynced.mockResolvedValue([{ jid: "9@lid", lid: "9@lid", number: "5531900000000", name: "Ana Agenda", verifiedName: null, notify: "Aninha" }]);
    const m = msg(["9@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "9", name: "Ana Agenda", phone: "5531900000000" }]);
  });

  it("names the connected account itself", async () => {
    findConnections.mockResolvedValue([{ name: "Loja", number: "5511888888888" }]);
    const m = msg(["5511888888888@s.whatsapp.net"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "5511888888888", name: "Loja", phone: "5511888888888" }]);
  });

  it("keeps only the token when nothing is known", async () => {
    const m = msg(["777@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "777", name: null, phone: null }]);
  });

  it("queries once for the whole page and skips messages without mentions", async () => {
    const a = msg(["1@lid"]);
    const b = msg(["2@lid"]);
    const c: any = { dataJson: null };
    const d: any = { dataJson: "not json" };
    await ResolveMentionsService([a, b, c, d], 1);
    expect(findContacts).toHaveBeenCalledTimes(1);
    expect(findSynced).toHaveBeenCalledTimes(1);
    expect(c.mentions).toEqual([]);
    expect(d.mentions).toEqual([]);
  });

  it("does not query when no message has mentions", async () => {
    const m: any = { dataJson: JSON.stringify({ message: { conversation: "oi" } }) };
    await ResolveMentionsService([m], 1);
    expect(findContacts).not.toHaveBeenCalled();
    expect(m.mentions).toEqual([]);
  });

  it("never throws: a failed lookup leaves the mentions unnamed", async () => {
    findContacts.mockRejectedValue(new Error("db down"));
    const m = msg(["1@lid"]);
    await expect(ResolveMentionsService([m], 1)).resolves.toBeUndefined();
    expect(m.mentions).toEqual([{ token: "1", name: null, phone: null }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/MessageServices/__tests__/ResolveMentionsService.spec.ts`
Expected: FAIL com `Cannot find module '../ResolveMentionsService'`.

- [ ] **Step 3: Atributo virtual em `Message.ts`**

Acrescentar `DataType` ao import de `sequelize-typescript`, se ainda não houver, e, junto das outras colunas:

```ts
  /** Names of the people mentioned; filled by ResolveMentionsService. */
  @Column(DataType.VIRTUAL)
  mentions: { token: string; name: string | null; phone: string | null }[];
```

- [ ] **Step 4: Implementar o serviço**

```ts
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import WhatsappContact from "../../models/WhatsappContact";
import { getMentionedJids, mentionToken } from "../../helpers/mentions";
import { isLidJid } from "../../helpers/GetPhoneJid";
import { logger } from "../../utils/logger";

export interface MentionView {
  /** Digits as they appear in the text after "@". */
  token: string;
  name: string | null;
  /** Phone digits, when known. */
  phone: string | null;
}

type WithMentions = Pick<Message, "dataJson"> & { mentions?: MentionView[] };

const jidsOf = (message: WithMentions): string[] => {
  if (!message.dataJson) return [];
  try {
    return getMentionedJids(JSON.parse(message.dataJson)?.message);
  } catch (e) {
    return [];
  }
};

// A contact created without a name carries its number (or LID digits) as
// name: that is not a name to show.
const realName = (name: string | null | undefined, ...numbers: (string | null | undefined)[]): string | null =>
  name && !numbers.includes(name) ? name : null;

/**
 * Fills message.mentions with the name of each person mentioned: platform
 * contact, then the names WhatsApp sent (address book, verified, profile),
 * then the connected account itself. Three queries at most for the page.
 */
const ResolveMentionsService = async (messages: WithMentions[], companyId: number): Promise<void> => {
  const perMessage = messages.map(jidsOf);
  const all = [...new Set(perMessage.flat())];

  const lids = all.filter(isLidJid);
  const phones = all.filter(jid => !isLidJid(jid)).map(mentionToken);
  const tokens = all.map(mentionToken);

  let contacts: Contact[] = [];
  let synced: WhatsappContact[] = [];
  let connections: Whatsapp[] = [];

  if (all.length) {
    try {
      [contacts, synced, connections] = await Promise.all([
        Contact.findAll({
          where: { companyId, [Op.or]: [{ number: { [Op.in]: tokens } }, { lid: { [Op.in]: lids } }] },
          attributes: ["name", "number", "lid"]
        }),
        WhatsappContact.findAll({
          where: { companyId, [Op.or]: [{ jid: { [Op.in]: all } }, { lid: { [Op.in]: lids } }, { number: { [Op.in]: phones } }] },
          attributes: ["jid", "lid", "number", "name", "verifiedName", "notify"]
        }),
        phones.length
          ? Whatsapp.findAll({ where: { companyId, number: { [Op.in]: phones } }, attributes: ["name", "number"] })
          : Promise.resolve([] as Whatsapp[])
      ]);
    } catch (err) {
      logger.warn(`Could not resolve mention names: ${err}`);
    }
  }

  const resolve = (jid: string): MentionView => {
    const token = mentionToken(jid);
    const lid = isLidJid(jid) ? jid : null;

    const contact =
      contacts.find(c => lid && c.lid === lid) ||
      contacts.find(c => c.number === token);
    const wa =
      synced.find(s => s.jid === jid) ||
      synced.find(s => lid && s.lid === lid) ||
      synced.find(s => !lid && s.number === token);

    const phone =
      (!lid ? token : null) ||
      (contact && contact.number !== token ? contact.number : null) ||
      wa?.number ||
      null;
    const own = phone ? connections.find(w => w.number === phone) : undefined;

    const name =
      realName(contact?.name, contact?.number, token) ||
      wa?.name ||
      wa?.verifiedName ||
      wa?.notify ||
      own?.name ||
      null;

    return { token, name, phone };
  };

  messages.forEach((message, i) => {
    message.mentions = perMessage[i].map(resolve);
  });
};

export default ResolveMentionsService;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd whatsapp-api && npx jest src/services/MessageServices/__tests__/ResolveMentionsService.spec.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Chamar na listagem, na criação e na edição**

`ListMessagesService.ts`: importar `ResolveMentionsService` e, antes do `return`:

```ts
  await ResolveMentionsService(messages, companyId);
```

`CreateMessageService.ts`: importar e, antes de `const io = getIO();`:

```ts
  await ResolveMentionsService([message], companyId);
```

`UpdateMessageService.ts`: importar e, logo antes do `for (let message of messages) {`:

```ts
    await ResolveMentionsService(messages, companyId);
```

- [ ] **Step 7: Rodar todos os testes e o tsc**

Run: `cd whatsapp-api && npx jest && npx tsc -p . --noEmit`
Expected: todos PASS. O `tsc` não mostra erros. Se `SaveInboundMessageService.spec.ts` quebrar por causa da importação nova em `CreateMessageService`, não mude o teste: ele já faz mock de `CreateMessageService` inteiro.

- [ ] **Step 8: Commit**

```bash
cd whatsapp-api && git add src/models/Message.ts src/services/MessageServices
git commit -m "Resolve os nomes das pessoas marcadas nas mensagens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Exibir `@Nome` no app

**Files:**
- Create: `whatsapp-app/src/utils/mentions.js`
- Test: `whatsapp-app/src/utils/mentions.test.js`
- Modify: `whatsapp-app/src/components/MarkdownWrapper/index.js`
- Modify: `whatsapp-app/src/components/MessagesList/index.js:298-320` (reducer), `:752` e `:795` (render)

**Interfaces:**
- Consumes: `message.mentions: [{ token, name, phone }]` (Task 6). O utilitário `src/utils/formatPhone.js` já existe.
- Produces:
  - `applyMentions(text: string, mentions?: Mention[]): string` troca `@token` por `[@Rótulo](#mention-token)`;
  - `mentionLabel(mention): string`;
  - `MENTION_HREF_PREFIX = "#mention-"`;
  - `keepMentions(previous, next)`, usado pelo reducer.

- [ ] **Step 1: Escrever o teste**

```js
import { applyMentions, mentionLabel, keepMentions, MENTION_HREF_PREFIX } from "./mentions";

describe("mentionLabel", () => {
  it("uses the name, then the formatted phone, then the token", () => {
    expect(mentionLabel({ token: "1", name: "Maria", phone: "5511999999999" })).toBe("Maria");
    expect(mentionLabel({ token: "1", name: null, phone: "5511999999999" })).toBe("+55 (11) 99999-9999");
    expect(mentionLabel({ token: "140716", name: null, phone: null })).toBe("140716");
  });
});

describe("applyMentions", () => {
  it("turns each mention into an internal link", () => {
    expect(applyMentions("oi @140716 tudo bem?", [{ token: "140716", name: "Maria", phone: null }])).toBe(
      `oi [@Maria](${MENTION_HREF_PREFIX}140716) tudo bem?`
    );
  });

  it("leaves digits typed without being a mention", () => {
    expect(applyMentions("ligue @5511999999999", [{ token: "140716", name: "Maria", phone: null }])).toBe("ligue @5511999999999");
  });

  it("does not match a longer number starting with the token", () => {
    expect(applyMentions("@1407160", [{ token: "140716", name: "Maria", phone: null }])).toBe("@1407160");
  });

  it("escapes markdown characters of the name", () => {
    expect(applyMentions("@1", [{ token: "1", name: "Ana [Vendas] *VIP* (SP)_~", phone: null }])).toBe(
      `[@Ana \\[Vendas\\] \\*VIP\\* \\(SP\\)\\_\\~](${MENTION_HREF_PREFIX}1)`
    );
  });

  it("returns the text unchanged without mentions", () => {
    expect(applyMentions("oi", undefined)).toBe("oi");
    expect(applyMentions(null, [])).toBe(null);
  });
});

describe("keepMentions", () => {
  it("keeps the mentions already shown when an update comes without them", () => {
    const previous = { id: "a", mentions: [{ token: "1", name: "Maria", phone: null }] };
    expect(keepMentions(previous, { id: "a", ack: 3 })).toEqual({ id: "a", ack: 3, mentions: previous.mentions });
    expect(keepMentions(previous, { id: "a", mentions: [] })).toEqual({ id: "a", mentions: [] });
    expect(keepMentions(undefined, { id: "b" })).toEqual({ id: "b" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-app && CI=true npx react-scripts test src/utils/mentions.test.js`
Expected: FAIL com `Cannot find module './mentions'`.

- [ ] **Step 3: Implementar `src/utils/mentions.js`**

```js
import formatPhone from "./formatPhone";

// Group mentions: the text carries "@<digits>" (phone or LID) and the API
// sends message.mentions = [{ token, name, phone }]. Each mention becomes an
// internal link that MarkdownWrapper renders highlighted.
export const MENTION_HREF_PREFIX = "#mention-";

export const mentionLabel = ({ token, name, phone }) =>
  name || (phone ? formatPhone(phone) : token);

const escapeMarkdown = (value) => value.replace(/([\\[\]()*_~`])/g, "\\$1");

export const applyMentions = (text, mentions) => {
  if (!text || !mentions || mentions.length === 0) return text;
  return mentions.reduce(
    (acc, mention) =>
      acc.replace(
        new RegExp(`@${mention.token}(?!\\d)`, "g"),
        `[@${escapeMarkdown(mentionLabel(mention))}](${MENTION_HREF_PREFIX}${mention.token})`
      ),
    text
  );
};

// Socket updates (ack, edits) may come without mentions: keep the ones
// already shown.
export const keepMentions = (previous, next) =>
  previous && previous.mentions && next.mentions === undefined
    ? { ...next, mentions: previous.mentions }
    : next;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd whatsapp-app && CI=true npx react-scripts test src/utils/mentions.test.js`
Expected: PASS (8 testes).

- [ ] **Step 5: `MarkdownWrapper` com `mentions`**

Acrescentar os imports:

```js
import { applyMentions, MENTION_HREF_PREFIX } from "../../utils/mentions";
import formatPhone from "../../utils/formatPhone";
```

Trocar `CustomLink` e a assinatura do componente:

```js
const mentionStyle = { color: "#1e88e5", fontWeight: 500 };

const CustomLink = ({ children, href, mentions, ...props }) => {
	if (href && href.startsWith(MENTION_HREF_PREFIX)) {
		const token = href.slice(MENTION_HREF_PREFIX.length);
		const mention = (mentions || []).find((m) => m.token === token);
		const title = mention && mention.phone ? formatPhone(mention.phone) : undefined;
		return (
			<span style={mentionStyle} title={title}>
				{children}
			</span>
		);
	}
	return (
		<a href={href} {...props} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	);
};

const MarkdownWrapper = ({ children, mentions }) => {
```

Logo depois do tratamento do `tildaRegex` (antes de `const options = React.useMemo(...)`):

```js
	children = applyMentions(children, mentions);
```

No `useMemo` das opções, trocar `a: { component: CustomLink },` por:

```js
				a: { component: CustomLink, props: { mentions } },
```

e colocar `mentions` na lista de dependências do `useMemo`. Se a lista hoje for `[]`, ela vira `[mentions]`.

- [ ] **Step 6: `MessagesList` passa `mentions` e o reducer preserva**

Importar `import { keepMentions } from "../../utils/mentions";`.

No reducer, `ADD_MESSAGE`, trocar `state[messageIndex] = newMessage;` por:

```js
      state[messageIndex] = keepMentions(state[messageIndex], newMessage);
```

Em `UPDATE_MESSAGE`, trocar `state[messageIndex] = messageToUpdate;` por:

```js
      state[messageIndex] = keepMentions(state[messageIndex], messageToUpdate);
```

Linha ~752 (mensagem recebida):

```jsx
                  <MarkdownWrapper mentions={message.mentions}>{message.mediaType === "locationMessage" || message.mediaType === "contactMessage" || message.mediaType === "contactsArrayMessage" ? null : message.body}</MarkdownWrapper>
```

Linha ~795 (mensagem enviada):

```jsx
                  <MarkdownWrapper mentions={message.mentions}>{message.body}</MarkdownWrapper>
```

- [ ] **Step 7: Rodar os testes do app e o build**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false && npm run build`
Expected: testes PASS e `Compiled successfully` (ou só os avisos que já existiam antes).

- [ ] **Step 8: Commit**

```bash
cd whatsapp-app && git add src/utils/mentions.js src/utils/mentions.test.js src/components/MarkdownWrapper/index.js src/components/MessagesList/index.js
git commit -m "Mostra o nome das pessoas marcadas nas mensagens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação em HM e medição

HM é este notebook: Postgres `whatsapp-api-postgres-1` (porta 5435, banco/usuário `sweasy`), backend em `node dist/server.js` na porta 3001 e front na porta 3000.

- [ ] **Step 1: Publicar em HM**

```bash
cd whatsapp-api && npx tsc -p . && npx sequelize db:migrate
```

Reiniciar o backend de HM. Se ele rodar pelo preview "backend" de outra conversa, peça ao usuário que o reinicie, ou pare o processo com a autorização dele. Depois, confirme com `ps aux | grep "dist/server"` que há só um processo. O front em dev recarrega sozinho.

- [ ] **Step 2: Medir os nomes enviados pelo WhatsApp** (esperar uns 5 minutos depois de conectar)

```bash
docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c "select count(*) total, count(name) agenda, count(\"verifiedName\") verificado, count(notify) perfil, count(number) com_telefone from \"WhatsappContacts\";"
```

Anotar os números para o relatório ao usuário.

- [ ] **Step 3: Testar num grupo real** (com o usuário)

1. Alguém do grupo manda uma mensagem marcando outra pessoa. No ticket do grupo, aparece `@Nome` destacado, e o telefone aparece ao passar o mouse.
2. Abra um ticket de grupo com marcações antigas: elas também aparecem com nome.
3. Uma mensagem com `@5511…` digitado sem ser marcação fica como texto normal.
4. Depois que a mensagem é lida (ack), o nome continua exibido.
5. Em Contatos → Importar contatos, os contatos do celular entram, e os nomes editados à mão continuam.

- [ ] **Step 4: Relatar e pedir confirmação para produção**

Mostrar ao usuário a medição e o resultado do teste. Com a aprovação dele, juntar `feat/mencoes-grupo` na `main` dos dois repositórios (fast-forward quando possível) e dar push. O push dispara o deploy no EasyPanel, e a migration roda ao subir. Depois, conferir o deploy no painel.
