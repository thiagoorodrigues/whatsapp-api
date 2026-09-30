# Nota interna na conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atendentes escrevem, dentro da conversa do ticket, notas que o cliente não vê e que os outros atendentes recebem na hora.

**Architecture:** A nota é uma linha de `Messages` com `isPrivate = true` e `userId` do autor, criada por um serviço próprio que nunca toca no canal do WhatsApp. Ela usa o mesmo emit `appMessage` das mensagens, não altera `ticket.lastMessage` e fica de fora do histórico da IA e das checagens automáticas. No frontend, o `+` da caixa ganha "Nota interna", e a lista de mensagens desenha a nota num balão amarelo com o autor.

**Tech Stack:** Node/TypeScript, Sequelize (sequelize-typescript), Jest 27 + ts-jest, React 17 + Material UI v4, Socket.IO.

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-09-29-internal-notes-design.md`

## Global Constraints

- Nota é só texto: com `isPrivate: true`, mídia é recusada com `ERR_INTERNAL_NOTE_MEDIA` (400).
- Encaminhar ou apagar nota é recusado com `ERR_INTERNAL_NOTE_ACTION` (400).
- Nota nunca chama `SendWhatsAppMessage`, `SendWhatsAppMedia`, `getTicketChannel` ou `SetTicketMessagesAsRead`.
- Nota não altera `ticket.lastMessage`, `unreadMessages` nem o status do ticket.
- `mediaType` da nota: `"internalNote"`.
- Texto de ajuda do campo em modo nota: "Nota interna — o cliente não verá".
- Cores do balão e do campo: tokens `warningSoft` / `warningText` do tema (já têm versão clara e escura em `whatsapp-app/src/theme/tokens.js`).
- Notas antigas (`TicketNote`, painel lateral) não mudam.
- Os dois repositórios estão na `main` e push na `main` faz deploy em produção: trabalhe na branch `feat/internal-notes` em `whatsapp-api` e em `whatsapp-app`, e não faça push sem pedido.

## Review Focus

1. Nota com corpo só de espaços → recusada com 400 e nada gravado (teste na Task 2).
2. Nota enviada junto com arquivo (FormData com `isPrivate`) → recusada, nada vai ao WhatsApp (guard no controller, Task 2; verificação manual na Task 6).
3. Apagar ou encaminhar uma nota por chamada direta à API → 400 `ERR_INTERNAL_NOTE_ACTION`, sem chamar o canal (testes na Task 4).
4. Agente de IA num ticket com nota como última mensagem → a nota não entra no histórico nem vira fala do assistente (teste na Task 3).
5. Recarregar o ticket → a nota continua amarela e com o nome do autor, porque `ListMessagesService` inclui `user` (Task 2; verificação manual na Task 6).

---

## File map

**whatsapp-api**
- Create `src/database/migrations/20260929110000-add-internal-note-to-messages.ts`: colunas `isPrivate` e `userId`.
- Modify `src/models/Message.ts`: campos `isPrivate`, `userId`, `user`.
- Modify `src/services/MessageServices/CreateMessageService.ts`: aceita `isPrivate`/`userId`, pula `lastMessage` e inclui `user` quando é nota.
- Create `src/services/MessageServices/CreateInternalNoteService.ts`: grava a nota.
- Modify `src/controllers/MessageController.ts`: ramo `isPrivate` em `store`.
- Modify `src/services/MessageServices/ListMessagesService.ts`: inclui `user`.
- Modify `src/services/AiAgentServices/RunAiAgentService.ts`: `toHistory` ignora notas, e a query também.
- Modify `src/services/InboundServices/ProcessInboundMessage.ts`: duas queries ignoram notas.
- Modify `src/services/MessageServices/BackfillMentionPreviewsService.ts`: ignora notas.
- Modify `src/services/MessageServices/ForwardMessageService.ts` e `src/services/WbotServices/DeleteWhatsAppMessage.ts`: recusam nota.
- Tests: `src/services/MessageServices/__tests__/CreateMessageService.spec.ts` (ampliar), `.../__tests__/CreateInternalNoteService.spec.ts` (novo), `src/services/AiAgentServices/__tests__/history.spec.ts` (ampliar), `src/services/WbotServices/__tests__/DeleteWhatsAppMessage.spec.ts` (novo).

`UpdateMessageService` não precisa de guarda: ele só é usado para edições vindas do WhatsApp e busca por `messagesWhatsappsId`, que uma nota não tem.

**whatsapp-app**
- Create `src/utils/internalNote.js` + `src/utils/internalNote.test.js`: `isInternalNote`, `internalNotePayload`.
- Modify `src/components/MessageInputCustom/index.js`: modo nota.
- Modify `src/components/MessagesList/index.js`: balão da nota.
- Modify `src/components/MessageOptionsMenu/index.js`: só "Copiar" em nota.
- Modify `src/translate/languages/pt.js`, `en.js`, `es.js`: textos e erros.

---

### Task 1: Colunas e model

**Files:**
- Create: `whatsapp-api/src/database/migrations/20260929110000-add-internal-note-to-messages.ts`
- Modify: `whatsapp-api/src/models/Message.ts`

**Interfaces:**
- Produces: `Message.isPrivate: boolean` (default false), `Message.userId: number | null`, `Message.user: User` (BelongsTo, alias `user`).

- [ ] **Step 1: Criar branches**

```bash
git -C whatsapp-api checkout -b feat/internal-notes
git -C whatsapp-app checkout -b feat/internal-notes
```

- [ ] **Step 2: Migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Internal notes: messages only the team sees, never sent to WhatsApp.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "isPrivate", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    // Who wrote the note; other messages keep it null.
    await queryInterface.addColumn("Messages", "userId", {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "userId");
    await queryInterface.removeColumn("Messages", "isPrivate");
  }
};
```

- [ ] **Step 3: Model.** Em `Message.ts`, adicione `import User from "./User";` junto dos outros imports de model, e depois do campo `isForwarded`:

```ts
  /** Internal note: shown to the team only, never sent to WhatsApp. */
  @Default(false)
  @Column
  isPrivate: boolean;

  /** Author of an internal note. */
  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;
```

- [ ] **Step 4: Compilar e migrar na homologação**

Run: `cd whatsapp-api && npx tsc --noEmit -p .`
Expected: sem erros.

Rode a migration no banco local, pelo mesmo comando que você usa hoje na homologação (container da API: `npx sequelize db:migrate`).
Expected: `20260929110000-add-internal-note-to-messages: migrated`.

- [ ] **Step 5: Commit**

```bash
git -C whatsapp-api add src/database/migrations/20260929110000-add-internal-note-to-messages.ts src/models/Message.ts
git -C whatsapp-api commit -m "Adiciona isPrivate e autor às mensagens para notas internas"
```

---

### Task 2: Gravar a nota (serviço, CreateMessageService, controller, listagem)

**Files:**
- Create: `whatsapp-api/src/services/MessageServices/CreateInternalNoteService.ts`
- Modify: `whatsapp-api/src/services/MessageServices/CreateMessageService.ts`
- Modify: `whatsapp-api/src/controllers/MessageController.ts:86-107`
- Modify: `whatsapp-api/src/services/MessageServices/ListMessagesService.ts`
- Test: `whatsapp-api/src/services/MessageServices/__tests__/CreateInternalNoteService.spec.ts`, `.../__tests__/CreateMessageService.spec.ts`

**Interfaces:**
- Consumes: `Message.isPrivate`, `Message.userId`, `Message.user` (Task 1).
- Produces: `CreateInternalNoteService({ ticket: Ticket, body: string, userId: number }): Promise<Message>`, que lança `AppError("ERR_INTERNAL_NOTE_EMPTY")` se `body.trim()` for vazio. O `MessageData` de `CreateMessageService` ganha `isPrivate?: boolean; userId?: number`.

- [ ] **Step 1: Teste do serviço (falhando)**

`__tests__/CreateInternalNoteService.spec.ts`:

```ts
const create = jest.fn(async ({ messageData }: any) => ({ ...messageData }));

jest.mock("../CreateMessageService", () => ({ __esModule: true, default: (args: any) => create(args) }));
jest.mock("uuid", () => ({ v4: () => "uuid-note" }));

// eslint-disable-next-line import/first
import CreateInternalNoteService from "../CreateInternalNoteService";

const ticket: any = { id: 7, contactId: 3, companyId: 1 };

beforeEach(() => create.mockClear());

describe("CreateInternalNoteService", () => {
  it("saves a private note by the user, with no WhatsApp id", async () => {
    await CreateInternalNoteService({ ticket, body: "  cliente pediu retorno amanhã ", userId: 5 });
    expect(create).toHaveBeenCalledWith({
      companyId: 1,
      messageData: {
        id: "uuid-note",
        ticketId: 7,
        contactId: 3,
        body: "cliente pediu retorno amanhã",
        fromMe: true,
        read: true,
        ack: 0,
        mediaType: "internalNote",
        isPrivate: true,
        userId: 5
      }
    });
  });

  it("refuses an empty note", async () => {
    await expect(CreateInternalNoteService({ ticket, body: "   ", userId: 5 })).rejects.toThrow("ERR_INTERNAL_NOTE_EMPTY");
    expect(create).not.toHaveBeenCalled();
  });
});
```

Confira o import de uuid usado em `SaveSentMessageService.ts` e use o mesmo (`import { v4 as uuid } from "uuid"`). Se lá for diferente, ajuste o mock.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/MessageServices/__tests__/CreateInternalNoteService.spec.ts --coverage=false`
Expected: FAIL, "Cannot find module '../CreateInternalNoteService'".

- [ ] **Step 3: Implementar o serviço**

```ts
import { v4 as uuid } from "uuid";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import CreateMessageService from "./CreateMessageService";

interface Request {
  ticket: Ticket;
  body: string;
  userId: number;
}

/**
 * Saves a note only the team sees. It never goes through the WhatsApp
 * channel: no WhatsApp id, no ack, and the ticket preview stays as it was.
 */
const CreateInternalNoteService = async ({ ticket, body, userId }: Request): Promise<Message> => {
  const text = `${body || ""}`.trim();
  if (!text) throw new AppError("ERR_INTERNAL_NOTE_EMPTY");

  return CreateMessageService({
    companyId: ticket.companyId,
    messageData: {
      id: uuid(),
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: text,
      fromMe: true,
      read: true,
      ack: 0,
      mediaType: "internalNote",
      isPrivate: true,
      userId
    }
  });
};

export default CreateInternalNoteService;
```

- [ ] **Step 4: Teste do CreateMessageService (falhando).** Em `__tests__/CreateMessageService.spec.ts`:
  - troque o `findByPk` do mock para devolver um `ticketUpdate` compartilhado;
  - adicione o mock de `User`;
  - acrescente o teste abaixo.

```ts
// no topo, junto de `const emit = jest.fn();`
const ticketUpdate = jest.fn();

jest.mock("../../../models/User", () => ({}));

// dentro do mock de Message, findByPk passa a ser:
    findByPk: async (id: string) => {
      const row = rows.find(r => r.id === id);
      return (
        row && {
          ...row,
          queueId: 1,
          ticket: { queueId: 1, status: "open", contact: {}, lastMessage: "Oi", update: ticketUpdate },
          update: jest.fn()
        }
      );
    }

// no beforeEach
  ticketUpdate.mockClear();

// novo teste
  it("does not change the ticket preview for an internal note, but still emits it", async () => {
    await CreateMessageService({
      companyId: 1,
      messageData: { ...base, id: "note-1", body: "só pra equipe", isPrivate: true, userId: 5 }
    });
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("company-1-appMessage", expect.objectContaining({ action: "create" }));
  });

  it("updates the ticket preview for a regular message", async () => {
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "m-1", body: "Tudo certo" } });
    expect(ticketUpdate).toHaveBeenCalledWith({ lastMessage: "Tudo certo" });
  });
```

Se `previewWithMentions("Oi", "Tudo certo", undefined)` devolver outra coisa (veja `src/helpers/mentions.ts`), ajuste só a expectativa do segundo teste ao que o helper devolve hoje. O ponto é mostrar que o caminho normal continua atualizando a prévia.

- [ ] **Step 5: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/MessageServices/__tests__/CreateMessageService.spec.ts --coverage=false`
Expected: FAIL no teste da nota, porque `ticketUpdate` foi chamado.

- [ ] **Step 6: Implementar em CreateMessageService**
  - No `MessageData`, acrescente:

```ts
  isPrivate?: boolean;
  userId?: number;
```

  - Adicione `import User from "../../models/User";`.
  - No `findByPk`, acrescente ao array `include`:

```ts
      { model: User, as: "user", attributes: ["id", "name"] }
```

  - Troque o bloco da prévia por:

```ts
  await ResolveMentionsService([message], companyId);
  // The ticket list shows "@Maria", not the digits of the mention. An
  // internal note is not part of the conversation with the customer.
  if (!message.isPrivate) {
    const preview = previewWithMentions(message.ticket.lastMessage, message.body, message.mentions);
    if (preview) await message.ticket.update({ lastMessage: preview });
  }
```

- [ ] **Step 7: Rodar os dois testes**

Run: `cd whatsapp-api && npx jest src/services/MessageServices/__tests__ --coverage=false`
Expected: PASS, todos.

- [ ] **Step 8: Controller.** Em `MessageController.ts`:
  - adicione `import CreateInternalNoteService from "../services/MessageServices/CreateInternalNoteService";`;
  - em `store`, logo após `const ticket = await ShowTicketService(ticketId, companyId);` e **antes** de `SetTicketMessagesAsRead(ticket);`, insira:

```ts
  // Internal note: saved for the team, never sent to the customer.
  const { isPrivate } = req.body;
  if (isPrivate === true || isPrivate === "true") {
    if (medias?.length) throw new AppError("ERR_INTERNAL_NOTE_MEDIA");
    await CreateInternalNoteService({ ticket, body, userId: +req.user.id });
    return res.send();
  }
```

`AppError` já é importado no controller. A checagem de `"true"` cobre um FormData com `isPrivate`.

- [ ] **Step 9: Listagem.** Em `ListMessagesService.ts`:
  - adicione `import User from "../../models/User";`;
  - no array `include` do `findAndCountAll`, acrescente:

```ts
      {
        model: User,
        as: "user",
        attributes: ["id", "name"]
      }
```

- [ ] **Step 10: Compilar e rodar a suíte**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && npx jest --coverage=false`
Expected: sem erros de tipo; todos os testes PASS.

- [ ] **Step 11: Commit**

```bash
git -C whatsapp-api add src/services/MessageServices src/controllers/MessageController.ts
git -C whatsapp-api commit -m "Grava nota interna na conversa sem enviar ao WhatsApp"
```

---

### Task 3: Tirar a nota do histórico da IA e das checagens automáticas

**Files:**
- Modify: `whatsapp-api/src/services/AiAgentServices/RunAiAgentService.ts:65-72, 126-130`
- Modify: `whatsapp-api/src/services/InboundServices/ProcessInboundMessage.ts:250-256, 558-564`
- Modify: `whatsapp-api/src/services/MessageServices/BackfillMentionPreviewsService.ts:20-24`
- Test: `whatsapp-api/src/services/AiAgentServices/__tests__/history.spec.ts`

**Interfaces:**
- Consumes: `Message.isPrivate` (Task 1).

- [ ] **Step 1: Teste (falhando).** Em `history.spec.ts`, dentro do `describe("conversation history")`:

```ts
  it("leaves internal notes out of the agent history", () => {
    const history = toHistory([
      { fromMe: false, body: "Quero cancelar", isDeleted: false, isPrivate: false },
      { fromMe: true, body: "cliente irritado, cuidado", isDeleted: false, isPrivate: true }
    ] as any);
    expect(history).toEqual([{ role: "user", text: "Quero cancelar" }]);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/AiAgentServices/__tests__/history.spec.ts --coverage=false`
Expected: FAIL, porque o histórico traz a nota como `assistant`.

- [ ] **Step 3: Implementar.** Em `RunAiAgentService.ts`, troque o filtro de `toHistory`:

```ts
export const toHistory = (messages: Message[]): ChatMessage[] =>
  messages
    // Internal notes are for the team, never part of the conversation.
    .filter(m => !m.isDeleted && !m.isPrivate)
```

Troque também a query por `where: { ticketId: ticket.id, isPrivate: false },`, para que notas não ocupem vagas do `HISTORY_MAX_MESSAGES`.

- [ ] **Step 4: Checagens do inbound.** Em `ProcessInboundMessage.ts`:
  - na busca da mensagem de encerramento (`where: { contactId: contact.id, companyId, }`), acrescente `isPrivate: false`;
  - na busca da saudação (`where: { ticketId: ticket.id, fromMe: true }`), acrescente `isPrivate: false`.

- [ ] **Step 5: Backfill.** Em `BackfillMentionPreviewsService.ts`, troque para `where: { ticketId: ticket.id, isPrivate: false },`.

- [ ] **Step 6: Rodar a suíte**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && npx jest --coverage=false`
Expected: PASS. Se `BackfillMentionPreviewsService.spec.ts` comparar o `where` exato, atualize a expectativa para incluir `isPrivate: false`.

- [ ] **Step 7: Commit**

```bash
git -C whatsapp-api add src/services/AiAgentServices src/services/InboundServices/ProcessInboundMessage.ts src/services/MessageServices/BackfillMentionPreviewsService.ts
git -C whatsapp-api commit -m "Deixa notas internas fora do histórico da IA e das checagens automáticas"
```

---

### Task 4: Recusar apagar e encaminhar nota

**Files:**
- Modify: `whatsapp-api/src/services/WbotServices/DeleteWhatsAppMessage.ts`
- Modify: `whatsapp-api/src/services/MessageServices/ForwardMessageService.ts`
- Test: `whatsapp-api/src/services/WbotServices/__tests__/DeleteWhatsAppMessage.spec.ts` (novo)

**Interfaces:**
- Consumes: `Message.isPrivate`.
- Produces: `AppError("ERR_INTERNAL_NOTE_ACTION")` (400) nos dois serviços.

- [ ] **Step 1: Teste (falhando)**

```ts
const channel = { deleteMessage: jest.fn() };
let stored: any = null;

jest.mock("../../../models/Ticket", () => ({}));
jest.mock("../../../helpers/GetWbotMessage", () => jest.fn());
jest.mock("../../../channels", () => ({
  getTicketChannel: jest.fn(async () => channel),
  messageRef: jest.fn(),
  ticketAddress: jest.fn()
}));
jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: async () => stored }
}));

// eslint-disable-next-line import/first
import DeleteWhatsAppMessage from "../DeleteWhatsAppMessage";

describe("DeleteWhatsAppMessage", () => {
  it("refuses an internal note without touching WhatsApp", async () => {
    stored = { id: "note-1", isPrivate: true, ticket: {} };
    await expect(DeleteWhatsAppMessage("note-1")).rejects.toThrow("ERR_INTERNAL_NOTE_ACTION");
    expect(channel.deleteMessage).not.toHaveBeenCalled();
  });
});
```

Se `src/services/WbotServices/__tests__/` não existir, crie a pasta. O jest já pega `**/__tests__/*.spec.ts`; confira `testMatch` em `jest.config.js`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-api && npx jest src/services/WbotServices/__tests__/DeleteWhatsAppMessage.spec.ts --coverage=false`
Expected: FAIL, porque a função tenta o canal em vez de lançar `ERR_INTERNAL_NOTE_ACTION`.

- [ ] **Step 3: Implementar.** Em `DeleteWhatsAppMessage.ts`, logo depois do `if (!message) throw ...`:

```ts
  // Internal notes never went to WhatsApp.
  if (message.isPrivate) {
    throw new AppError("ERR_INTERNAL_NOTE_ACTION");
  }
```

Em `ForwardMessageService.ts`, logo depois de `if (!message || message.isDeleted) throw new AppError("ERR_NO_MESSAGE_FOUND", 404);`:

```ts
  if (message.isPrivate) throw new AppError("ERR_INTERNAL_NOTE_ACTION");
```

- [ ] **Step 4: Rodar a suíte**

Run: `cd whatsapp-api && npx tsc --noEmit -p . && npx jest --coverage=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C whatsapp-api add src/services/WbotServices src/services/MessageServices/ForwardMessageService.ts
git -C whatsapp-api commit -m "Impede apagar ou encaminhar nota interna pelo WhatsApp"
```

---

### Task 5: Frontend — caixa em modo nota, balão e menu

**Files:**
- Create: `whatsapp-app/src/utils/internalNote.js`, `whatsapp-app/src/utils/internalNote.test.js`
- Modify: `whatsapp-app/src/components/MessageInputCustom/index.js`
- Modify: `whatsapp-app/src/components/MessagesList/index.js`
- Modify: `whatsapp-app/src/components/MessageOptionsMenu/index.js`
- Modify: `whatsapp-app/src/translate/languages/pt.js`, `en.js`, `es.js`

**Interfaces:**
- Consumes: `POST /messages/:ticketId` com `{ body, isPrivate: true }`; mensagens com `isPrivate` e `user: { id, name }` (Task 2).
- Produces: `isInternalNote(message) => boolean`, `internalNotePayload(text) => { body, isPrivate: true }`.

- [ ] **Step 1: Teste dos helpers (falhando).** `src/utils/internalNote.test.js`:

```js
import { isInternalNote, internalNotePayload } from "./internalNote";

describe("internalNote", () => {
  it("recognizes notes", () => {
    expect(isInternalNote({ isPrivate: true })).toBe(true);
    expect(isInternalNote({ isPrivate: false })).toBe(false);
    expect(isInternalNote(null)).toBe(false);
  });

  it("builds the payload without signature or quote", () => {
    expect(internalNotePayload("  ligar amanhã  ")).toEqual({ body: "ligar amanhã", isPrivate: true });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd whatsapp-app && CI=true npx react-scripts test src/utils/internalNote.test.js`
Expected: FAIL, "Cannot find module './internalNote'".

- [ ] **Step 3: Helpers.** `src/utils/internalNote.js`:

```js
// Internal notes: messages only the team sees, never sent to the customer.
export const isInternalNote = (message) => Boolean(message && message.isPrivate);

export const internalNotePayload = (text) => ({ body: `${text || ""}`.trim(), isPrivate: true });
```

Run: `cd whatsapp-app && CI=true npx react-scripts test src/utils/internalNote.test.js`
Expected: PASS.

- [ ] **Step 4: Traduções.**
  - Em `pt.js`, dentro de `messagesInput`, acrescente:

```js
        internalNote: "Nota interna",
        placeholderInternalNote: "Nota interna — o cliente não verá",
        leaveInternalNote: "Sair da nota interna",
```

  - Em `pt.js`, dentro de `messagesList`, acrescente `internalNote: "Nota interna",`.
  - Em `pt.js`, junto de `ERR_FORWARD_NO_CONTACTS`, acrescente:

```js
        ERR_INTERNAL_NOTE_EMPTY: "Escreva a nota antes de salvar.",
        ERR_INTERNAL_NOTE_MEDIA: "Nota interna aceita só texto.",
        ERR_INTERNAL_NOTE_ACTION: "Notas internas não podem ser apagadas nem encaminhadas.",
```

  - `en.js`:
    - `messagesInput`: `internalNote: "Internal note"`, `placeholderInternalNote: "Internal note — the customer won't see it"`, `leaveInternalNote: "Leave internal note"`;
    - `messagesList`: `internalNote: "Internal note"` (crie o objeto `messagesList` se não existir, no mesmo nível de `messagesInput`);
    - erros: `ERR_INTERNAL_NOTE_EMPTY: "Write the note before saving."`, `ERR_INTERNAL_NOTE_MEDIA: "Internal notes accept text only."`, `ERR_INTERNAL_NOTE_ACTION: "Internal notes can't be deleted or forwarded."`.
  - `es.js`:
    - `messagesInput`: `internalNote: "Nota interna"`, `placeholderInternalNote: "Nota interna — el cliente no la verá"`, `leaveInternalNote: "Salir de la nota interna"`;
    - `messagesList`: `internalNote: "Nota interna"`;
    - erros: `ERR_INTERNAL_NOTE_EMPTY: "Escribe la nota antes de guardar."`, `ERR_INTERNAL_NOTE_MEDIA: "La nota interna acepta solo texto."`, `ERR_INTERNAL_NOTE_ACTION: "Las notas internas no se pueden borrar ni reenviar."`.

- [ ] **Step 5: Caixa de mensagem.** Em `MessageInputCustom/index.js`:

  1. Imports: `import LockIcon from "@material-ui/icons/Lock";` e `import { internalNotePayload } from "../../utils/internalNote";`.

  2. Em `useStyles`, acrescente:

```js
  noteInputWrapper: {
    backgroundColor: theme.tokens.warningSoft,
    boxShadow: `inset 0 0 0 1px ${theme.tokens.warningText}33`,
  },

  noteChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    alignSelf: "center",
    flexShrink: 0,
    height: 32,
    padding: "0 4px 0 10px",
    borderRadius: 16,
    fontSize: 13,
    fontWeight: 600,
    color: theme.tokens.warningText,
    backgroundColor: theme.tokens.warningSoft,
    "& .MuiIconButton-root": { padding: 4, color: theme.tokens.warningText },
  },
```

  3. `AttachMenu`: receba `onInternalNote` nas props e acrescente ao fim de `items`:

```js
    { key: "note", label: i18n.t("messagesInput.internalNote"), Icon: LockIcon, color: "flowCondition", onClick: () => { close(); onInternalNote(); } },
```

  4. `CustomInput`: receba `noteMode` e `onLeaveNote` nas props.
     - Troque `renderPlaceholder`:

```js
  const renderPlaceholder = () => {
    if (ticketStatus !== "open") return i18n.t("messagesInput.placeholderClosed");
    if (noteMode) return i18n.t("messagesInput.placeholderInternalNote");
    return i18n.t("messagesInput.placeholderOpen");
  };
```

     - No `onKeyDown`, antes do tratamento do Enter, acrescente:

```js
    if (e.key === "Escape" && noteMode && !listOpen) {
      e.preventDefault();
      onLeaveNote();
      return;
    }
```

     - Se `listOpen` for declarado depois de `onKeyDown`, mova a linha `const listOpen = popupOpen && options.length > 0;` para antes de `onKeyDown`.
     - No wrapper, troque para `<div className={clsx(classes.messageInputWrapper, { [classes.noteInputWrapper]: noteMode })} ref={wrapperRef}>`.

  5. `ActionButtons`: receba `noteMode`. No ramo final (microfone), retorne `null` quando `noteMode` for verdadeiro, antes de montar o botão:

```js
  } else if (noteMode) {
    return null;
  } else {
```

  6. `MessageInputCustom`:
     - Estado: `const [noteMode, setNoteMode] = useState(false);`.
     - No `useEffect` de limpeza por `ticketId`, dentro do `return () => { ... }`, acrescente `setNoteMode(false);`.
     - Handlers:

```js
  const handleInternalNote = () => {
    setReplyingMessage(null);
    setNoteMode(true);
    focusInputAt();
  };

  const handleLeaveNote = () => {
    setNoteMode(false);
    focusInputAt();
  };
```

     - No início de `handleSendMessage`, depois de `setLoading(true);`:

```js
    if (noteMode) {
      try {
        await api.post(`/messages/${ticketId}`, internalNotePayload(inputMessage));
        setInputMessage("");
        setNoteMode(false);
      } catch (err) {
        // The text stays in the field so nothing is lost.
        toastError(err);
      }
      setShowEmoji(false);
      setLoading(false);
      focusInputAt();
      return;
    }
```

     - `handleInputPaste`: se `noteMode`, não aceite arquivo. Na primeira linha da função, acrescente `if (noteMode) return;`.
     - Render: no lugar de `<AttachMenu ... />`, use:

```js
          {noteMode ? (
            <span className={classes.noteChip}>
              <LockIcon style={{ fontSize: 16 }} />
              {i18n.t("messagesInput.internalNote")}
              <IconButton
                size="small"
                aria-label={i18n.t("messagesInput.leaveInternalNote")}
                onClick={handleLeaveNote}
              >
                <ClearIcon style={{ fontSize: 16 }} />
              </IconButton>
            </span>
          ) : (
            <AttachMenu
              disabled={disableOption()}
              handleChangeMedias={handleChangeMedias}
              onQuickReply={handleQuickReplyMenu}
              onInternalNote={handleInternalNote}
            />
          )}
```

     - Passe `noteMode={noteMode}` e `onLeaveNote={handleLeaveNote}` para `CustomInput`, e `noteMode={noteMode}` para `ActionButtons`.
     - Não mostre `renderReplyingMessage` em modo nota: `{replyingMessage && !noteMode && renderReplyingMessage(replyingMessage)}`.

- [ ] **Step 6: Balão na lista.** Em `MessagesList/index.js`:

  1. Imports: `Lock` no import de `@material-ui/icons`, e `import { isInternalNote } from "../../utils/internalNote";`.

  2. `useStyles`, logo após `messageRight`:

```js
  internalNote: {
    backgroundColor: theme.tokens.warningSoft,
    color: theme.palette.text.primary,
    borderLeft: `3px solid ${theme.tokens.warningText}`,
    boxShadow: "none",
  },

  internalNoteLabel: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 6px 0",
    fontSize: 12,
    fontWeight: 600,
    color: theme.tokens.warningText,
  },
```

  3. Em `renderMessages`, **antes** de `if (!message.fromMe) {`:

```js
        if (isInternalNote(message)) {
          return (
            <React.Fragment key={message.id}>
              {renderDailyTimestamps(message, index)}
              {renderNumberTicket(message, index)}
              {renderMessageDivider(message, index)}

              <div className={clsx(classes.messageRight, classes.internalNote)}>
                <IconButton
                  variant="contained"
                  size="small"
                  id="messageActionsButton"
                  className={classes.messageActionsButton}
                  onClick={(e) => handleOpenMessageOptionsMenu(e, message)}
                >
                  <ExpandMore />
                </IconButton>
                <span className={classes.internalNoteLabel}>
                  <Lock style={{ fontSize: 14 }} />
                  {i18n.t("messagesList.internalNote")}
                  {message.user?.name ? ` · ${message.user.name}` : ""}
                </span>
                <div className={classes.textContentItem}>
                  <MarkdownWrapper>{message.body}</MarkdownWrapper>
                  <span className={classes.timestamp}>
                    {format(parseISO(message.createdAt), "HH:mm")}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        }
```

     `renderMessageDivider` já agrupa por `fromMe`, e a nota tem `fromMe: true`, então fica junto das mensagens enviadas sem mudança.

- [ ] **Step 7: Menu da mensagem.** Em `MessageOptionsMenu/index.js`:
  - import `isInternalNote` de `../../utils/internalNote`;
  - depois de `const text = copyableText(message);`, acrescente `const note = isInternalNote(message);`;
  - condicione os itens:
    - Apagar: `{message.fromMe && !note && (`
    - Responder: envolva com `{!note && ( ... )}`
    - Encaminhar: `{canForward && !note && (`

- [ ] **Step 8: Build**

Run: `cd whatsapp-app && CI=true npx react-scripts test src/utils --watchAll=false && npm run build`
Expected: testes PASS; build conclui sem erro de compilação.

- [ ] **Step 9: Commit**

```bash
git -C whatsapp-app add src/utils/internalNote.js src/utils/internalNote.test.js src/components/MessageInputCustom/index.js src/components/MessagesList/index.js src/components/MessageOptionsMenu/index.js src/translate/languages
git -C whatsapp-app commit -m "Adiciona nota interna na conversa do atendimento"
```

---

### Task 6: Verificação na homologação

**Files:** nenhum.

- [ ] **Step 1:** Suba a homologação local com as duas branches: build da API, `db:migrate` e restart, como no fluxo de HM. Abra o frontend no navegador embutido.
- [ ] **Step 2:** Num ticket aberto, use `+` → "Nota interna" e confira:
  - o campo fica amarelo com "Nota interna — o cliente não verá";
  - o microfone some;
  - `Esc` sai do modo.
- [ ] **Step 3:** Envie uma nota e confira:
  - ela aparece como balão amarelo com cadeado, "Nota interna · {seu nome}" e horário, sem o sinal de entregue;
  - a prévia do ticket na lista de conversas não mudou.
- [ ] **Step 4:** Em outra aba, logado com outro usuário no mesmo ticket, confira que a nota chegou sem recarregar. Recarregue: ela continua amarela e com o autor.
- [ ] **Step 5:** Confira no celular do contato de teste que nada chegou. Nos logs da API, não deve haver `send` do canal para esse ticket no horário da nota.
- [ ] **Step 6:** No menu do balão da nota, só aparece "Copiar".
- [ ] **Step 7:** Com `curl` e o token da sessão de teste, confira as recusas:
  - `DELETE /messages/<id da nota>` → 400 `ERR_INTERNAL_NOTE_ACTION`;
  - `POST /messages/<ticketId>` com `{ "body": "   ", "isPrivate": true }` → 400 `ERR_INTERNAL_NOTE_EMPTY`.
- [ ] **Step 8:** Veja no tema escuro que balão e campo continuam legíveis.
- [ ] **Step 9:** Relate o resultado ao usuário com um print. Não faça push nem merge na `main` sem pedido, porque isso faz deploy em produção.
