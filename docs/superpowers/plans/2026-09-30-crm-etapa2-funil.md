# CRM etapa 2 — Tela do Funil de vendas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a tela `/funil`: quadro por funil com arrastar e soltar (`@dnd-kit`), criação de negócio, motivo de perda, gaveta do negócio com dados, histórico e a conversa do WhatsApp, atualizada em tempo real.

**Architecture:** Toda a lógica de estado do quadro fica em funções puras (`boardState.js`, `format.js`) testadas com jest; os componentes React só chamam essas funções e a API `/crm` da etapa 1. A página (`pages/Funnel/index.js`) é dona do estado (funis, colunas, filtros, gaveta aberta) e passa callbacks para `Board`, `DealDrawer` e os diálogos. A conversa reaproveita `MessagesList` e `MessageInputCustom` da tela de atendimento.

**Tech Stack:** React 17, Material-UI 4 (`@material-ui/core`, `@material-ui/lab` Autocomplete), `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2, socket.io-client 3, react-scripts test (jest).

**Spec:** `docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md` (passo 2 da "Ordem de entrega", seções "Telas → Funil de vendas" e "Gaveta do negócio"). A API usada é a da etapa 1 (`docs/superpowers/plans/2026-09-30-crm-etapa1-base.md`, Task 6). Fora desta etapa: botão "Criar negócio" e selo na conversa do atendimento (passo 3), configurações do CRM (passo 4), regras automáticas (passo 5).

## Global Constraints

- Todo o código desta etapa fica em `whatsapp-app` (o plano vive em `whatsapp-api/docs`). Caminhos abaixo são relativos a `whatsapp-app/` salvo indicação.
- Rota `/funil`; menu "Funil de vendas" na seção Atendimento, logo depois de "Quadro"; título da barra "Funil de vendas"; escondido e bloqueado por `withPlanFeature(..., "useCrm", "CRM")` quando o plano não tem `useCrm`.
- Colunas: título, quantidade e soma dos valores. Card: título (padrão = nome do contato), valor, responsável, dias na coluna, mensagens não lidas.
- Ganho e Perdido começam recolhidas e mostram só fechados nos últimos 30 dias (a API já filtra).
- Soltar em Perdido vindo de outra coluna abre o diálogo de motivo; fechar sem escolher desfaz o movimento. Reordenar dentro de Perdido não pede motivo.
- Movimento otimista: o card muda na hora; se a API recusar, volta para onde estava e mostra o erro com `toastError`.
- 50 cards por coluna e página (`PAGE_SIZE` da API); a próxima página carrega ao rolar até o fim da coluna.
- Tempo real: o evento `company-${companyId}-deal` traz só `{ action, dealId, funnelId, stageId }`; a tela recarrega o negócio por `GET /crm/deals/:id` (404 = saiu da visão, remover o card). `company-${companyId}-funnel` recarrega funis e quadro. Não lidas vêm de `company-${companyId}-appMessage` (`action: "create"`, `data.ticket.contactId`, `data.ticket.unreadMessages`) e de `company-${companyId}-ticket` (`action: "update"`, `data.ticket`).
- Origens: `ad` Anúncio, `instagram` Instagram, `site` Site, `referral` Indicação, `whatsapp` WhatsApp direto, `other` Outro.
- Arrastar com mouse, toque e teclado. Teclado: Espaço pega e solta, setas movem, Esc cancela; Enter abre a gaveta.
- Estilo: tokens do tema (`theme.tokens.*`, `theme.radii.*`, `theme.scrollbarStylesSoft`), como `pages/AiAgents`. Textos em português; comentários de código em inglês, curtos.
- Commits em português terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push.

## Review Focus

1. **Arrastar um card e soltar fora de qualquer coluna, ou apertar Esc no meio** → o card volta exatamente para onde estava, sem chamada à API. Teste em `boardState.test.js` (`moveCard` + restaurar o snapshot) e conferência no HM (Task 7).
2. **Evento de tempo real de um negócio que o usuário não pode ver** (404 no `GET /crm/deals/:id`) ou que mudou de funil → o card some do quadro; nenhum erro na tela. Teste em `boardState.test.js` (`removeCard`) e tratamento do 404 na Task 4.
3. **Coluna com mais de 50 negócios e evento de um negócio que está além da página carregada** → a contagem e a soma da coluna mudam, mas o card não aparece fora de ordem no fim da lista. Teste em `boardState.test.js` (`upsertCard` com `hasMore`).
4. **Contato sem ticket nenhum** → a aba Conversa mostra "Iniciar conversa" em vez de quebrar. **Ticket pendente ou fechado** → mostra "Aceitar"/"Reabrir" e a caixa de envio só libera depois. Conferido no HM (Task 7).
5. **Valor digitado com vírgula ("1.200,50"), vazio ou negativo** na gaveta → salva 1200,50; vazio vira 0; negativo mostra o erro da API e o campo volta ao valor salvo. Teste em `format.test.js` (`parseMoneyInput`).

---

## Estrutura de arquivos (`whatsapp-app/`)

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `package-lock.json` | dependências `@dnd-kit/*` |
| `src/pages/Funnel/format.js` | rótulos de origem, dinheiro, dias na coluna, texto dos eventos do histórico, leitura de valor digitado |
| `src/pages/Funnel/boardState.js` | estado puro do quadro: montar, paginar, mover, inserir/atualizar/remover, não lidas, vizinhos |
| `src/pages/Funnel/format.test.js`, `boardState.test.js` | testes |
| `src/pages/Funnel/index.js` | página: funis, filtros, quadro, gaveta, diálogos, tempo real |
| `src/pages/Funnel/EmptyState.js` | sem funil (admin cria o primeiro; usuário vê aviso) |
| `src/pages/Funnel/Board.js` | `DndContext`, colunas, overlay de arrasto |
| `src/pages/Funnel/Column.js` | coluna droppable + lista sortable + carregar mais |
| `src/pages/Funnel/DealCard.js` | card sortable |
| `src/pages/Funnel/LossReasonDialog.js` | escolher motivo de perda |
| `src/pages/Funnel/NewDealDialog.js` | criar negócio (contato, título, valor, coluna, responsável) |
| `src/pages/Funnel/DealDrawer/index.js` | gaveta: cabeçalho, abas, carregar negócio |
| `src/pages/Funnel/DealDrawer/DealForm.js` | campos com salvamento ao sair do campo + ações ganho/perdido/reabrir/mover de funil |
| `src/pages/Funnel/DealDrawer/History.js` | histórico |
| `src/pages/Funnel/DealDrawer/ChatPanel.js` | conversa do contato |
| `src/layout/icons.js` | `FunnelIcon` |
| `src/layout/MainListItems.js`, `src/layout/index.js`, `src/routes/index.js` | menu, título, rota |

---

### Task 1: Dependências e funções puras (format + boardState)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/pages/Funnel/format.js`, `src/pages/Funnel/boardState.js`
- Test: `src/pages/Funnel/format.test.js`, `src/pages/Funnel/boardState.test.js`

**Interfaces:**
- Produces (`format.js`):
  - `SOURCE_LABELS: Record<string, string>`, `SOURCE_OPTIONS: { value, label }[]`
  - `formatMoney(value: number | string): string` — `"R$ 2.400,00"` (espaço normal, não NBSP, para os testes e para não quebrar a linha de forma estranha)
  - `parseMoneyInput(text: string): number | null` — `"1.200,50"` → `1200.5`; `""` → `0`; inválido → `null`
  - `daysInStage(enteredAt: string | Date, now?: Date): number`, `daysLabel(days: number): string`
  - `eventLabel(event, { stagesById, reasonsById, usersById }): string`
- Produces (`boardState.js`), com `Columns = { [stageId: number]: { deals: Card[]; count: number; total: number; hasMore: boolean; page: number } }`:
  - `fromListResponse(data: { stages: { stageId, count, total, deals, hasMore }[] }): Columns`
  - `appendPage(columns, stageId, data): Columns` (junta a página seguinte da coluna, sem duplicar)
  - `findCard(columns, dealId): { stageId, index, card } | null`
  - `moveCard(columns, dealId, toStageId, toIndex): Columns` (ajusta contagem e soma das duas colunas)
  - `neighbours(columns, stageId, dealId): { beforeId: number | null; afterId: number | null }`
  - `upsertCard(columns, card): Columns` (tira de onde estiver; insere na coluna do card por `position`; se a coluna tem `hasMore` e a posição passa da última carregada, só ajusta contagem e soma)
  - `removeCard(columns, dealId): Columns`
  - `setUnread(columns, contactId, unread): Columns`
  - `cardFromDeal(deal, unread?: number): Card` (converte a resposta de `GET /crm/deals/:id` no formato do card)

- [ ] **Step 1: Instalar as dependências**

Run: `cd whatsapp-app && npm install @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`
Expected: `package.json` com as três dependências e `package-lock.json` atualizado, sem erro de peer dependency.

- [ ] **Step 2: Escrever os testes que falham**

`src/pages/Funnel/format.test.js`:

```js
import { formatMoney, parseMoneyInput, daysInStage, daysLabel, eventLabel, SOURCE_LABELS } from "./format";

describe("formatMoney", () => {
  it("formats reais in pt-BR with a plain space", () => {
    expect(formatMoney(2400)).toBe("R$ 2.400,00");
    expect(formatMoney("1200.5")).toBe("R$ 1.200,50");
    expect(formatMoney(null)).toBe("R$ 0,00");
  });
});

describe("parseMoneyInput", () => {
  it("reads Brazilian and plain numbers", () => {
    expect(parseMoneyInput("1.200,50")).toBe(1200.5);
    expect(parseMoneyInput("1200.50")).toBe(1200.5);
    expect(parseMoneyInput("R$ 99,9")).toBe(99.9);
    expect(parseMoneyInput("2400")).toBe(2400);
  });
  it("treats empty as zero and garbage as invalid", () => {
    expect(parseMoneyInput("")).toBe(0);
    expect(parseMoneyInput("   ")).toBe(0);
    expect(parseMoneyInput("abc")).toBeNull();
  });
  it("keeps negatives so the API can refuse them", () => {
    expect(parseMoneyInput("-5")).toBe(-5);
  });
});

describe("daysInStage / daysLabel", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("counts whole days since the deal entered the stage", () => {
    expect(daysInStage("2026-09-30T08:00:00Z", now)).toBe(0);
    expect(daysInStage("2026-09-26T12:00:00Z", now)).toBe(4);
    expect(daysInStage("2026-10-02T12:00:00Z", now)).toBe(0);
  });
  it("labels the count", () => {
    expect(daysLabel(0)).toBe("hoje");
    expect(daysLabel(1)).toBe("1 dia");
    expect(daysLabel(4)).toBe("4 dias");
  });
});

describe("eventLabel", () => {
  const ctx = {
    stagesById: { 1: { name: "Lead" }, 2: { name: "Proposta" } },
    reasonsById: { 3: { name: "Preço" } },
    usersById: { 7: { name: "João" } }
  };
  it("describes each event type", () => {
    expect(eventLabel({ type: "created" }, ctx)).toBe("Negócio criado");
    expect(eventLabel({ type: "stage_changed", fromValue: "1", toValue: "2" }, ctx)).toBe("Moveu de Lead para Proposta");
    expect(eventLabel({ type: "won" }, ctx)).toBe("Marcou como ganho");
    expect(eventLabel({ type: "lost", toValue: "3" }, ctx)).toBe("Marcou como perdido: Preço");
    expect(eventLabel({ type: "reopened" }, ctx)).toBe("Reabriu o negócio");
    expect(eventLabel({ type: "owner_changed", toValue: "7" }, ctx)).toBe("Responsável: João");
    expect(eventLabel({ type: "owner_changed", toValue: null }, ctx)).toBe("Responsável removido");
    expect(eventLabel({ type: "edited", toValue: "value,notes" }, ctx)).toBe("Editou valor, observações");
  });
  it("falls back when a stage or reason is gone", () => {
    expect(eventLabel({ type: "stage_changed", fromValue: "9", toValue: "2" }, ctx)).toBe("Moveu de coluna removida para Proposta");
    expect(eventLabel({ type: "lost", toValue: "99" }, ctx)).toBe("Marcou como perdido");
  });
});

describe("SOURCE_LABELS", () => {
  it("covers the six fixed sources", () => {
    expect(Object.keys(SOURCE_LABELS)).toEqual(["ad", "instagram", "site", "referral", "whatsapp", "other"]);
  });
});
```

`src/pages/Funnel/boardState.test.js`:

```js
import {
  fromListResponse, appendPage, findCard, moveCard, neighbours,
  upsertCard, removeCard, setUnread, cardFromDeal
} from "./boardState";

const card = (id, stageId, position, value = 100, contactId = id) => ({
  id, stageId, position, value, contact: { id: contactId, name: `C${id}` }, unread: 0
});

const base = () =>
  fromListResponse({
    stages: [
      { stageId: 1, count: 2, total: 300, hasMore: false, deals: [card(10, 1, 1024, 100), card(11, 1, 2048, 200)] },
      { stageId: 2, count: 1, total: 50, hasMore: false, deals: [card(20, 2, 1024, 50)] }
    ]
  });

describe("fromListResponse / appendPage", () => {
  it("indexes columns by stage", () => {
    const c = base();
    expect(c[1].deals.map(d => d.id)).toEqual([10, 11]);
    expect(c[1]).toMatchObject({ count: 2, total: 300, hasMore: false, page: 1 });
  });
  it("appends the next page without duplicates", () => {
    const c = appendPage(base(), 1, { stages: [{ stageId: 1, count: 3, total: 400, hasMore: false, deals: [card(11, 1, 2048, 200), card(12, 1, 3072)] }] });
    expect(c[1].deals.map(d => d.id)).toEqual([10, 11, 12]);
    expect(c[1].page).toBe(2);
    expect(c[1].count).toBe(3);
  });
});

describe("findCard / neighbours", () => {
  it("finds a card and its neighbours", () => {
    const c = base();
    expect(findCard(c, 11)).toMatchObject({ stageId: 1, index: 1 });
    expect(findCard(c, 99)).toBeNull();
    expect(neighbours(c, 1, 10)).toEqual({ beforeId: null, afterId: 11 });
    expect(neighbours(c, 1, 11)).toEqual({ beforeId: 10, afterId: null });
  });
});

describe("moveCard", () => {
  it("moves across columns and adjusts count and total", () => {
    const c = moveCard(base(), 11, 2, 0);
    expect(c[1].deals.map(d => d.id)).toEqual([10]);
    expect(c[2].deals.map(d => d.id)).toEqual([11, 20]);
    expect(c[1]).toMatchObject({ count: 1, total: 100 });
    expect(c[2]).toMatchObject({ count: 2, total: 250 });
    expect(c[2].deals[0].stageId).toBe(2);
  });
  it("reorders inside a column without touching totals", () => {
    const c = moveCard(base(), 11, 1, 0);
    expect(c[1].deals.map(d => d.id)).toEqual([11, 10]);
    expect(c[1]).toMatchObject({ count: 2, total: 300 });
  });
  it("clamps the index and leaves the input untouched (snapshot can be restored)", () => {
    const before = base();
    const after = moveCard(before, 10, 2, 99);
    expect(after[2].deals.map(d => d.id)).toEqual([20, 10]);
    expect(before[1].deals.map(d => d.id)).toEqual([10, 11]);
  });
  it("ignores unknown cards or stages", () => {
    const c = base();
    expect(moveCard(c, 99, 2, 0)).toBe(c);
    expect(moveCard(c, 10, 77, 0)).toBe(c);
  });
});

describe("upsertCard", () => {
  it("inserts a new card by position and bumps count/total", () => {
    const c = upsertCard(base(), card(13, 1, 1500, 10));
    expect(c[1].deals.map(d => d.id)).toEqual([10, 13, 11]);
    expect(c[1]).toMatchObject({ count: 3, total: 310 });
  });
  it("moves an existing card to its new stage and position", () => {
    const c = upsertCard(base(), { ...card(10, 2, 5000, 100) });
    expect(c[1].deals.map(d => d.id)).toEqual([11]);
    expect(c[2].deals.map(d => d.id)).toEqual([20, 10]);
    expect(c[1]).toMatchObject({ count: 1, total: 200 });
    expect(c[2]).toMatchObject({ count: 2, total: 150 });
  });
  it("updates value in place", () => {
    const c = upsertCard(base(), card(11, 1, 2048, 500));
    expect(c[1].deals.map(d => d.id)).toEqual([10, 11]);
    expect(c[1].total).toBe(600);
  });
  it("does not show a card past the loaded page but still counts it", () => {
    const cols = fromListResponse({
      stages: [{ stageId: 1, count: 60, total: 6000, hasMore: true, deals: [card(10, 1, 1024), card(11, 1, 2048)] }]
    });
    const c = upsertCard(cols, card(70, 1, 9999, 100));
    expect(c[1].deals.map(d => d.id)).toEqual([10, 11]);
    expect(c[1]).toMatchObject({ count: 61, total: 6100 });
  });
  it("drops the card from the board when its stage is not on this board", () => {
    const c = upsertCard(base(), card(10, 99, 1));
    expect(findCard(c, 10)).toBeNull();
    expect(c[1]).toMatchObject({ count: 1, total: 200 });
  });
});

describe("removeCard / setUnread", () => {
  it("removes a card and adjusts its column", () => {
    const c = removeCard(base(), 10);
    expect(c[1].deals.map(d => d.id)).toEqual([11]);
    expect(c[1]).toMatchObject({ count: 1, total: 200 });
    expect(removeCard(c, 10)).toBe(c);
  });
  it("sets unread on every card of the contact", () => {
    const cols = fromListResponse({
      stages: [{ stageId: 1, count: 2, total: 0, hasMore: false, deals: [card(10, 1, 1, 0, 5), card(11, 1, 2, 0, 6)] }]
    });
    const c = setUnread(cols, 5, 3);
    expect(c[1].deals.map(d => d.unread)).toEqual([3, 0]);
  });
});

describe("cardFromDeal", () => {
  it("converts the deal detail into a card", () => {
    const deal = {
      id: 4, title: "X", value: "1200.50", userId: 7, user: { id: 7, name: "João" },
      contact: { id: 2, name: "Maria", number: "55", profilePicUrl: "" },
      funnelId: 1, stageId: 3, position: 10, status: "open", stageEnteredAt: "2026-09-30T00:00:00Z"
    };
    expect(cardFromDeal(deal, 2)).toEqual({
      id: 4, title: "X", value: 1200.5, userId: 7, user: { id: 7, name: "João" },
      contact: { id: 2, name: "Maria", number: "55", profilePicUrl: "" },
      funnelId: 1, stageId: 3, position: 10, status: "open", stageEnteredAt: "2026-09-30T00:00:00Z", unread: 2
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/Funnel`
Expected: FAIL com "Cannot find module './format'" e "'./boardState'".

- [ ] **Step 4: Implementar**

`src/pages/Funnel/format.js`:

```js
export const SOURCE_LABELS = {
  ad: "Anúncio",
  instagram: "Instagram",
  site: "Site",
  referral: "Indicação",
  whatsapp: "WhatsApp direto",
  other: "Outro",
};

export const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Intl puts a no-break space after "R$"; a plain one is easier to compare.
export const formatMoney = (value) => money.format(Number(value) || 0).replace(/ /g, " ");

// Accepts "1.200,50", "1200.50", "R$ 99,9"; empty means zero, garbage null.
export const parseMoneyInput = (text) => {
  const raw = String(text ?? "").replace(/R\$/g, "").trim();
  if (raw === "") return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
};

const DAY = 24 * 60 * 60 * 1000;

export const daysInStage = (enteredAt, now = new Date()) =>
  Math.max(0, Math.floor((now.getTime() - new Date(enteredAt).getTime()) / DAY));

export const daysLabel = (days) => (days === 0 ? "hoje" : days === 1 ? "1 dia" : `${days} dias`);

const FIELD_LABELS = {
  title: "título",
  value: "valor",
  expectedCloseDate: "previsão de fechamento",
  source: "origem",
  notes: "observações",
};

export const eventLabel = (event, { stagesById = {}, reasonsById = {}, usersById = {} } = {}) => {
  const stage = (id) => (stagesById[id] ? stagesById[id].name : "coluna removida");
  switch (event.type) {
    case "created":
      return "Negócio criado";
    case "stage_changed":
      return `Moveu de ${stage(event.fromValue)} para ${stage(event.toValue)}`;
    case "won":
      return "Marcou como ganho";
    case "lost": {
      const reason = reasonsById[event.toValue];
      return reason ? `Marcou como perdido: ${reason.name}` : "Marcou como perdido";
    }
    case "reopened":
      return "Reabriu o negócio";
    case "owner_changed": {
      if (!event.toValue) return "Responsável removido";
      const user = usersById[event.toValue];
      return `Responsável: ${user ? user.name : "outro usuário"}`;
    }
    case "edited": {
      const fields = String(event.toValue || "").split(",").filter(Boolean).map((f) => FIELD_LABELS[f] || f);
      return `Editou ${fields.join(", ")}`;
    }
    default:
      return event.type;
  }
};
```

`src/pages/Funnel/boardState.js`:

```js
// Pure board state. Columns are keyed by stage id; deals inside a column are
// kept in the order the API returns (position ascending).

const column = (s) => ({
  deals: s.deals || [],
  count: s.count || 0,
  total: s.total || 0,
  hasMore: !!s.hasMore,
  page: 1,
});

export const fromListResponse = (data) =>
  Object.fromEntries((data.stages || []).map((s) => [s.stageId, column(s)]));

export const appendPage = (columns, stageId, data) => {
  const next = (data.stages || []).find((s) => s.stageId === stageId);
  const current = columns[stageId];
  if (!next || !current) return columns;
  const seen = new Set(current.deals.map((d) => d.id));
  return {
    ...columns,
    [stageId]: {
      deals: [...current.deals, ...next.deals.filter((d) => !seen.has(d.id))],
      count: next.count,
      total: next.total,
      hasMore: next.hasMore,
      page: current.page + 1,
    },
  };
};

export const findCard = (columns, dealId) => {
  for (const [stageId, col] of Object.entries(columns)) {
    const index = col.deals.findIndex((d) => d.id === dealId);
    if (index !== -1) return { stageId: Number(stageId), index, card: col.deals[index] };
  }
  return null;
};

const value = (card) => Number(card.value) || 0;

const without = (col, card) => ({
  ...col,
  deals: col.deals.filter((d) => d.id !== card.id),
  count: Math.max(0, col.count - 1),
  total: col.total - value(card),
});

export const moveCard = (columns, dealId, toStageId, toIndex) => {
  const found = findCard(columns, dealId);
  if (!found || !columns[toStageId]) return columns;
  const moved = { ...found.card, stageId: toStageId };
  if (found.stageId === toStageId) {
    const deals = columns[toStageId].deals.filter((d) => d.id !== dealId);
    const index = Math.max(0, Math.min(toIndex, deals.length));
    deals.splice(index, 0, moved);
    return { ...columns, [toStageId]: { ...columns[toStageId], deals } };
  }
  const from = without(columns[found.stageId], found.card);
  const target = columns[toStageId];
  const deals = [...target.deals];
  deals.splice(Math.max(0, Math.min(toIndex, deals.length)), 0, moved);
  return {
    ...columns,
    [found.stageId]: from,
    [toStageId]: { ...target, deals, count: target.count + 1, total: target.total + value(moved) },
  };
};

export const neighbours = (columns, stageId, dealId) => {
  const deals = (columns[stageId] && columns[stageId].deals) || [];
  const index = deals.findIndex((d) => d.id === dealId);
  if (index === -1) return { beforeId: null, afterId: null };
  return {
    beforeId: index > 0 ? deals[index - 1].id : null,
    afterId: index < deals.length - 1 ? deals[index + 1].id : null,
  };
};

export const removeCard = (columns, dealId) => {
  const found = findCard(columns, dealId);
  if (!found) return columns;
  return { ...columns, [found.stageId]: without(columns[found.stageId], found.card) };
};

export const upsertCard = (columns, card) => {
  const cleared = removeCard(columns, card.id);
  const target = cleared[card.stageId];
  if (!target) return cleared;
  const counted = { ...target, count: target.count + 1, total: target.total + value(card) };
  const last = target.deals[target.deals.length - 1];
  // Past the loaded page: it shows up when the user scrolls there.
  if (target.hasMore && last && card.position > last.position) {
    return { ...cleared, [card.stageId]: counted };
  }
  const deals = [...target.deals];
  let index = deals.findIndex((d) => d.position > card.position || (d.position === card.position && d.id > card.id));
  if (index === -1) index = deals.length;
  deals.splice(index, 0, card);
  return { ...cleared, [card.stageId]: { ...counted, deals } };
};

export const setUnread = (columns, contactId, unread) =>
  Object.fromEntries(
    Object.entries(columns).map(([stageId, col]) => [
      stageId,
      col.deals.some((d) => d.contact && d.contact.id === contactId)
        ? { ...col, deals: col.deals.map((d) => (d.contact && d.contact.id === contactId ? { ...d, unread } : d)) }
        : col,
    ])
  );

export const cardFromDeal = (deal, unread = 0) => ({
  id: deal.id,
  title: deal.title,
  value: Number(deal.value) || 0,
  userId: deal.userId,
  user: deal.user ? { id: deal.user.id, name: deal.user.name } : null,
  contact: deal.contact
    ? { id: deal.contact.id, name: deal.contact.name, number: deal.contact.number, profilePicUrl: deal.contact.profilePicUrl }
    : null,
  funnelId: deal.funnelId,
  stageId: deal.stageId,
  position: deal.position,
  status: deal.status,
  stageEnteredAt: deal.stageEnteredAt,
  unread,
});
```

Nota: `Object.fromEntries` em `setUnread` converte as chaves para string; o acesso `columns[stageId]` com número continua funcionando porque chaves de objeto são sempre strings.

- [ ] **Step 5: Rodar e ver passar**

Run: `CI=true npx react-scripts test --watchAll=false src/pages/Funnel`
Expected: PASS, 2 suites.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/pages/Funnel/format.js src/pages/Funnel/boardState.js src/pages/Funnel/format.test.js src/pages/Funnel/boardState.test.js
git commit -m "Adiciona dnd-kit e o estado puro do quadro do funil

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rota, menu, ícone e página com seleção de funil

**Files:**
- Modify: `src/layout/icons.js` (depois de `KanbanIcon`)
- Modify: `src/layout/MainListItems.js` (import, estado `showCrm`, item de menu depois do Quadro)
- Modify: `src/layout/index.js` (`PAGE_TITLES`)
- Modify: `src/routes/index.js` (import, `FunnelGated`, rota `/funil`)
- Create: `src/pages/Funnel/index.js`, `src/pages/Funnel/EmptyState.js`

**Interfaces:**
- Consumes: `withPlanFeature` (`components/PlanFeatureGate`), `GET /crm/funnels`, `POST /crm/funnels`, `GET /crm/funnels/:id/deals`.
- Produces: `FunnelIcon`; página `Funnel` com estado `funnels`, `funnelId`, `columns`, `filters` e funções `reloadFunnels()`, `reloadBoard()` usadas pelas Tasks 3–6. Chave de localStorage `crm.funnelId`.

- [ ] **Step 1: Ícone, menu, título e rota**

Em `src/layout/icons.js`, depois do bloco `export const KanbanIcon = ...;`:

```js
export const FunnelIcon = line("FunnelIcon", <path d="M3 4h18l-7 8.5V19l-4 1.5v-8L3 4z" />);
```

Em `src/layout/MainListItems.js`: no import de `./icons`, depois de `KanbanIcon,` adicionar `FunnelIcon,`; depois de `const [showKanban, setShowKanban] = useState(false);` adicionar `const [showCrm, setShowCrm] = useState(false);`; depois de `setShowKanban(!!planConfigs.plan.useKanban);` adicionar `setShowCrm(!!planConfigs.plan.useCrm);`; e depois do bloco `{showKanban && (...)}`:

```js
        {showCrm && (
          <NavItem to="/funil" primary="Funil de vendas" icon={<FunnelIcon />} />
        )}
```

Em `src/layout/index.js`, em `PAGE_TITLES`, depois de `["/quadro", "Quadro de atendimentos"],`: `["/funil", "Funil de vendas"],`.

Em `src/routes/index.js`: `import Funnel from "../pages/Funnel";` junto dos imports de páginas; depois de `const KanbanGated = ...;` adicionar `const FunnelGated = withPlanFeature(Funnel, "useCrm", "CRM");`; e depois da rota `/quadro`:

```js
                <Route exact path="/funil" component={FunnelGated} isPrivate />
```

- [ ] **Step 2: EmptyState**

`src/pages/Funnel/EmptyState.js`:

```js
import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";
import { FunnelIcon } from "../../layout/icons";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    root: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 12,
      padding: theme.spacing(6, 3),
      backgroundColor: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: theme.radii.panel,
      "& h3": { margin: 0, fontSize: 18, color: t.textPrimary },
      "& p": { margin: 0, maxWidth: 420, fontSize: 14, color: t.textSecondary },
    },
    icon: {
      width: 64,
      height: 64,
      borderRadius: 18,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.brandSoft,
      color: t.brand,
      "& .MuiSvgIcon-root": { fontSize: 30 },
    },
    form: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", justifyContent: "center" },
  };
});

const EmptyState = ({ isAdmin, onCreate }) => {
  const classes = useStyles();
  const [name, setName] = useState("Vendas");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate(name.trim());
    setSaving(false);
  };

  return (
    <section className={classes.root} aria-label="Funil de vendas">
      <span className={classes.icon} aria-hidden="true"><FunnelIcon /></span>
      {isAdmin ? (
        <>
          <h3>Crie seu primeiro funil</h3>
          <p>O funil já nasce com as colunas Lead, Qualificação, Proposta, Negociação, Ganho e Perdido.</p>
          <form className={classes.form} onSubmit={submit}>
            <TextField
              size="small"
              variant="outlined"
              label="Nome do funil"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" color="primary" variant="contained" disabled={saving || !name.trim()}>
              Criar funil
            </Button>
          </form>
        </>
      ) : (
        <>
          <h3>Nenhum funil disponível</h3>
          <p>Nenhum funil de vendas está liberado para as suas filas. Fale com o administrador.</p>
        </>
      )}
    </section>
  );
};

export default EmptyState;
```

- [ ] **Step 3: Página com funis, filtros e carga do quadro**

`src/pages/Funnel/index.js` (versão desta task; as Tasks 3–6 acrescentam ao mesmo arquivo nos pontos marcados pelos comentários `// Task N:`):

```js
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";
import InputAdornment from "@material-ui/core/InputAdornment";
import CircularProgress from "@material-ui/core/CircularProgress";
import SearchIcon from "@material-ui/icons/Search";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import { AuthContext } from "../../context/Auth/AuthContext";
import EmptyState from "./EmptyState";
import { SOURCE_OPTIONS } from "./format";
import { fromListResponse } from "./boardState";

const FUNNEL_KEY = "crm.funnelId";

const useStyles = makeStyles((theme) => ({
  filters: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  select: { minWidth: 180 },
  search: { minWidth: 220 },
  loading: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
}));

const readStoredFunnel = () => {
  try {
    return Number(localStorage.getItem(FUNNEL_KEY)) || null;
  } catch (e) {
    return null;
  }
};

const Funnel = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const isAdmin = user.profile === "admin";

  const [funnels, setFunnels] = useState(null);
  const [funnelId, setFunnelId] = useState(readStoredFunnel);
  const [columns, setColumns] = useState({});
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ search: "", userId: "", source: "" });
  const [users, setUsers] = useState([]);

  const funnel = useMemo(() => (funnels || []).find((f) => f.id === funnelId) || null, [funnels, funnelId]);

  const reloadFunnels = useCallback(async () => {
    try {
      const { data } = await api.get("/crm/funnels");
      setFunnels(data);
      setFunnelId((current) => (data.some((f) => f.id === current) ? current : data[0] ? data[0].id : null));
    } catch (err) {
      toastError(err);
      setFunnels([]);
    }
  }, []);

  const reloadBoard = useCallback(async () => {
    if (!funnelId) return;
    setLoadingBoard(true);
    try {
      const { data } = await api.get(`/crm/funnels/${funnelId}/deals`, {
        params: {
          search: filters.search || undefined,
          userId: filters.userId || undefined,
          source: filters.source || undefined,
        },
      });
      setColumns(fromListResponse(data));
    } catch (err) {
      toastError(err);
    }
    setLoadingBoard(false);
  }, [funnelId, filters]);

  useEffect(() => {
    reloadFunnels();
  }, [reloadFunnels]);

  useEffect(() => {
    reloadBoard();
  }, [reloadBoard]);

  useEffect(() => {
    if (!funnelId) return;
    try {
      localStorage.setItem(FUNNEL_KEY, String(funnelId));
    } catch (e) {
      // storage blocked: the funnel is just not remembered
    }
  }, [funnelId]);

  useEffect(() => {
    api.get("/users/list").then(({ data }) => setUsers(data)).catch(() => setUsers([]));
  }, []);

  // Debounced search so each keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, search: search.trim() })), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const createFirstFunnel = async (name) => {
    try {
      const { data } = await api.post("/crm/funnels", { name });
      setFunnelId(data.id);
      await reloadFunnels();
    } catch (err) {
      toastError(err);
    }
  };

  // Task 4: realtime listeners go here.

  if (funnels === null) {
    return (
      <MainContainer>
        <div className={classes.loading}><CircularProgress /></div>
      </MainContainer>
    );
  }

  if (funnels.length === 0) {
    return (
      <MainContainer>
        <EmptyState isAdmin={isAdmin} onCreate={createFirstFunnel} />
      </MainContainer>
    );
  }

  return (
    <MainContainer>
      <MainHeader>
        <MainHeaderButtonsWrapper>
          <div className={classes.filters}>
            <TextField
              select
              size="small"
              variant="outlined"
              label="Funil"
              className={classes.select}
              value={funnelId || ""}
              onChange={(e) => setFunnelId(Number(e.target.value))}
            >
              {funnels.map((f) => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              variant="outlined"
              type="search"
              placeholder="Buscar negócio ou contato"
              className={classes.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputProps={{ "aria-label": "Buscar negócio ou contato" }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                ),
              }}
            />
            <TextField
              select
              size="small"
              variant="outlined"
              label="Responsável"
              className={classes.select}
              value={filters.userId}
              onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
            >
              <MenuItem value="">Todos</MenuItem>
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              variant="outlined"
              label="Origem"
              className={classes.select}
              value={filters.source}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
            >
              <MenuItem value="">Todas</MenuItem>
              {SOURCE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
            {/* Task 5: "+ Negócio" button goes here. */}
          </div>
        </MainHeaderButtonsWrapper>
      </MainHeader>
      {/* Task 3: <Board /> replaces this placeholder. */}
      {loadingBoard && Object.keys(columns).length === 0 ? (
        <div className={classes.loading}><CircularProgress /></div>
      ) : (
        <pre data-testid="funnel-debug">{JSON.stringify({ funnel: funnel && funnel.name, stages: Object.keys(columns).length })}</pre>
      )}
    </MainContainer>
  );
};

export default Funnel;
```

- [ ] **Step 4: Conferir no navegador**

Com o HM rodando (backend e frontend) e `Plans.useCrm = true`:

1. Abrir `http://localhost:3000/funil`: o menu mostra "Funil de vendas" logo abaixo de "Quadro" e a barra mostra "Funil de vendas".
2. Com os funis "Smoke" da etapa 1 arquivados, a tela mostra "Crie seu primeiro funil"; criar "Vendas" → o seletor aparece com "Vendas" e o placeholder mostra `"stages":6`.
3. Desligar `useCrm` no plano do HM e recarregar: menu sem o item e `/funil` com "Recurso não incluído no plano". Religar.

Run: `npx eslint src/pages/Funnel src/layout/MainListItems.js src/layout/index.js src/routes/index.js src/layout/icons.js`
Expected: sem erros (avisos antigos de `routes/index.js` continuam).

- [ ] **Step 5: Commit**

```bash
git add src/layout/icons.js src/layout/MainListItems.js src/layout/index.js src/routes/index.js src/pages/Funnel/index.js src/pages/Funnel/EmptyState.js
git commit -m "Adiciona a página do Funil de vendas com seleção de funil e filtros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Quadro com arrastar e soltar

**Files:**
- Create: `src/pages/Funnel/Board.js`, `src/pages/Funnel/Column.js`, `src/pages/Funnel/DealCard.js`, `src/pages/Funnel/LossReasonDialog.js`
- Modify: `src/pages/Funnel/index.js` (trocar o placeholder pelo `Board`; mover, desfazer, motivo de perda, carregar mais)

**Interfaces:**
- Consumes: `moveCard`, `neighbours`, `findCard`, `upsertCard`, `appendPage` (Task 1); `formatMoney`, `daysInStage`, `daysLabel` (Task 1); `PUT /crm/deals/:id/move`, `GET /crm/loss-reasons`, `GET /crm/funnels/:id/deals?stageId&page`.
- Produces:
  - `<Board stages columns expanded onToggle(stageId) onMove({ dealId, fromStageId, toStageId, beforeId, afterId, snapshot }) onPreview(columns) onCancel(snapshot) onOpen(dealId) onLoadMore(stageId) />`
  - `<LossReasonDialog open reasons onCancel onConfirm({ lossReasonId, lossNote }) />`
  - Na página: `openDeal(dealId)` (estado `drawerDealId`, usado na Task 6), `lossReasons` (lista carregada uma vez).

- [ ] **Step 1: DealCard**

`src/pages/Funnel/DealCard.js`:

```js
import React from "react";
import clsx from "clsx";
import { makeStyles } from "@material-ui/core/styles";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatMoney, daysInStage, daysLabel } from "./format";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    card: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      width: "100%",
      textAlign: "left",
      padding: "10px 12px",
      border: `1px solid ${t.border}`,
      borderRadius: theme.radii.card,
      backgroundColor: t.surface,
      color: t.textPrimary,
      cursor: "grab",
      font: "inherit",
      touchAction: "manipulation",
      "&:hover": { borderColor: t.borderStrong },
      "&:focus-visible": { outline: `2px solid ${t.brand}`, outlineOffset: 2 },
    },
    dragging: { opacity: 0.4 },
    overlay: { cursor: "grabbing", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)" },
    title: { fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    value: { fontSize: 13, fontWeight: 600, color: t.textSecondary },
    meta: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: t.textTertiary, flexWrap: "wrap" },
    unread: {
      marginLeft: "auto",
      minWidth: 20,
      height: 20,
      padding: "0 6px",
      borderRadius: 10,
      backgroundColor: t.brand,
      color: t.onBrand,
      fontSize: 11,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    },
  };
});

export const DealCardView = React.forwardRef(({ deal, overlay, dragging, ...rest }, ref) => {
  const classes = useStyles();
  const days = daysInStage(deal.stageEnteredAt);
  const owner = deal.user ? deal.user.name : "Sem responsável";
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(classes.card, dragging && classes.dragging, overlay && classes.overlay)}
      aria-label={`${deal.title}, ${formatMoney(deal.value)}, ${owner}, ${daysLabel(days)} na coluna`}
      {...rest}
    >
      <span className={classes.title}>{deal.title}</span>
      <span className={classes.value}>{formatMoney(deal.value)}</span>
      <span className={classes.meta}>
        <span>{owner}</span>
        <span aria-hidden="true">·</span>
        <span>{daysLabel(days)}</span>
        {deal.unread > 0 && (
          <span className={classes.unread} aria-label={`${deal.unread} mensagens não lidas`}>{deal.unread}</span>
        )}
      </span>
    </button>
  );
});

const DealCard = ({ deal, onOpen }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `deal-${deal.id}`,
    data: { type: "deal", dealId: deal.id, stageId: deal.stageId },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li style={{ listStyle: "none", ...style }}>
      <DealCardView
        ref={setNodeRef}
        deal={deal}
        dragging={isDragging}
        {...attributes}
        {...listeners}
        onClick={() => onOpen(deal.id)}
        onKeyDown={(e) => {
          // Space is the drag key (keyboard sensor); Enter opens the deal.
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen(deal.id);
            return;
          }
          if (listeners && listeners.onKeyDown) listeners.onKeyDown(e);
        }}
      />
    </li>
  );
};

export default DealCard;
```

- [ ] **Step 2: Column**

`src/pages/Funnel/Column.js`:

```js
import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import { makeStyles } from "@material-ui/core/styles";
import CircularProgress from "@material-ui/core/CircularProgress";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import DealCard from "./DealCard";
import { formatMoney } from "./format";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    column: {
      flex: "0 0 280px",
      width: 280,
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      backgroundColor: t.surfaceMuted,
      border: `1px solid ${t.border}`,
      borderRadius: theme.radii.panel,
    },
    collapsed: { flex: "0 0 56px", width: 56 },
    over: { borderColor: t.brand, boxShadow: `0 0 0 1px ${t.brand}` },
    header: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 12px",
      borderBottom: `1px solid ${t.divider}`,
      background: "none",
      border: "none",
      width: "100%",
      textAlign: "left",
      font: "inherit",
      color: t.textPrimary,
    },
    toggle: { cursor: "pointer" },
    dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
    name: { fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sum: { fontSize: 12, color: t.textTertiary, whiteSpace: "nowrap" },
    verticalName: { writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 13, fontWeight: 700, padding: "12px 0" },
    list: {
      flex: 1,
      minHeight: 80,
      overflowY: "auto",
      margin: 0,
      padding: 8,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      ...theme.scrollbarStylesSoft,
    },
    more: { display: "flex", justifyContent: "center", padding: 8 },
    empty: { fontSize: 12, color: t.textTertiary, textAlign: "center", padding: "16px 8px" },
  };
});

const Column = ({ stage, column, collapsible, collapsed, onToggle, onOpen, onLoadMore }) => {
  const classes = useStyles();
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}`, data: { type: "stage", stageId: stage.id } });
  const sentinel = useRef(null);
  const deals = column ? column.deals : [];
  const loading = useRef(false);

  // Loads the next page when the end of the list scrolls into view.
  useEffect(() => {
    if (collapsed || !column || !column.hasMore || !sentinel.current) return undefined;
    const observer = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting && !loading.current) {
        loading.current = true;
        await onLoadMore(stage.id);
        loading.current = false;
      }
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [collapsed, column, onLoadMore, stage.id]);

  const header = (
    <>
      <span className={classes.dot} style={{ backgroundColor: stage.color }} aria-hidden="true" />
      <span className={classes.name}>{stage.name}</span>
      <span className={classes.sum}>
        {column ? column.count : 0} · {formatMoney(column ? column.total : 0)}
      </span>
    </>
  );

  if (collapsed) {
    return (
      <section ref={setNodeRef} className={clsx(classes.column, classes.collapsed, isOver && classes.over)} aria-label={stage.name}>
        <button
          type="button"
          className={clsx(classes.header, classes.toggle)}
          style={{ flexDirection: "column" }}
          onClick={() => onToggle(stage.id)}
          aria-expanded="false"
          aria-label={`Mostrar ${stage.name} (${column ? column.count : 0})`}
        >
          <span className={classes.dot} style={{ backgroundColor: stage.color }} aria-hidden="true" />
          <span className={classes.verticalName}>{stage.name} · {column ? column.count : 0}</span>
        </button>
      </section>
    );
  }

  return (
    <section ref={setNodeRef} className={clsx(classes.column, isOver && classes.over)} aria-label={stage.name}>
      {collapsible ? (
        <button
          type="button"
          className={clsx(classes.header, classes.toggle)}
          onClick={() => onToggle(stage.id)}
          aria-expanded="true"
        >
          {header}
        </button>
      ) : (
        <div className={classes.header}>{header}</div>
      )}
      <SortableContext items={deals.map((d) => `deal-${d.id}`)} strategy={verticalListSortingStrategy}>
        <ul className={classes.list}>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onOpen={onOpen} />
          ))}
          {deals.length === 0 && <li className={classes.empty} style={{ listStyle: "none" }}>Arraste negócios para cá</li>}
          {column && column.hasMore && (
            <li ref={sentinel} className={classes.more} style={{ listStyle: "none" }}>
              <CircularProgress size={18} />
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
};

export default Column;
```

- [ ] **Step 3: Board**

`src/pages/Funnel/Board.js`:

```js
import React, { useRef, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor,
  closestCorners, useSensor, useSensors
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import Column from "./Column";
import { DealCardView } from "./DealCard";
import { findCard, moveCard, neighbours } from "./boardState";

const useStyles = makeStyles((theme) => ({
  board: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    gap: 12,
    overflowX: "auto",
    paddingBottom: 8,
    alignItems: "stretch",
    ...theme.scrollbarStylesSoft,
  },
}));

const dealIdOf = (id) => Number(String(id).replace("deal-", ""));

// Where a drop target sits: a stage column or a card inside one.
const targetOf = (columns, over) => {
  if (!over) return null;
  const data = over.data.current || {};
  if (data.type === "stage") {
    const col = columns[data.stageId];
    return { stageId: data.stageId, index: col ? col.deals.length : 0 };
  }
  if (data.type === "deal") {
    const found = findCard(columns, data.dealId);
    return found ? { stageId: found.stageId, index: found.index } : null;
  }
  return null;
};

const Board = ({ stages, columns, expanded, onToggle, onPreview, onMove, onCancel, onOpen, onLoadMore }) => {
  const classes = useStyles();
  const [activeId, setActiveId] = useState(null);
  const snapshot = useRef(null);
  const origin = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    })
  );

  const handleDragStart = ({ active }) => {
    const dealId = dealIdOf(active.id);
    snapshot.current = columns;
    origin.current = findCard(columns, dealId);
    setActiveId(dealId);
  };

  // Moves the card between columns while hovering, so the target list makes room.
  const handleDragOver = ({ active, over }) => {
    const dealId = dealIdOf(active.id);
    const target = targetOf(columns, over);
    const current = findCard(columns, dealId);
    if (!target || !current || target.stageId === current.stageId) return;
    onPreview(moveCard(columns, dealId, target.stageId, target.index));
  };

  const handleDragEnd = ({ active, over }) => {
    const dealId = dealIdOf(active.id);
    const start = origin.current;
    const before = snapshot.current;
    setActiveId(null);
    snapshot.current = null;
    origin.current = null;
    const target = targetOf(columns, over);
    if (!target || !start) {
      onCancel(before);
      return;
    }
    const next = moveCard(columns, dealId, target.stageId, target.index);
    const place = findCard(next, dealId);
    if (place.stageId === start.stageId && place.index === start.index) {
      onCancel(before);
      return;
    }
    onPreview(next);
    onMove({
      dealId,
      fromStageId: start.stageId,
      toStageId: place.stageId,
      ...neighbours(next, place.stageId, dealId),
      snapshot: before,
    });
  };

  const handleDragCancel = () => {
    const before = snapshot.current;
    setActiveId(null);
    snapshot.current = null;
    origin.current = null;
    onCancel(before);
  };

  const active = activeId ? findCard(columns, activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={classes.board}>
        {stages.map((stage) => {
          const closed = stage.kind !== "open";
          return (
            <Column
              key={stage.id}
              stage={stage}
              column={columns[stage.id]}
              collapsible={closed}
              collapsed={closed && !expanded[stage.id]}
              onToggle={onToggle}
              onOpen={onOpen}
              onLoadMore={onLoadMore}
            />
          );
        })}
      </div>
      <DragOverlay>{active ? <DealCardView deal={active.card} overlay /> : null}</DragOverlay>
    </DndContext>
  );
};

export default Board;
```

- [ ] **Step 4: LossReasonDialog**

`src/pages/Funnel/LossReasonDialog.js`:

```js
import React, { useEffect, useState } from "react";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import Button from "@material-ui/core/Button";
import Radio from "@material-ui/core/Radio";
import RadioGroup from "@material-ui/core/RadioGroup";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import TextField from "@material-ui/core/TextField";

const LossReasonDialog = ({ open, reasons, onCancel, onConfirm }) => {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReasonId("");
      setNote("");
    }
  }, [open]);

  const active = (reasons || []).filter((r) => r.active);

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="loss-reason-title">
      <DialogTitle id="loss-reason-title">Por que o negócio foi perdido?</DialogTitle>
      <DialogContent>
        <RadioGroup value={String(reasonId)} onChange={(e) => setReasonId(Number(e.target.value))}>
          {active.map((r) => (
            <FormControlLabel key={r.id} value={String(r.id)} control={<Radio color="primary" />} label={r.name} />
          ))}
        </RadioGroup>
        <TextField
          fullWidth
          margin="dense"
          variant="outlined"
          label="Detalhe (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          inputProps={{ maxLength: 255 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          color="primary"
          variant="contained"
          disabled={!reasonId}
          onClick={() => onConfirm({ lossReasonId: reasonId, lossNote: note.trim() || null })}
        >
          Marcar como perdido
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LossReasonDialog;
```

- [ ] **Step 5: Ligar o quadro na página**

Em `src/pages/Funnel/index.js`:

Imports adicionais:

```js
import Board from "./Board";
import LossReasonDialog from "./LossReasonDialog";
import { appendPage, upsertCard } from "./boardState";
```

(junte `appendPage, upsertCard` ao import existente de `./boardState`.)

Estado adicional, depois de `const [users, setUsers] = useState([]);`:

```js
  const [expanded, setExpanded] = useState({});
  const [lossReasons, setLossReasons] = useState([]);
  const [pendingLoss, setPendingLoss] = useState(null);
  const [drawerDealId, setDrawerDealId] = useState(null);
```

Depois do `useEffect` que carrega usuários:

```js
  useEffect(() => {
    api.get("/crm/loss-reasons").then(({ data }) => setLossReasons(data)).catch(() => setLossReasons([]));
  }, []);

  const sendMove = async ({ dealId, toStageId, beforeId, afterId, snapshot, lossReasonId, lossNote }) => {
    try {
      const { data } = await api.put(`/crm/deals/${dealId}/move`, {
        stageId: toStageId,
        beforeId,
        afterId,
        lossReasonId,
        lossNote,
      });
      setColumns((cols) => upsertCard(cols, data));
    } catch (err) {
      toastError(err);
      if (snapshot) setColumns(snapshot);
    }
  };

  const handleMove = (move) => {
    const target = funnel.stages.find((s) => s.id === move.toStageId);
    if (target && target.kind === "lost" && move.fromStageId !== move.toStageId) {
      setPendingLoss(move);
      return;
    }
    sendMove(move);
  };

  const loadMore = useCallback(
    async (stageId) => {
      const page = (columns[stageId] ? columns[stageId].page : 0) + 1;
      try {
        const { data } = await api.get(`/crm/funnels/${funnelId}/deals`, {
          params: {
            stageId,
            page,
            search: filters.search || undefined,
            userId: filters.userId || undefined,
            source: filters.source || undefined,
          },
        });
        setColumns((cols) => appendPage(cols, stageId, data));
      } catch (err) {
        toastError(err);
      }
    },
    [columns, funnelId, filters]
  );
```

Trocar o bloco do placeholder (`{/* Task 3: ... */}` até o `)}` do `<pre>`) por:

```js
      {loadingBoard && Object.keys(columns).length === 0 ? (
        <div className={classes.loading}><CircularProgress /></div>
      ) : (
        funnel && (
          <Board
            stages={funnel.stages}
            columns={columns}
            expanded={expanded}
            onToggle={(stageId) => setExpanded((e) => ({ ...e, [stageId]: !e[stageId] }))}
            onPreview={setColumns}
            onCancel={(snapshot) => snapshot && setColumns(snapshot)}
            onMove={handleMove}
            onOpen={setDrawerDealId}
            onLoadMore={loadMore}
          />
        )
      )}
      <LossReasonDialog
        open={Boolean(pendingLoss)}
        reasons={lossReasons}
        onCancel={() => {
          if (pendingLoss && pendingLoss.snapshot) setColumns(pendingLoss.snapshot);
          setPendingLoss(null);
        }}
        onConfirm={(reason) => {
          const move = pendingLoss;
          setPendingLoss(null);
          sendMove({ ...move, ...reason });
        }}
      />
      {/* Task 6: <DealDrawer /> goes here. */}
```

- [ ] **Step 6: Conferir no navegador (HM)**

Criar dois negócios pelo `scripts/crm-smoke.sh` não serve (arquiva o funil); crie pela API com o token do smoke:
`curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" http://localhost:3001/crm/deals -d '{"funnelId":<id do Vendas>,"contactId":11,"value":2400}'` (duas vezes).

1. `/funil` mostra as colunas Lead…Negociação abertas e Ganho/Perdido recolhidas; Lead mostra `2 · R$ 4.800,00`.
2. Teclado: Tab até o primeiro card, Espaço, seta para a direita, Espaço → card em Qualificação; recarregar a página → continua lá.
3. Teclado para Perdido (expandir antes clicando no título recolhido): soltar abre "Por que o negócio foi perdido?"; Cancelar → card volta para a coluna de origem; repetir e escolher "Preço" → fica em Perdido.
4. Esc no meio de um arrasto → card volta.

Run: `npx eslint src/pages/Funnel`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Funnel/Board.js src/pages/Funnel/Column.js src/pages/Funnel/DealCard.js src/pages/Funnel/LossReasonDialog.js src/pages/Funnel/index.js
git commit -m "Adiciona o quadro do funil com arrastar, motivo de perda e paginação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tempo real

**Files:**
- Modify: `src/pages/Funnel/index.js` (no ponto `// Task 4:`)

**Interfaces:**
- Consumes: `socketConnection` (`services/socket`), `cardFromDeal`, `upsertCard`, `removeCard`, `setUnread` (Task 1), `GET /crm/deals/:id`.
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Teste do caso "saiu da visão" (puro)**

O tratamento usa funções já testadas na Task 1 (`removeCard`, `upsertCard` para card de outro funil). Acrescentar ao `boardState.test.js` o caso do evento de outro funil, que deve sumir do quadro:

```js
describe("realtime: deal moved to another funnel", () => {
  it("drops it from this board when its stage is not here", () => {
    const c = upsertCard(base(), { ...card(10, 1, 1024), funnelId: 2, stageId: 500 });
    expect(findCard(c, 10)).toBeNull();
  });
});
```

Run: `CI=true npx react-scripts test --watchAll=false src/pages/Funnel`
Expected: PASS (comportamento já coberto por `upsertCard`; o teste fixa o contrato usado pelo tempo real).

- [ ] **Step 2: Implementar os ouvintes**

Imports adicionais em `index.js`: `import { socketConnection } from "../../services/socket";` e `cardFromDeal, removeCard, setUnread, findCard` no import de `./boardState`.

No ponto `// Task 4: realtime listeners go here.`:

```js
  const funnelRef = React.useRef(funnelId);
  funnelRef.current = funnelId;
  const columnsRef = React.useRef(columns);
  columnsRef.current = columns;

  const refreshDeal = useCallback(async (dealId) => {
    try {
      const { data } = await api.get(`/crm/deals/${dealId}`);
      const deal = data.deal;
      if (deal.funnelId !== funnelRef.current) {
        setColumns((cols) => removeCard(cols, dealId));
        return;
      }
      setColumns((cols) => {
        const current = Object.values(cols).flatMap((c) => c.deals).find((d) => d.id === dealId);
        return upsertCard(cols, cardFromDeal(deal, current ? current.unread : 0));
      });
    } catch (err) {
      // 404: the deal left this user's view.
      if (err && err.response && err.response.status === 404) {
        setColumns((cols) => removeCard(cols, dealId));
      }
    }
  }, []);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketConnection({ companyId });
    socket.on("connect", () => {
      ["open", "pending"].forEach((s) => socket.emit("joinTickets", s));
      socket.emit("joinNotification");
    });
    socket.on(`company-${companyId}-deal`, (data) => {
      // A deal on this board may have moved to another funnel; refetch decides.
      if (data.funnelId === funnelRef.current || findCard(columnsRef.current, data.dealId)) refreshDeal(data.dealId);
    });
    socket.on(`company-${companyId}-funnel`, () => {
      reloadFunnels();
      reloadBoard();
    });
    socket.on(`company-${companyId}-appMessage`, (data) => {
      if (data.action === "create" && data.ticket && data.ticket.contactId) {
        setColumns((cols) => setUnread(cols, data.ticket.contactId, data.ticket.unreadMessages || 0));
      }
    });
    socket.on(`company-${companyId}-ticket`, (data) => {
      if (data.action === "update" && data.ticket && data.ticket.contactId) {
        setColumns((cols) => setUnread(cols, data.ticket.contactId, data.ticket.unreadMessages || 0));
      }
    });
    return () => socket.disconnect();
  }, [refreshDeal, reloadFunnels, reloadBoard]);
```

Nota: o filtro também considera negócios que estão no quadro, porque um negócio pode ter saído deste funil (o evento traz o funil novo); `refreshDeal` decide se remove. Eventos de outros funis que não tocam este quadro são ignorados.

- [ ] **Step 3: Conferir no navegador (HM)**

Duas abas em `/funil` no mesmo funil. Mover um card na aba A → aparece na nova coluna na aba B em até 1 s, sem recarregar. Pela API, `PUT /crm/deals/:id` mudando `value` → o valor e a soma da coluna mudam na aba B.

Run: `npx eslint src/pages/Funnel && CI=true npx react-scripts test --watchAll=false src/pages/Funnel`
Expected: sem erros; testes passam.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Funnel/index.js src/pages/Funnel/boardState.test.js
git commit -m "Atualiza o funil em tempo real e mostra mensagens não lidas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Criar negócio

**Files:**
- Create: `src/pages/Funnel/NewDealDialog.js`
- Modify: `src/pages/Funnel/index.js` (botão "+ Negócio" e diálogo)

**Interfaces:**
- Consumes: `GET /contacts?searchParam`, `POST /crm/deals`, `parseMoneyInput` (Task 1).
- Produces: `<NewDealDialog open funnels defaultFunnelId users currentUserId initialContact onClose(card | null) />` — usado de novo no passo 3 do CRM (conversa do atendimento) com `initialContact`.

- [ ] **Step 1: NewDealDialog**

`src/pages/Funnel/NewDealDialog.js`:

```js
import React, { useEffect, useState } from "react";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";
import Grid from "@material-ui/core/Grid";
import CircularProgress from "@material-ui/core/CircularProgress";
import Autocomplete from "@material-ui/lab/Autocomplete";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { parseMoneyInput } from "./format";

const NewDealDialog = ({ open, funnels, defaultFunnelId, users, currentUserId, initialContact, onClose }) => {
  const [contact, setContact] = useState(null);
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [funnelId, setFunnelId] = useState("");
  const [stageId, setStageId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const funnel = funnels.find((f) => f.id === defaultFunnelId) || funnels[0];
    setFunnelId(funnel ? funnel.id : "");
    const firstOpen = funnel ? funnel.stages.find((s) => s.kind === "open") : null;
    setStageId(firstOpen ? firstOpen.id : "");
    setContact(initialContact || null);
    setOptions(initialContact ? [initialContact] : []);
    setTitle("");
    setValue("");
    setUserId(currentUserId || "");
  }, [open, funnels, defaultFunnelId, initialContact, currentUserId]);

  useEffect(() => {
    if (!open || search.trim().length < 3) return undefined;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/contacts", { params: { searchParam: search.trim() } });
        setOptions(data.contacts.filter((c) => !c.isGroup));
      } catch (err) {
        toastError(err);
      }
      setSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [open, search]);

  const funnel = funnels.find((f) => f.id === funnelId);
  const openStages = funnel ? funnel.stages.filter((s) => s.kind === "open") : [];
  const parsedValue = parseMoneyInput(value);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/crm/deals", {
        funnelId,
        stageId,
        contactId: contact.id,
        title: title.trim() || undefined,
        value: parsedValue,
        userId: userId === "" ? null : userId,
      });
      onClose(data);
    } catch (err) {
      toastError(err);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={() => onClose(null)} maxWidth="sm" fullWidth aria-labelledby="new-deal-title">
      <DialogTitle id="new-deal-title">Novo negócio</DialogTitle>
      <DialogContent>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Autocomplete
              options={options}
              value={contact}
              disabled={Boolean(initialContact)}
              getOptionLabel={(o) => (o ? `${o.name} · ${o.number}` : "")}
              getOptionSelected={(o, v) => o.id === v.id}
              filterOptions={(x) => x}
              onChange={(e, v) => setContact(v)}
              onInputChange={(e, v) => setSearch(v)}
              noOptionsText={search.trim().length < 3 ? "Digite ao menos 3 letras" : "Nenhum contato"}
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus={!initialContact}
                  label="Contato"
                  variant="outlined"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searching && <CircularProgress size={18} />}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select fullWidth variant="outlined" label="Funil" value={funnelId}
              onChange={(e) => {
                const next = funnels.find((f) => f.id === Number(e.target.value));
                setFunnelId(next.id);
                const first = next.stages.find((s) => s.kind === "open");
                setStageId(first ? first.id : "");
              }}
            >
              {funnels.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField select fullWidth variant="outlined" label="Coluna" value={stageId} onChange={(e) => setStageId(Number(e.target.value))}>
              {openStages.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth variant="outlined" label="Título (opcional)" placeholder="Padrão: nome do contato"
              value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 255 }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth variant="outlined" label="Valor (R$)" value={value} onChange={(e) => setValue(e.target.value)}
              error={parsedValue === null || parsedValue < 0}
              helperText={parsedValue === null || parsedValue < 0 ? "Valor inválido" : " "}
              inputProps={{ inputMode: "decimal" }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField select fullWidth variant="outlined" label="Responsável" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <MenuItem value="">Sem responsável</MenuItem>
              {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
            </TextField>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(null)}>Cancelar</Button>
        <Button
          color="primary"
          variant="contained"
          onClick={submit}
          disabled={saving || !contact || !stageId || parsedValue === null || parsedValue < 0}
        >
          Criar negócio
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewDealDialog;
```

- [ ] **Step 2: Ligar na página**

Em `index.js`: `import AddButton from "../../components/AddButton";`, `import NewDealDialog from "./NewDealDialog";`; estado `const [newDealOpen, setNewDealOpen] = useState(false);`; no ponto `{/* Task 5: ... */}`:

```js
            <AddButton onClick={() => setNewDealOpen(true)} description="Novo negócio" />
```

e junto dos diálogos (antes do comentário da Task 6):

```js
      <NewDealDialog
        open={newDealOpen}
        funnels={funnels}
        defaultFunnelId={funnelId}
        users={users}
        currentUserId={user.id}
        onClose={(card) => {
          setNewDealOpen(false);
          if (card && card.funnelId === funnelId) setColumns((cols) => upsertCard(cols, card));
        }}
      />
```

- [ ] **Step 3: Conferir no navegador (HM)**

"+" → digitar 3 letras de um contato → escolher → valor "1.200,50" → Criar: card no topo de Lead com `R$ 1.200,50`; soma da coluna atualizada. Valor "abc" desabilita o botão. Conferir `AddButton` aceita `description` (é o padrão usado em `pages/AiAgents`).

Run: `npx eslint src/pages/Funnel`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Funnel/NewDealDialog.js src/pages/Funnel/index.js
git commit -m "Adiciona a criação de negócio no funil

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gaveta do negócio (dados, histórico, ações e conversa)

**Files:**
- Create: `src/pages/Funnel/DealDrawer/index.js`, `DealForm.js`, `History.js`, `ChatPanel.js`
- Modify: `src/pages/Funnel/index.js` (no ponto `{/* Task 6: ... */}`)

**Interfaces:**
- Consumes: `GET /crm/deals/:id` (`{ deal, events, ticket }`), `PUT /crm/deals/:id`, `PUT /crm/deals/:id/move`, `GET /tickets/u/:uuid`, `PUT /tickets/:id`, `MessagesList`, `MessageInputCustom`, `ReplyMessageProvider`, `NewTicketModal`, `LossReasonDialog` (Task 3), `cardFromDeal` (Task 1), `parseMoneyInput`, `formatMoney`, `eventLabel`, `SOURCE_OPTIONS` (Task 1).
- Produces: `<DealDrawer dealId funnels users lossReasons onClose onChanged(card) />`.

- [ ] **Step 1: History**

`src/pages/Funnel/DealDrawer/History.js`:

```js
import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { eventLabel } from "../format";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
    item: { display: "flex", flexDirection: "column", gap: 2, paddingLeft: 12, borderLeft: `2px solid ${t.divider}` },
    text: { fontSize: 13, color: t.textPrimary },
    meta: { fontSize: 12, color: t.textTertiary },
  };
});

const when = (date) =>
  new Date(date).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const History = ({ events, stagesById, reasonsById, usersById }) => {
  const classes = useStyles();
  if (!events.length) return null;
  return (
    <ul className={classes.list} aria-label="Histórico">
      {events.map((e) => (
        <li key={e.id} className={classes.item}>
          <span className={classes.text}>{eventLabel(e, { stagesById, reasonsById, usersById })}</span>
          <span className={classes.meta}>{e.user ? e.user.name : "Automático"} · {when(e.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
};

export default History;
```

- [ ] **Step 2: DealForm**

`src/pages/Funnel/DealDrawer/DealForm.js`:

```js
import React, { useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";
import Button from "@material-ui/core/Button";
import api from "../../../services/api";
import toastError from "../../../errors/toastError";
import { SOURCE_OPTIONS, parseMoneyInput, formatMoney } from "../format";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    form: { display: "flex", flexDirection: "column", gap: 14 },
    row: { display: "flex", gap: 12, "& > *": { flex: 1 } },
    actions: { display: "flex", gap: 8, flexWrap: "wrap" },
    status: { fontSize: 13, color: t.textSecondary },
  };
});

const fieldsOf = (deal) => ({
  title: deal.title || "",
  value: formatMoney(deal.value).replace("R$ ", ""),
  userId: deal.userId || "",
  expectedCloseDate: deal.expectedCloseDate || "",
  source: deal.source || "",
  notes: deal.notes || "",
});

const DealForm = ({ deal, funnels, users, onSaved, onMove, onLose }) => {
  const classes = useStyles();
  const [fields, setFields] = useState(fieldsOf(deal));

  useEffect(() => setFields(fieldsOf(deal)), [deal]);

  const save = async (name, raw) => {
    let value = raw;
    if (name === "value") {
      value = parseMoneyInput(raw);
      if (value === null) {
        toastError({ response: { data: { error: "ERR_CRM_INVALID_VALUE" } } });
        setFields(fieldsOf(deal));
        return;
      }
    }
    if (name === "userId") value = raw === "" ? null : raw;
    if (name === "title" && !String(raw).trim()) {
      setFields(fieldsOf(deal));
      return;
    }
    const before = name === "value" ? Number(deal.value) : deal[name] ?? (name === "userId" ? null : "");
    if (before === value || (before === null && value === "")) return;
    try {
      const { data } = await api.put(`/crm/deals/${deal.id}`, { [name]: value });
      onSaved(data);
    } catch (err) {
      toastError(err);
      setFields(fieldsOf(deal));
    }
  };

  const bind = (name) => ({
    value: fields[name],
    onChange: (e) => setFields((f) => ({ ...f, [name]: e.target.value })),
    onBlur: (e) => save(name, e.target.value),
  });

  const funnel = funnels.find((f) => f.id === deal.funnelId);
  const stages = funnel ? funnel.stages : [];
  const won = stages.find((s) => s.kind === "won");
  const firstOpen = stages.find((s) => s.kind === "open");
  const otherFunnels = funnels.filter((f) => f.id !== deal.funnelId);

  return (
    <div className={classes.form}>
      <div className={classes.actions}>
        {deal.status === "open" ? (
          <>
            <Button variant="outlined" color="primary" disabled={!won} onClick={() => onMove({ stageId: won.id })}>
              Marcar como ganho
            </Button>
            <Button variant="outlined" onClick={onLose}>Marcar como perdido</Button>
          </>
        ) : (
          <>
            <span className={classes.status}>{deal.status === "won" ? "Negócio ganho." : "Negócio perdido."}</span>
            <Button variant="outlined" color="primary" disabled={!firstOpen} onClick={() => onMove({ stageId: firstOpen.id })}>
              Reabrir
            </Button>
          </>
        )}
      </div>
      <TextField variant="outlined" label="Título" {...bind("title")} inputProps={{ maxLength: 255 }} />
      <div className={classes.row}>
        <TextField variant="outlined" label="Valor (R$)" {...bind("value")} inputProps={{ inputMode: "decimal" }} />
        <TextField
          select variant="outlined" label="Responsável" value={fields.userId}
          onChange={(e) => {
            setFields((f) => ({ ...f, userId: e.target.value }));
            save("userId", e.target.value);
          }}
        >
          <MenuItem value="">Sem responsável</MenuItem>
          {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
        </TextField>
      </div>
      <div className={classes.row}>
        <TextField
          variant="outlined" type="date" label="Previsão de fechamento" InputLabelProps={{ shrink: true }}
          {...bind("expectedCloseDate")}
        />
        <TextField
          select variant="outlined" label="Origem" value={fields.source}
          onChange={(e) => {
            setFields((f) => ({ ...f, source: e.target.value }));
            save("source", e.target.value);
          }}
        >
          <MenuItem value="">Não informada</MenuItem>
          {SOURCE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
      </div>
      <TextField variant="outlined" label="Observações" multiline minRows={3} {...bind("notes")} />
      {otherFunnels.length > 0 && (
        <TextField
          select variant="outlined" label="Mover para outro funil" value=""
          onChange={(e) => {
            const target = funnels.find((f) => f.id === Number(e.target.value));
            const first = target && target.stages.find((s) => s.kind === "open");
            if (first) onMove({ stageId: first.id });
          }}
        >
          {otherFunnels.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
        </TextField>
      )}
    </div>
  );
};

export default DealForm;
```

Nota: confira se o `TextField` do MUI 4.12 aceita `minRows` (sim a partir de 4.12; em versões antigas era `rows`). O projeto usa `@material-ui/core 4.12.3`.

- [ ] **Step 3: ChatPanel**

`src/pages/Funnel/DealDrawer/ChatPanel.js`:

```js
import React, { useContext, useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import CircularProgress from "@material-ui/core/CircularProgress";
import api from "../../../services/api";
import toastError from "../../../errors/toastError";
import { AuthContext } from "../../../context/Auth/AuthContext";
import { ReplyMessageProvider } from "../../../context/ReplyingMessage/ReplyingMessageContext";
import MessagesList from "../../../components/MessagesList";
import MessageInput from "../../../components/MessageInputCustom";
import NewTicketModal from "../../../components/NewTicketModal";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    root: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
    notice: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "8px 12px",
      fontSize: 13,
      color: t.textSecondary,
      backgroundColor: t.surfaceMuted,
      borderBottom: `1px solid ${t.divider}`,
    },
    center: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", color: t.textSecondary },
  };
});

// The contact's latest ticket, with the same rules as the tickets screen:
// only an open ticket can send messages.
const ChatPanel = ({ ticketRef, contact, onTicketChanged }) => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(Boolean(ticketRef));
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  useEffect(() => {
    if (!ticketRef) {
      setTicket(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .get(`/tickets/u/${ticketRef.uuid}`)
      .then(({ data }) => active && setTicket(data))
      .catch((err) => active && toastError(err))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [ticketRef]);

  const takeOver = async () => {
    try {
      const { data } = await api.put(`/tickets/${ticket.id}`, { status: "open", userId: user.id });
      setTicket((t) => ({ ...t, ...data, status: "open" }));
    } catch (err) {
      toastError(err);
    }
  };

  if (loading) {
    return <div className={classes.center}><CircularProgress /></div>;
  }

  if (!ticket) {
    return (
      <div className={classes.center}>
        <span>Ainda não há conversa com este contato.</span>
        <Button variant="contained" color="primary" onClick={() => setNewTicketOpen(true)}>Iniciar conversa</Button>
        <NewTicketModal
          modalOpen={newTicketOpen}
          initialContact={contact}
          onClose={(created) => {
            setNewTicketOpen(false);
            if (created) onTicketChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div className={classes.root}>
      {ticket.status !== "open" && (
        <div className={classes.notice}>
          <span>{ticket.status === "pending" ? "Atendimento aguardando." : "Atendimento finalizado."}</span>
          <Button size="small" variant="contained" color="primary" onClick={takeOver}>
            {ticket.status === "pending" ? "Aceitar" : "Reabrir"}
          </Button>
        </div>
      )}
      <ReplyMessageProvider>
        <MessagesList ticket={ticket} ticketId={ticket.id} isGroup={ticket.isGroup} />
        <MessageInput ticketId={ticket.id} ticketStatus={ticket.status} isGroup={ticket.isGroup} />
      </ReplyMessageProvider>
    </div>
  );
};

export default ChatPanel;
```

- [ ] **Step 4: DealDrawer**

`src/pages/Funnel/DealDrawer/index.js`:

```js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { makeStyles } from "@material-ui/core/styles";
import Drawer from "@material-ui/core/Drawer";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import IconButton from "@material-ui/core/IconButton";
import CircularProgress from "@material-ui/core/CircularProgress";
import CloseIcon from "@material-ui/icons/Close";
import api from "../../../services/api";
import toastError from "../../../errors/toastError";
import LossReasonDialog from "../LossReasonDialog";
import { formatMoney } from "../format";
import DealForm from "./DealForm";
import History from "./History";
import ChatPanel from "./ChatPanel";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    paper: { width: 480, maxWidth: "100vw", display: "flex", flexDirection: "column", backgroundColor: t.surface },
    header: { display: "flex", alignItems: "flex-start", gap: 8, padding: "14px 16px 6px" },
    titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
    title: { margin: 0, fontSize: 17, fontWeight: 700, color: t.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sub: { fontSize: 13, color: t.textSecondary },
    link: { fontSize: 12, color: t.brand },
    body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20, ...theme.scrollbarStylesSoft },
    chat: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
    sectionLabel: { margin: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: t.textTertiary },
    center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  };
});

const DealDrawer = ({ dealId, funnels, users, lossReasons, onClose, onChanged }) => {
  const classes = useStyles();
  const [tab, setTab] = useState(0);
  const [detail, setDetail] = useState(null);
  const [losing, setLosing] = useState(false);

  const load = useCallback(async () => {
    if (!dealId) return;
    try {
      const { data } = await api.get(`/crm/deals/${dealId}`);
      setDetail(data);
    } catch (err) {
      toastError(err);
      onClose();
    }
  }, [dealId, onClose]);

  useEffect(() => {
    setDetail(null);
    setTab(0);
    load();
  }, [load]);

  const stagesById = useMemo(
    () => Object.fromEntries(funnels.flatMap((f) => f.stages).map((s) => [s.id, s])),
    [funnels]
  );
  const reasonsById = useMemo(() => Object.fromEntries(lossReasons.map((r) => [r.id, r])), [lossReasons]);
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const afterChange = (card) => {
    onChanged(card);
    load();
  };

  const move = async (body) => {
    try {
      const { data } = await api.put(`/crm/deals/${dealId}/move`, body);
      afterChange(data);
    } catch (err) {
      toastError(err);
    }
  };

  const deal = detail && detail.deal;
  const stage = deal && stagesById[deal.stageId];

  return (
    <Drawer anchor="right" open={Boolean(dealId)} onClose={onClose} classes={{ paper: classes.paper }}>
      {!deal ? (
        <div className={classes.center}><CircularProgress /></div>
      ) : (
        <>
          <div className={classes.header}>
            <div className={classes.titles}>
              <h2 className={classes.title}>{deal.title}</h2>
              <span className={classes.sub}>
                {deal.contact ? deal.contact.name : ""} · {formatMoney(deal.value)} · {stage ? stage.name : ""}
              </span>
              {detail.ticket && (
                <RouterLink className={classes.link} to={`/tickets/${detail.ticket.uuid}`}>Abrir atendimento completo</RouterLink>
              )}
            </div>
            <IconButton aria-label="Fechar" onClick={onClose}><CloseIcon /></IconButton>
          </div>
          <Tabs value={tab} onChange={(e, v) => setTab(v)} indicatorColor="primary" textColor="primary" variant="fullWidth">
            <Tab label="Conversa" />
            <Tab label="Dados" />
          </Tabs>
          {tab === 0 ? (
            <div className={classes.chat}>
              <ChatPanel ticketRef={detail.ticket} contact={deal.contact} onTicketChanged={load} />
            </div>
          ) : (
            <div className={classes.body}>
              <DealForm
                deal={deal}
                funnels={funnels}
                users={users}
                onSaved={afterChange}
                onMove={move}
                onLose={() => setLosing(true)}
              />
              <h3 className={classes.sectionLabel}>Histórico</h3>
              <History events={detail.events} stagesById={stagesById} reasonsById={reasonsById} usersById={usersById} />
            </div>
          )}
          <LossReasonDialog
            open={losing}
            reasons={lossReasons}
            onCancel={() => setLosing(false)}
            onConfirm={(reason) => {
              setLosing(false);
              const funnel = funnels.find((f) => f.id === deal.funnelId);
              const lost = funnel && funnel.stages.find((s) => s.kind === "lost");
              if (lost) move({ stageId: lost.id, ...reason });
            }}
          />
        </>
      )}
    </Drawer>
  );
};

export default DealDrawer;
```

Nota: as rotas de escrita (`PUT`) já devolvem o card pronto, então `afterChange(data)` usa a resposta direto.

- [ ] **Step 5: Ligar na página**

Em `index.js`: `import DealDrawer from "./DealDrawer";`; no ponto `{/* Task 6: ... */}`:

```js
      <DealDrawer
        dealId={drawerDealId}
        funnels={funnels}
        users={users}
        lossReasons={lossReasons}
        onClose={closeDrawer}
        onChanged={(card) =>
          setColumns((cols) => (card.funnelId === funnelId ? upsertCard(cols, card) : removeCard(cols, card.id)))
        }
      />
```

e, perto dos outros callbacks, `const closeDrawer = useCallback(() => setDrawerDealId(null), []);` (estável, porque `DealDrawer.load` depende dele).

- [ ] **Step 6: Conferir no navegador (HM)**

1. Clicar num card → gaveta abre na aba Conversa com as mensagens do contato 11; com ticket pendente, aparece "Aceitar"; aceitar libera a caixa de envio; enviar "teste do funil" chega no WhatsApp do HM (ou aparece na lista como enviada).
2. Aba Dados: mudar o valor para "3.500" e sair do campo → card e soma da coluna mudam; histórico ganha "Editou valor".
3. "Marcar como perdido" → motivo → card vai para Perdido; "Reabrir" → volta para Lead; histórico com "Marcou como perdido: Preço" e "Reabriu o negócio".
4. "Mover para outro funil" (criar um segundo funil "Pós-venda" pela API, com `crmFunnels` 0 ou 2 no HM) → card some do quadro atual.
5. Contato sem ticket (criar negócio para um contato que nunca conversou) → "Ainda não há conversa…" e "Iniciar conversa" abre o modal de novo atendimento com o contato já escolhido.

Run: `npx eslint src/pages/Funnel && CI=true npx react-scripts test --watchAll=false src/pages/Funnel`
Expected: sem erros; testes passam.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Funnel/DealDrawer src/pages/Funnel/index.js
git commit -m "Adiciona a gaveta do negócio com dados, histórico e conversa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Conferência completa no HM e responsividade

**Files:**
- Modify: nenhum, salvo correções encontradas (cada uma com Ruling no ledger e teste quando for lógica pura).

- [ ] **Step 1: Suítes**

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false` e `cd ../whatsapp-api && npx jest --coverage=false`
Expected: todas passam.

- [ ] **Step 2: Roteiro no navegador**

Passar pelos itens da Review Focus, nesta ordem, e registrar o resultado de cada um no ledger:

1. Arrastar e soltar fora das colunas; Esc no meio do arrasto → card volta, nenhuma chamada `PUT .../move` em `read_network_requests`.
2. Com duas abas: na aba A, trocar o responsável de um negócio num funil `ownDealsOnly` (ligar via `PUT /crm/funnels/:id` com `{"ownDealsOnly":true}`) para outro usuário; na aba B logada como vendedor (usuário não admin com fila do funil) → o card some.
3. Coluna com mais de 50 negócios (criar 55 em Lead por um laço com `curl`) → a coluna mostra 50, carrega o resto ao rolar; criar mais um via API com posição alta não aparece no meio da lista.
4. Contato sem ticket e ticket pendente (já conferidos na Task 6).
5. Valor "1.200,50", vazio e "-5" na gaveta.

- [ ] **Step 3: Tema escuro e celular**

`resize_window` com `colorScheme: "dark"`: cores do quadro, cards e gaveta legíveis. `preset: "mobile"`: o quadro rola na horizontal, a gaveta ocupa a largura toda, o cabeçalho de filtros quebra em linhas. Voltar `preset: "desktop"`.

- [ ] **Step 4: Commit das correções (se houver)**

```bash
git add -A src/pages/Funnel
git commit -m "Ajusta o funil após a conferência no HM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Publicação: só com o usuário. Junto com este passo sobem para produção a etapa 1 (migration do CRM, desligado em todos os planos) e o bloqueio do Quadro por plano que já estão na `main` local.
