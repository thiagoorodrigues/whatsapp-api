# Marcar participantes ao escrever — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** num ticket de grupo, digitar `@` mostra os participantes e escolher um envia a marcação de verdade no WhatsApp.

**Architecture:**
- O canal ganha `groupParticipants` e `mentions` no conteúdo de texto.
- Uma rota lista os participantes com os nomes da parte 1, a partir de `resolveMentionNames`, extraída do `ResolveMentionsService`.
- O envio filtra `mentions` pelos participantes do grupo.
- No app, funções puras em `utils/mentionInput.js` detectam o `@`, inserem `@Nome` e, no envio, trocam `@Nome` por `@<dígitos>`. O `Autocomplete` que já existe para `/` mostra a lista.

**Tech Stack:** Node 24, TypeScript, Sequelize 5, Baileys 7.0.0-rc14, Jest 27. React 16 (CRA 3.4.3), Material UI v4 (`@material-ui/lab` Autocomplete).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-09-28-group-mentions-compose-design.md`

## Global Constraints

- Nada em `src/services` ou `src/helpers` importa `@whiskeysockets/baileys`. Só `src/channels/baileys/*` e `src/libs/*` importam.
- Sem migration.
- A mensagem salva continua vindo do `dataJson` do envio, e a parte 1 mostra `@Nome` sem mudança.
- As respostas rápidas com `/` continuam funcionando como hoje.
- Trabalhar na branch `feat/mencoes-escrever` nos dois repositórios. Push na `main` dispara deploy: só depois do teste em HM e com confirmação do usuário.
- Comentários em inglês e commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes do backend: `npx jest <arquivo> --coverage=false` em `whatsapp-api`. Testes do app: `CI=true npx react-scripts test <arquivo> --watchAll=false` em `whatsapp-app`.

## Review Focus

- `@` dentro de e-mail (`ana@empresa.com`) não abre a lista. Teste na Task 6.
- Rótulo que é prefixo de outro (`@Maria` e `@Maria (7761)`), ou `@Maria` escolhido e `@Mariana` digitado, não se misturam no envio. Teste na Task 6.
- O Enter com a lista de participantes aberta escolhe e não envia a mensagem pela metade. Verificado em HM na Task 8.
- Um JID de `mentions` que não está no grupo (vindo de um cliente adulterado) não é enviado. Teste na Task 5.
- Ticket individual ignora `mentions`, e a rota de participantes responde 400. Testes nas Tasks 4 e 5.

---

### Task 0: Branches

- [ ] **Step 1**

```bash
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-api && git checkout -b feat/mencoes-escrever
cd /Users/thiagorodrigues/Projetos/weconex/whatsapp-app && git checkout -b feat/mencoes-escrever
```

Expected: `Switched to a new branch 'feat/mencoes-escrever'` nos dois.

---

### Task 1: `mentions` no conteúdo de texto

**Files:**
- Modify: `whatsapp-api/src/channels/types.ts` (tipo `OutgoingContent`)
- Modify: `whatsapp-api/src/channels/baileys/BaileysChannel.ts` (`toBaileysContent`, caso `"text"`)
- Test: `whatsapp-api/src/channels/__tests__/BaileysChannel.spec.ts`

**Interfaces:**
- Produces: `OutgoingContent` de texto = `{ type: "text"; text: string; mentions?: string[] }`.

- [ ] **Step 1: Teste**. Dentro de `describe("toBaileysContent", ...)`, acrescentar:

```ts
  it("sends the mentioned jids of a text", () => {
    expect(toBaileysContent({ type: "text", text: "oi @123", mentions: ["123@lid"] })).toEqual({ text: "oi @123", mentions: ["123@lid"] });
    expect(toBaileysContent({ type: "text", text: "oi", mentions: [] })).toEqual({ text: "oi" });
  });
```

- [ ] **Step 2: Rodar** `npx jest src/channels/__tests__/BaileysChannel.spec.ts --coverage=false`. Expected: FAIL (erro de tipo em `mentions`, ou objeto sem `mentions`).

- [ ] **Step 3: Implementar.** Em `types.ts`, trocar `| { type: "text"; text: string }` por:

```ts
  | { type: "text"; text: string; /** Ids of the people mentioned ("@name" in groups). */ mentions?: string[] }
```

Em `toBaileysContent`, trocar `return { text: content.text };` por:

```ts
      return content.mentions?.length ? { text: content.text, mentions: content.mentions } : { text: content.text };
```

- [ ] **Step 4: Rodar de novo.** Expected: PASS.

- [ ] **Step 5: Commit** `git add src/channels && git commit -m "Envia as marcações junto do texto"`.

---

### Task 2: `groupParticipants` no canal

**Files:**
- Modify: `whatsapp-api/src/channels/types.ts` (novo tipo e método na interface)
- Modify: `whatsapp-api/src/channels/baileys/BaileysChannel.ts`
- Test: `whatsapp-api/src/channels/__tests__/BaileysChannel.spec.ts`

**Interfaces:**
- Produces:
  - `GroupParticipant = { jid: string; lid?: string; phone?: string; isAdmin: boolean; isMe: boolean }`;
  - `MessagingChannel.groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]>`.

- [ ] **Step 1: Teste.** No `beforeEach`, acrescentar ao `socket`: `groupMetadata: jest.fn()` e `user: { id: "5511888888888:3@s.whatsapp.net", lid: "888:3@lid" }`, trocando o `user` existente. Então acrescentar:

```ts
describe("groupParticipants", () => {
  it("lists members with their LID, phone, admin flag and the account itself", async () => {
    socket.groupMetadata.mockResolvedValue({
      id: "120363999@g.us",
      participants: [
        { id: "140716@lid", phoneNumber: "5531991147761@s.whatsapp.net", admin: "admin" },
        { id: "5521988887777@s.whatsapp.net", lid: "222@lid", admin: null },
        { id: "888@lid", phoneNumber: "5511888888888@s.whatsapp.net" }
      ]
    });

    const list = await new BaileysChannel(7).groupParticipants({ number: "120363999", isGroup: true, jid: "120363999@g.us" });

    expect(socket.groupMetadata).toHaveBeenCalledWith("120363999@g.us");
    expect(list).toEqual([
      { jid: "140716@lid", lid: "140716@lid", phone: "5531991147761", isAdmin: true, isMe: false },
      { jid: "5521988887777@s.whatsapp.net", lid: "222@lid", phone: "5521988887777", isAdmin: false, isMe: false },
      { jid: "888@lid", lid: "888@lid", phone: "5511888888888", isAdmin: false, isMe: true }
    ]);
  });
});
```

- [ ] **Step 2: Rodar** `npx jest src/channels/__tests__/BaileysChannel.spec.ts --coverage=false`. Expected: FAIL (`groupParticipants is not a function` ou erro de tipo).

- [ ] **Step 3: Implementar.** Em `types.ts`, antes de `export interface MessagingChannel`:

```ts
/** A member of a group, as the channel knows it. */
export interface GroupParticipant {
  /** Id the group uses for the member (LID or phone JID). */
  jid: string;
  lid?: string;
  /** Phone digits, when known. */
  phone?: string;
  isAdmin: boolean;
  /** The connected account itself. */
  isMe: boolean;
}
```

Na interface, depois de `profilePictureUrl(...)`:

```ts
  groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]>;
```

Em `BaileysChannel.ts`:
- acrescentar `GroupParticipant` ao import de `../types`;
- acrescentar `import { getGroupMetadata } from "../../libs/whatsappCache";`;
- acrescentar `isLidJid, toPhoneNumber, toUserLid` ao import de `GetPhoneJid`, criando o import se ainda não houver;
- depois de `profilePictureUrl`, acrescentar o método:

```ts
  async groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]> {
    const socket = this.socket();
    const jid = chat.jid || (await this.groupJid(jidOf({ ...chat, isGroup: true })));
    const { participants } = await getGroupMetadata(socket, jid);
    const myPhone = toPhoneNumber(socket.user?.id);
    const myLid = toUserLid((socket.user as any)?.lid);

    return participants.map(p => {
      const byLid = isLidJid(p.id);
      const lid = byLid ? toUserLid(p.id) : toUserLid(p.lid);
      const phone = toPhoneNumber(byLid ? p.phoneNumber : p.id);
      return {
        jid: p.id,
        ...(lid ? { lid } : {}),
        ...(phone ? { phone } : {}),
        isAdmin: !!p.admin,
        isMe: (!!phone && phone === myPhone) || (!!lid && lid === myLid)
      };
    });
  }
```

- [ ] **Step 4: Rodar** o teste e `npx tsc -p . --noEmit`. Expected: PASS, e o `tsc` não mostra erros. Se algum objeto de teste implementar `MessagingChannel` inteiro e o `tsc` reclamar, acrescente `groupParticipants: jest.fn()` a ele.

- [ ] **Step 5: Commit** `git add src/channels && git commit -m "Lista os participantes de um grupo pelo canal"`.

---

### Task 3: Extrair `resolveMentionNames`

**Files:**
- Modify: `whatsapp-api/src/services/MessageServices/ResolveMentionsService.ts`
- Test: `whatsapp-api/src/services/MessageServices/__tests__/ResolveMentionsService.spec.ts`

**Interfaces:**
- Produces: `export const resolveMentionNames = async (jids: string[], companyId: number): Promise<Map<string, MentionView>>`. Ela nunca lança erro, e o `Map` tem uma entrada para cada JID recebido.

- [ ] **Step 1: Teste.** Importar `ResolveMentionsService, { resolveMentionNames }` e acrescentar:

```ts
describe("resolveMentionNames", () => {
  it("names a list of jids without messages", async () => {
    findContacts.mockResolvedValue([{ name: "Maria", number: "5511999999999", lid: null }]);
    const names = await resolveMentionNames(["5511999999999@s.whatsapp.net", "7@lid"], 1);
    expect(names.get("5511999999999@s.whatsapp.net")).toEqual({ token: "5511999999999", name: "Maria", phone: "5511999999999" });
    expect(names.get("7@lid")).toEqual({ token: "7", name: null, phone: null });
  });
});
```

- [ ] **Step 2: Rodar** `npx jest src/services/MessageServices/__tests__/ResolveMentionsService.spec.ts --coverage=false`. Expected: FAIL (`resolveMentionNames` não exportada).

- [ ] **Step 3: Refatorar.** Mover as consultas e a função `resolve` para dentro de:

```ts
/** Name of each jid (platform contact, WhatsApp names, own account, phone). */
export const resolveMentionNames = async (jids: string[], companyId: number): Promise<Map<string, MentionView>> => {
  const all = [...new Set(jids)];
  // ... (the lids/phones/tokens, the three queries in try/catch and resolve(jid), unchanged)
  return new Map(all.map(jid => [jid, resolve(jid)]));
};
```

Os trechos entre `const lids = ...` e o fim de `const resolve = ...` são movidos sem mudança. O serviço fica assim:

```ts
const ResolveMentionsService = async (page: WithMentions[], companyId: number): Promise<void> => {
  // Quoted messages are shown too (the quote above a reply).
  const messages = page.flatMap(m => (m.quotedMsg ? [m, m.quotedMsg] : [m]));
  const perMessage = messages.map(jidsOf);
  const names = await resolveMentionNames(perMessage.flat(), companyId);
  messages.forEach((message, i) => {
    message.mentions = perMessage[i].map(jid => names.get(jid) as MentionView);
  });
};
```

- [ ] **Step 4: Rodar** `npx jest src/services/MessageServices --coverage=false`. Expected: todos PASS, incluindo os testes antigos do resolver.

- [ ] **Step 5: Commit** `git add src/services/MessageServices && git commit -m "Separa a resolução de nomes das marcações"`.

---

### Task 4: Rota de participantes

**Files:**
- Create: `whatsapp-api/src/services/TicketServices/ListGroupParticipantsService.ts`
- Test: `whatsapp-api/src/services/TicketServices/__tests__/ListGroupParticipantsService.spec.ts`
- Modify: `whatsapp-api/src/controllers/TicketController.ts` (novo `participants`)
- Modify: `whatsapp-api/src/routes/ticketRoutes.ts`

**Interfaces:**
- Consumes: `groupParticipants` (Task 2) e `resolveMentionNames` (Task 3).
- Produces:
  - `ListGroupParticipantsService(ticket: Ticket): Promise<ParticipantView[]>`, com `ParticipantView = { jid: string; token: string; name: string | null; phone: string | null; isAdmin: boolean }`;
  - `GET /tickets/:ticketId/participants`, que devolve `ParticipantView[]`.

- [ ] **Step 1: Teste**

```ts
const groupParticipants = jest.fn();
const resolveNames = jest.fn();

jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ groupParticipants: (...a: any[]) => groupParticipants(...a) }),
  ticketAddress: (t: any) => ({ number: t.contact.number, isGroup: t.isGroup })
}));
jest.mock("../../MessageServices/ResolveMentionsService", () => ({
  resolveMentionNames: (...a: any[]) => resolveNames(...a)
}));

// eslint-disable-next-line import/first
import ListGroupParticipantsService from "../ListGroupParticipantsService";

const ticket: any = { id: 12, companyId: 1, isGroup: true, contact: { number: "120363999" } };
const view = (token: string, name: string | null, phone: string | null) => ({ token, name, phone });

beforeEach(() => {
  groupParticipants.mockReset();
  resolveNames.mockReset();
});

describe("ListGroupParticipantsService", () => {
  it("refuses a ticket that is not a group", async () => {
    await expect(ListGroupParticipantsService({ ...ticket, isGroup: false })).rejects.toMatchObject({ message: "ERR_TICKET_NOT_GROUP", statusCode: 400 });
  });

  it("names members by LID or by phone, drops the account itself and sorts by name", async () => {
    groupParticipants.mockResolvedValue([
      { jid: "1@lid", lid: "1@lid", phone: "5531900000001", isAdmin: false, isMe: false },
      { jid: "2@lid", lid: "2@lid", isAdmin: true, isMe: false },
      { jid: "5511900000003@s.whatsapp.net", phone: "5511900000003", isAdmin: false, isMe: false },
      { jid: "9@lid", lid: "9@lid", phone: "5511888888888", isAdmin: false, isMe: true }
    ]);
    resolveNames.mockResolvedValue(
      new Map([
        ["1@lid", view("1", null, null)],
        ["5531900000001@s.whatsapp.net", view("5531900000001", "Zé", "5531900000001")],
        ["2@lid", view("2", null, null)],
        ["5511900000003@s.whatsapp.net", view("5511900000003", "Ana", "5511900000003")]
      ])
    );

    const list = await ListGroupParticipantsService(ticket);

    expect(resolveNames).toHaveBeenCalledWith(
      expect.arrayContaining(["1@lid", "5531900000001@s.whatsapp.net", "2@lid", "5511900000003@s.whatsapp.net"]),
      1
    );
    expect(list).toEqual([
      { jid: "5511900000003@s.whatsapp.net", token: "5511900000003", name: "Ana", phone: "5511900000003", isAdmin: false },
      { jid: "1@lid", token: "1", name: "Zé", phone: "5531900000001", isAdmin: false },
      { jid: "2@lid", token: "2", name: null, phone: null, isAdmin: true }
    ]);
  });
});
```

- [ ] **Step 2: Rodar** `npx jest src/services/TicketServices/__tests__/ListGroupParticipantsService.spec.ts --coverage=false`. Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o serviço**

```ts
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import { getTicketChannel, ticketAddress } from "../../channels";
import { mentionToken } from "../../helpers/mentions";
import { resolveMentionNames } from "../MessageServices/ResolveMentionsService";

export interface ParticipantView {
  jid: string;
  /** Digits written after "@" in the text. */
  token: string;
  name: string | null;
  phone: string | null;
  isAdmin: boolean;
}

/** Members of a group ticket with their names, to mention them. */
const ListGroupParticipantsService = async (ticket: Ticket): Promise<ParticipantView[]> => {
  if (!ticket.isGroup) throw new AppError("ERR_TICKET_NOT_GROUP", 400);

  const channel = await getTicketChannel(ticket);
  const members = (await channel.groupParticipants(ticketAddress(ticket))).filter(p => !p.isMe);

  const phoneJid = (phone?: string) => (phone ? `${phone}@s.whatsapp.net` : null);
  const names = await resolveMentionNames(
    members.flatMap(p => [p.jid, phoneJid(p.phone)].filter(Boolean) as string[]),
    ticket.companyId
  );

  const list = members.map(p => {
    const own = names.get(p.jid);
    const byPhone = phoneJid(p.phone) ? names.get(phoneJid(p.phone) as string) : undefined;
    return {
      jid: p.jid,
      token: mentionToken(p.jid),
      name: own?.name || byPhone?.name || null,
      phone: p.phone || own?.phone || byPhone?.phone || null,
      isAdmin: p.isAdmin
    };
  });

  return list.sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return (a.name || a.phone || a.token).localeCompare(b.name || b.phone || b.token, "pt-BR");
  });
};

export default ListGroupParticipantsService;
```

- [ ] **Step 4: Controller e rota.** Em `TicketController.ts`, importar `import ListGroupParticipantsService from "../services/TicketServices/ListGroupParticipantsService";` e acrescentar:

```ts
export const participants = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);
  return res.status(200).json(await ListGroupParticipantsService(ticket));
};
```

Em `ticketRoutes.ts`, depois da rota `GET /tickets/:ticketId`:

```ts
ticketRoutes.get("/tickets/:ticketId/participants", isAuth, TicketController.participants);
```

- [ ] **Step 5: Rodar** o teste e `npx tsc -p . --noEmit`. Expected: PASS, e o `tsc` não mostra erros.

- [ ] **Step 6: Commit** `git add src/services/TicketServices src/controllers/TicketController.ts src/routes/ticketRoutes.ts && git commit -m "Cria a rota com os participantes do grupo do ticket"`.

---

### Task 5: Enviar as marcações

**Files:**
- Modify: `whatsapp-api/src/services/WbotServices/SendWhatsAppMessage.ts`
- Modify: `whatsapp-api/src/controllers/MessageController.ts` (`MessageData` e `store`)
- Test: `whatsapp-api/src/services/WbotServices/__tests__/SendWhatsAppMessage.spec.ts`

**Interfaces:**
- Consumes: `groupParticipants` (Task 2) e `mentions` no texto (Task 1).
- Produces: `SendWhatsAppMessage({ body, ticket, quotedMsg, mentions?: string[] })`. O `POST /messages/:ticketId` aceita `mentions`.

- [ ] **Step 1: Teste**

```ts
const send = jest.fn();
const groupParticipants = jest.fn();
const saveSent = jest.fn();

jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ send: (...a: any[]) => send(...a), groupParticipants: (...a: any[]) => groupParticipants(...a) }),
  ticketAddress: (t: any) => ({ number: t.contact.number, isGroup: t.isGroup }),
  messageRef: (m: any) => m
}));
jest.mock("../../MessageServices/SaveSentMessageService", () => ({ __esModule: true, default: (a: any) => saveSent(a) }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../helpers/Mustache", () => ({ __esModule: true, default: (body: string) => body }));

// eslint-disable-next-line import/first
import SendWhatsAppMessage from "../SendWhatsAppMessage";

const group: any = { id: 12, isGroup: true, contact: { number: "120363999" } };

beforeEach(() => {
  send.mockReset().mockResolvedValue({ externalId: "X" });
  groupParticipants.mockReset().mockResolvedValue([{ jid: "1@lid" }, { jid: "5511900000003@s.whatsapp.net" }]);
  saveSent.mockReset();
});

describe("SendWhatsAppMessage mentions", () => {
  it("sends only the mentioned jids that are in the group", async () => {
    await SendWhatsAppMessage({ body: "oi @1", ticket: group, mentions: ["1@lid", "999@lid"] });
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi @1", mentions: ["1@lid"] }, expect.anything());
  });

  it("ignores mentions outside groups and does not look up members", async () => {
    await SendWhatsAppMessage({ body: "oi", ticket: { ...group, isGroup: false }, mentions: ["1@lid"] });
    expect(groupParticipants).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi" }, expect.anything());
  });

  it("sends a plain text when there are no mentions", async () => {
    await SendWhatsAppMessage({ body: "oi", ticket: group });
    expect(groupParticipants).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi" }, expect.anything());
  });
});
```

- [ ] **Step 2: Rodar** `npx jest src/services/WbotServices/__tests__/SendWhatsAppMessage.spec.ts --coverage=false`. Expected: FAIL (`mentions` não existe em `Request`, ou `send` chamado sem `mentions`).

- [ ] **Step 3: Implementar.** Em `SendWhatsAppMessage.ts`, acrescentar `mentions?: string[];` à interface `Request`, receber `mentions` na desestruturação e, dentro do `try`, trocar a linha do `channel.send` por:

```ts
    // Only members of the group can be mentioned.
    let mentioned: string[] = [];
    if (ticket.isGroup && mentions?.length) {
      const members = new Set((await channel.groupParticipants(ticketAddress(ticket))).map(p => p.jid));
      mentioned = mentions.filter(jid => members.has(jid));
    }
    const content = mentioned.length ? { type: "text" as const, text, mentions: mentioned } : { type: "text" as const, text };
    const sent = await channel.send(ticketAddress(ticket), content, { quoted });
```

Em `MessageController.ts`, acrescentar `mentions?: string[];` ao `MessageData`. Em `store`, trocar `const { body, quotedMsg }: MessageData = req.body;` por `const { body, quotedMsg, mentions }: MessageData = req.body;` e passar `mentions` em `SendWhatsAppMessage({ body, ticket, quotedMsg, mentions })`.

- [ ] **Step 4: Rodar** o teste, `npx jest --coverage=false` e `npx tsc -p . --noEmit`. Expected: tudo PASS, e o `tsc` não mostra erros.

- [ ] **Step 5: Commit** `git add src/services/WbotServices src/controllers/MessageController.ts && git commit -m "Envia as marcações escolhidas, só de quem está no grupo"`.

---

### Task 6: Funções de marcação no app

**Files:**
- Create: `whatsapp-app/src/utils/mentionInput.js`
- Test: `whatsapp-app/src/utils/mentionInput.test.js`

**Interfaces:**
- Consumes: `ParticipantView` da API (`{ jid, token, name, phone, isAdmin }`).
- Produces:
  - `findMentionQuery(text, cursor) → { start, query } | null`;
  - `insertMention(text, cursor, match, label) → { text, cursor }`;
  - `mentionLabels(participants) → participants com `label` ("@Maria", "@Maria (7761)", "@+55 (31) 99114-7761")`;
  - `filterParticipants(labeled, query, limit = 8)`;
  - `buildMentionPayload(text, picked) → { text, mentions }`.

- [ ] **Step 1: Teste**

```js
import { findMentionQuery, insertMention, mentionLabels, filterParticipants, buildMentionPayload } from "./mentionInput";

describe("findMentionQuery", () => {
  it("finds @ at the start or after a space, up to the cursor", () => {
    expect(findMentionQuery("@ma", 3)).toEqual({ start: 0, query: "ma" });
    expect(findMentionQuery("oi @", 4)).toEqual({ start: 3, query: "" });
    expect(findMentionQuery("oi\n@jo tudo", 6)).toEqual({ start: 3, query: "jo" });
  });

  it("ignores emails, finished mentions and text after the cursor", () => {
    expect(findMentionQuery("ana@empresa", 11)).toBeNull();
    expect(findMentionQuery("@Maria oi", 9)).toBeNull();
    expect(findMentionQuery("oi", 2)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the typed @query with the label and a space", () => {
    expect(insertMention("oi @ma tudo", 6, { start: 3, query: "ma" }, "@Maria")).toEqual({ text: "oi @Maria  tudo", cursor: 10 });
  });
});

describe("mentionLabels", () => {
  it("uses the name, adds the last 4 digits to repeated names, and falls back to the phone", () => {
    const labeled = mentionLabels([
      { jid: "1@lid", token: "1", name: "Maria", phone: "5531991147761" },
      { jid: "2@lid", token: "2222", name: "maria", phone: null },
      { jid: "3@lid", token: "3", name: "Zé", phone: null },
      { jid: "4@lid", token: "4", name: null, phone: "5531991147761" },
      { jid: "5@lid", token: "55", name: null, phone: null }
    ]).map((p) => p.label);
    expect(labeled).toEqual(["@Maria (7761)", "@maria (2222)", "@Zé", "@+55 (31) 99114-7761", "@55"]);
  });
});

describe("filterParticipants", () => {
  const list = mentionLabels([
    { jid: "1@lid", token: "1", name: "José Silva", phone: "5531991147761" },
    { jid: "2@lid", token: "2", name: "Ana", phone: null }
  ]);

  it("matches names ignoring case and accents, and phones by digits", () => {
    expect(filterParticipants(list, "jose").map((p) => p.jid)).toEqual(["1@lid"]);
    expect(filterParticipants(list, "7761").map((p) => p.jid)).toEqual(["1@lid"]);
    expect(filterParticipants(list, "").map((p) => p.jid)).toEqual(["1@lid", "2@lid"]);
  });

  it("returns at most the limit", () => {
    const many = mentionLabels(Array.from({ length: 12 }, (_, i) => ({ jid: `${i}@lid`, token: `${i}`, name: `P${i}`, phone: null })));
    expect(filterParticipants(many, "")).toHaveLength(8);
  });
});

describe("buildMentionPayload", () => {
  const maria = { jid: "1@lid", token: "1", label: "@Maria" };
  const maria2 = { jid: "2@lid", token: "2", label: "@Maria (7761)" };

  it("writes the digits of each picked mention still in the text", () => {
    expect(buildMentionPayload("oi @Maria e @Maria (7761)", [maria, maria2])).toEqual({ text: "oi @1 e @2", mentions: ["1@lid", "2@lid"] });
  });

  it("drops mentions removed from the text and does not touch longer words", () => {
    expect(buildMentionPayload("oi @Mariana", [maria])).toEqual({ text: "oi @Mariana", mentions: [] });
  });

  it("keeps the text when nothing was picked", () => {
    expect(buildMentionPayload("oi", [])).toEqual({ text: "oi", mentions: [] });
  });
});
```

- [ ] **Step 2: Rodar** `CI=true npx react-scripts test src/utils/mentionInput.test.js --watchAll=false`. Expected: FAIL (`Cannot find module './mentionInput'`).

- [ ] **Step 3: Implementar**

```js
import formatPhone from "./formatPhone";

// Mentioning group members while typing: "@ma" opens the member list, a
// pick writes "@Maria", and on send "@Maria" becomes "@<digits>" plus the
// member's jid in `mentions` (what WhatsApp needs).

const normalize = (value) =>
  `${value || ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findMentionQuery = (text, cursor) => {
  const before = `${text || ""}`.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
};

export const insertMention = (text, cursor, match, label) => {
  const insert = `${label} `;
  return {
    text: text.slice(0, match.start) + insert + text.slice(cursor),
    cursor: match.start + insert.length,
  };
};

export const mentionLabels = (participants) => {
  const counts = participants.reduce((acc, p) => {
    if (p.name) acc[normalize(p.name)] = (acc[normalize(p.name)] || 0) + 1;
    return acc;
  }, {});
  return participants.map((p) => {
    let label;
    if (p.name) {
      const suffix = counts[normalize(p.name)] > 1 ? ` (${(p.phone || p.token).slice(-4)})` : "";
      label = `@${p.name}${suffix}`;
    } else {
      label = `@${p.phone ? formatPhone(p.phone) : p.token}`;
    }
    return { ...p, label };
  });
};

export const filterParticipants = (labeled, query, limit = 8) => {
  const q = normalize(query);
  const digits = `${query || ""}`.replace(/\D/g, "");
  return labeled
    .filter(
      (p) =>
        !q ||
        normalize(p.name).includes(q) ||
        normalize(p.label).includes(q) ||
        (digits && (`${p.phone || ""}`.includes(digits) || `${p.token}`.includes(digits)))
    )
    .slice(0, limit);
};

export const buildMentionPayload = (text, picked) => {
  const mentions = [];
  // Longer labels first: "@Maria (7761)" before "@Maria".
  const out = [...picked]
    .sort((a, b) => b.label.length - a.label.length)
    .reduce((acc, p) => {
      const pattern = new RegExp(`${escapeRegExp(p.label)}(?![A-Za-zÀ-ÿ0-9])`, "g");
      if (!pattern.test(acc)) return acc;
      if (!mentions.includes(p.jid)) mentions.push(p.jid);
      return acc.replace(pattern, () => `@${p.token}`);
    }, text);
  // Keep the order of the picks for the jid list.
  const ordered = picked.map((p) => p.jid).filter((jid, i, all) => mentions.includes(jid) && all.indexOf(jid) === i);
  return { text: out, mentions: ordered };
};
```

- [ ] **Step 4: Rodar de novo.** Expected: PASS (10 testes).

- [ ] **Step 5: Commit** `git add src/utils/mentionInput.js src/utils/mentionInput.test.js && git commit -m "Cria as funções para marcar participantes ao escrever"`.

---

### Task 7: Lista de participantes na caixa de mensagem

**Files:**
- Modify: `whatsapp-app/src/components/Ticket/index.js:178`
- Modify: `whatsapp-app/src/components/MessageInputCustom/index.js` (`CustomInput`, `MessageInputCustom`, `handleSendMessage`)

**Interfaces:**
- Consumes: Task 6 e `GET /tickets/:ticketId/participants` (Task 4).

- [ ] **Step 1: `Ticket/index.js`.** Trocar `<MessageInput ticketId={ticket.id} ticketStatus={ticket.status} />` por:

```jsx
        <MessageInput ticketId={ticket.id} ticketStatus={ticket.status} isGroup={ticket.isGroup} />
```

- [ ] **Step 2: Imports em `MessageInputCustom/index.js`**

```js
import { findMentionQuery, insertMention, mentionLabels, filterParticipants, buildMentionPayload } from "../../utils/mentionInput";
import formatPhone from "../../utils/formatPhone";
```

- [ ] **Step 3: `CustomInput`**
  - Acrescentar `isGroup, ticketId, onMentionPicked` às props desestruturadas.
  - Acrescentar os estados:

```js
  const [participants, setParticipants] = useState(null);
  const [mentionMatch, setMentionMatch] = useState(null);
```

  - Um efeito que limpa os participantes ao trocar de ticket:

```js
  useEffect(() => {
    setParticipants(null);
    setMentionMatch(null);
  }, [ticketId]);
```

  - No `useEffect` de `[inputMessage]`, como primeiro bloco dentro dele:

```js
    if (isGroup) {
      const cursor = inputRef.current ? inputRef.current.selectionStart : `${inputMessage}`.length;
      const match = findMentionQuery(inputMessage, cursor);
      setMentionMatch(match);
      if (match) {
        if (participants === null) {
          setParticipants([]);
          api
            .get(`/tickets/${ticketId}/participants`)
            .then(({ data }) => setParticipants(mentionLabels(data)))
            .catch((err) => {
              setParticipants(null);
              toastError(err);
            });
        }
        const found = filterParticipants(participants || [], match.query).map((p) => ({ ...p, kind: "mention" }));
        setOptions(found);
        setPopupOpen(found.length > 0);
        return;
      }
    }
```

  Acrescentar `participants` às dependências do efeito (`[inputMessage, participants]`), para a lista aparecer assim que a busca terminar.
  - No `<Autocomplete>`, acrescentar as props:

```jsx
        filterOptions={(opts) => opts}
        autoHighlight={!!mentionMatch}
        onClose={() => setPopupOpen(false)}
        renderOption={(option) =>
          isObject(option) && option.kind === "mention" ? (
            <span>
              {option.label}
              {option.name && option.phone && (
                <small style={{ opacity: 0.6, marginLeft: 8 }}>{formatPhone(option.phone)}</small>
              )}
            </span>
          ) : isObject(option) ? option.label : option
        }
```

  - No começo do `onChange={(event, opt) => { ... }}` que já existe:

```js
          if (isObject(opt) && opt.kind === "mention" && mentionMatch) {
            const cursor = inputRef.current ? inputRef.current.selectionStart : inputMessage.length;
            const next = insertMention(inputMessage, cursor, mentionMatch, opt.label);
            setInputMessage(next.text);
            onMentionPicked(opt);
            setPopupOpen(false);
            setTimeout(() => {
              if (inputRef.current) inputRef.current.setSelectionRange(next.cursor, next.cursor);
            }, 0);
            return;
          }
```

- [ ] **Step 4: `MessageInputCustom`**
  - `const { ticketStatus, ticketId, isGroup } = props;`
  - Acrescentar o estado `const [pickedMentions, setPickedMentions] = useState([]);`.
  - Acrescentar `useEffect(() => setPickedMentions([]), [ticketId]);`.
  - Em `handleSendMessage`, trocar a montagem do `message` por:

```js
    const { text, mentions } = isGroup
      ? buildMentionPayload(inputMessage.trim(), pickedMentions)
      : { text: inputMessage.trim(), mentions: [] };

    const message = {
      read: 1,
      fromMe: true,
      mediaUrl: "",
      body: signMessage ? `*${user?.name}:*\n${text}` : text,
      quotedMsg: replyingMessage,
      ...(mentions.length ? { mentions } : {}),
    };
```

  Depois de `setInputMessage("");`, acrescentar `setPickedMentions([]);`.
  - No `<CustomInput ...>`, acrescentar as props:

```jsx
            isGroup={isGroup}
            ticketId={ticketId}
            onMentionPicked={(p) => setPickedMentions((prev) => [...prev.filter((x) => x.jid !== p.jid), p])}
```

- [ ] **Step 5: Testes e build**

Run: `CI=true npx react-scripts test --watchAll=false && npm run build`
Expected: testes PASS e `Compiled` (só os avisos que já existiam).

- [ ] **Step 6: Commit** `git add src/components/Ticket/index.js src/components/MessageInputCustom/index.js && git commit -m "Mostra os participantes ao digitar @ num grupo"`.

---

### Task 8: HM e produção

- [ ] **Step 1:** `cd whatsapp-api && npx tsc -p .`, reiniciar o preview "backend" (depois do `preview_stop`, conferir com `pgrep -fl dist/server.js` que o processo antigo terminou).
- [ ] **Step 2:** No front de HM, no ticket de grupo "Teste":
  1. Digitar `@`: a lista aparece com os nomes.
  2. Digitar parte de um nome: a lista filtra.
  3. Enter escolhe, e não envia: entra `@Nome `.
  4. Esc fecha a lista.
  5. `/` continua abrindo as respostas rápidas.
  6. Enviar: no celular a pessoa aparece marcada, e no ticket aparece `@Nome` em azul.
  7. Um e-mail digitado (`a@b.com`) não abre a lista.
- [ ] **Step 3:** Mostrar o resultado ao usuário e pedir confirmação para produção. Com o sim dele: merge fast-forward na `main` dos dois repositórios, push, acompanhar os deploys no EasyPanel e conferir se os domínios respondem.
