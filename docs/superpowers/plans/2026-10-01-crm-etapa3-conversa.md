# CRM etapa 3 — Negócio na conversa do atendimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, escolhido pelo usuário nas etapas anteriores). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela do atendimento, mostrar os negócios abertos do contato (selo "coluna · valor") e um botão "Criar negócio"; clicar no selo abre a gaveta do negócio na aba Dados. Tudo escondido quando o plano não tem `useCrm`.

**Architecture:** Um componente novo, `components/TicketDeals`, fica na faixa das etiquetas do atendimento (`components/Ticket/index.js`). Ele reaproveita `NewDealDialog` e `DealDrawer` da etapa 2; a lógica pura (texto do selo, se o ticket pode ter negócio) fica em `dealChips.js` com testes. Sem mudanças no backend: usa `GET /crm/contacts/:contactId/deals`, `GET /crm/funnels`, `GET /crm/loss-reasons`, `GET /users/list` e o evento `company-${companyId}-deal`.

**Tech Stack:** React 17, Material-UI 4, socket.io-client 3, react-scripts test.

**Spec:** `docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md` — "Telas → Conversa do atendimento" e passo 3 da "Ordem de entrega".

## Global Constraints

- Só aparece com `plan.useCrm` (consulta `GET /companies/listPlan/:companyId`, como o menu) e para ticket que **não é grupo**.
- Botão "Criar negócio": formulário com o contato do ticket fixo, responsável = usuário logado, funil padrão = primeiro visível. Sem funil visível, o botão não aparece.
- Selo por negócio aberto do contato: `"{coluna} · {valor}"`, com a cor da coluna; até 3 selos, o resto vira "+N".
- Clicar no selo abre a gaveta na aba **Dados** (a conversa já está na tela).
- Atualiza quando chega `company-${companyId}-deal` (com atraso de 500 ms para juntar rajadas) e depois de criar/editar pela gaveta.
- Textos em português; comentários em inglês; commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; sem push.

## Review Focus

1. **Plano sem CRM** → nada do CRM na tela do atendimento, e nenhuma chamada a `/crm` (evita 403 no console). Conferido no HM.
2. **Ticket de grupo** → sem selo e sem botão. Teste em `dealChips.test.js` (`canHaveDeals`).
3. **Usuário sem funil visível** (sem fila em comum) → sem botão "Criar negócio"; selos só dos negócios que ele pode ver (a API já filtra). Teste `canHaveDeals`/HM.
4. **Trocar de atendimento com a gaveta ou o formulário abertos** → fecham e os selos são do novo contato; nenhuma resposta antiga sobrescreve. `createLatest` + teste existente; conferido no HM.
5. **Muitos negócios abertos** → 3 selos e "+N". Teste `visibleChips`.

---

### Task 1: Lógica pura dos selos

**Files:**
- Create: `whatsapp-app/src/components/TicketDeals/dealChips.js`
- Test: `whatsapp-app/src/components/TicketDeals/dealChips.test.js`

**Interfaces:**
- Produces: `canHaveDeals(ticket): boolean`, `chipLabel(deal): string`, `visibleChips(deals, max = 3): { shown: Deal[]; hidden: number }`.

- [ ] **Step 1: Teste que falha**

```js
import { canHaveDeals, chipLabel, visibleChips } from "./dealChips";

describe("canHaveDeals", () => {
  it("needs a contact and no group", () => {
    expect(canHaveDeals({ id: 1, isGroup: false, contact: { id: 2 } })).toBe(true);
    expect(canHaveDeals({ id: 1, isGroup: true, contact: { id: 2 } })).toBe(false);
    expect(canHaveDeals({ id: 1, isGroup: false })).toBe(false);
    expect(canHaveDeals({})).toBe(false);
    expect(canHaveDeals(null)).toBe(false);
  });
});

describe("chipLabel", () => {
  it("shows stage and value", () => {
    expect(chipLabel({ stageName: "Proposta", value: 2400 })).toBe("Proposta · R$ 2.400,00");
  });
});

describe("visibleChips", () => {
  it("shows up to three and counts the rest", () => {
    const deals = [1, 2, 3, 4, 5].map((id) => ({ id }));
    expect(visibleChips(deals)).toEqual({ shown: deals.slice(0, 3), hidden: 2 });
    expect(visibleChips(deals.slice(0, 2))).toEqual({ shown: deals.slice(0, 2), hidden: 0 });
  });
});
```

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/components/TicketDeals` → FAIL ("Cannot find module './dealChips'").

- [ ] **Step 2: Implementar**

```js
import { formatMoney } from "../../pages/Funnel/format";

// Deals belong to a person, so group conversations have none.
export const canHaveDeals = (ticket) =>
  Boolean(ticket && ticket.id && !ticket.isGroup && ticket.contact && ticket.contact.id);

export const chipLabel = (deal) => `${deal.stageName} · ${formatMoney(deal.value)}`;

export const visibleChips = (deals, max = 3) => ({
  shown: deals.slice(0, max),
  hidden: Math.max(0, deals.length - max),
});
```

Run de novo → PASS. Commit: `Adiciona a lógica dos selos de negócio no atendimento`.

---

### Task 2: Gaveta abrindo numa aba escolhida

**Files:**
- Modify: `whatsapp-app/src/pages/Funnel/DealDrawer/index.js`

**Interfaces:**
- Produces: prop `initialTab` (0 = Conversa, 1 = Dados; padrão 0).

- [ ] **Step 1:** Na assinatura, `({ dealId, funnels, users, lossReasons, onClose, onChanged, initialTab = 0 })`; `useState(initialTab)`; no efeito que reseta ao trocar de negócio, `setTab(initialTab)` no lugar de `setTab(0)`.
- [ ] **Step 2:** `npx eslint src/pages/Funnel` sem erros; abrir `/funil` no HM e clicar num card → continua abrindo em Conversa. Commit junto com a Task 3.

---

### Task 3: Componente TicketDeals e ligação na tela do atendimento

**Files:**
- Create: `whatsapp-app/src/components/TicketDeals/index.js`
- Modify: `whatsapp-app/src/components/Ticket/index.js` (import e a faixa das etiquetas)

**Interfaces:**
- Consumes: `canHaveDeals`, `chipLabel`, `visibleChips` (Task 1); `NewDealDialog` (`pages/Funnel/NewDealDialog`); `DealDrawer` com `initialTab` (Task 2); `createLatest` (`pages/Funnel/latest`); `usePlans().getPlanCompany`; `socketConnection`.
- Produces: `<TicketDeals ticket />`.

- [ ] **Step 1: Componente**

```js
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import Tooltip from "@material-ui/core/Tooltip";
import api from "../../services/api";
import usePlans from "../../hooks/usePlans";
import { AuthContext } from "../../context/Auth/AuthContext";
import { socketConnection } from "../../services/socket";
import { FunnelIcon } from "../../layout/icons";
import NewDealDialog from "../../pages/Funnel/NewDealDialog";
import DealDrawer from "../../pages/Funnel/DealDrawer";
import { createLatest } from "../../pages/Funnel/latest";
import { canHaveDeals, chipLabel, visibleChips } from "./dealChips";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    root: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "4px 8px" },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      maxWidth: 220,
      padding: "2px 10px",
      borderRadius: 999,
      border: `1px solid ${t.border}`,
      backgroundColor: t.surface,
      color: t.textPrimary,
      font: "inherit",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      "&:hover": { borderColor: t.borderStrong },
      "&:focus-visible": { outline: `2px solid ${t.brand}`, outlineOffset: 2 },
    },
    dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
    label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    more: { fontSize: 12, color: t.textTertiary },
    create: { textTransform: "none", fontSize: 12, padding: "2px 8px", "& .MuiSvgIcon-root": { fontSize: 16 } },
  };
});

const TicketDeals = ({ ticket }) => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const { getPlanCompany } = usePlans();
  const [crm, setCrm] = useState(false);
  const [deals, setDeals] = useState([]);
  const [setup, setSetup] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [drawerDealId, setDrawerDealId] = useState(null);
  const latest = useRef(createLatest());
  const eligible = canHaveDeals(ticket);
  const contactId = eligible ? ticket.contact.id : null;

  useEffect(() => {
    let active = true;
    getPlanCompany(undefined, user.companyId)
      .then((data) => active && setCrm(Boolean(data && data.plan && data.plan.useCrm)))
      .catch(() => active && setCrm(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.companyId]);

  const loadDeals = useCallback(async () => {
    if (!crm || !contactId) {
      setDeals([]);
      return;
    }
    const request = latest.current.next();
    try {
      const { data } = await api.get(`/crm/contacts/${contactId}/deals`);
      if (latest.current.isCurrent(request)) setDeals(data);
    } catch (err) {
      if (latest.current.isCurrent(request)) setDeals([]);
    }
  }, [crm, contactId]);

  // Another conversation: close what belongs to the previous contact.
  useEffect(() => {
    setNewOpen(false);
    setDrawerDealId(null);
    loadDeals();
  }, [loadDeals]);

  // Funnels, users and loss reasons, needed by the dialog and the drawer.
  useEffect(() => {
    if (!crm || setup) return;
    Promise.all([api.get("/crm/funnels"), api.get("/users/list"), api.get("/crm/loss-reasons")])
      .then(([f, u, r]) => setSetup({ funnels: f.data, users: u.data, lossReasons: r.data }))
      .catch(() => setSetup({ funnels: [], users: [], lossReasons: [] }));
  }, [crm, setup]);

  useEffect(() => {
    if (!crm || !contactId) return undefined;
    const companyId = localStorage.getItem("companyId");
    const socket = socketConnection({ companyId });
    let timer;
    socket.on(`company-${companyId}-deal`, () => {
      clearTimeout(timer);
      timer = setTimeout(loadDeals, 500);
    });
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [crm, contactId, loadDeals]);

  const closeDrawer = useCallback(() => setDrawerDealId(null), []);

  if (!crm || !eligible) return null;

  const { shown, hidden } = visibleChips(deals);
  const canCreate = Boolean(setup && setup.funnels.length > 0);

  return (
    <div className={classes.root} aria-label="Negócios do contato">
      {shown.map((deal) => (
        <Tooltip key={deal.id} title={`${deal.funnelName} — ${deal.title}`}>
          <button type="button" className={classes.chip} onClick={() => setDrawerDealId(deal.id)}>
            <span className={classes.dot} style={{ backgroundColor: deal.stageColor }} aria-hidden="true" />
            <span className={classes.label}>{chipLabel(deal)}</span>
          </button>
        </Tooltip>
      ))}
      {hidden > 0 && <span className={classes.more}>+{hidden}</span>}
      {canCreate && (
        <Button size="small" color="primary" className={classes.create} startIcon={<FunnelIcon />} onClick={() => setNewOpen(true)}>
          Criar negócio
        </Button>
      )}
      {setup && (
        <>
          <NewDealDialog
            open={newOpen}
            funnels={setup.funnels}
            defaultFunnelId={setup.funnels[0] ? setup.funnels[0].id : null}
            users={setup.users}
            currentUserId={user.id}
            initialContact={ticket.contact}
            onClose={(card) => {
              setNewOpen(false);
              if (card) loadDeals();
            }}
          />
          <DealDrawer
            dealId={drawerDealId}
            initialTab={1}
            funnels={setup.funnels}
            users={setup.users}
            lossReasons={setup.lossReasons}
            onClose={closeDrawer}
            onChanged={loadDeals}
          />
        </>
      )}
    </div>
  );
};

export default TicketDeals;
```

Nota: falhas nas consultas do CRM aqui só escondem os selos, sem aviso; o atendimento é a tarefa principal da tela.

- [ ] **Step 2: Ligar na tela**

Em `components/Ticket/index.js`: `import TicketDeals from "../TicketDeals";` e trocar

```js
        <Paper>
          <TagsContainer ticket={ticket} />
        </Paper>
```

por

```js
        <Paper>
          <TagsContainer ticket={ticket} />
          <TicketDeals ticket={ticket} />
        </Paper>
```

- [ ] **Step 3: Conferir no HM**

1. Atendimento do contato 11 (`/tickets/<uuid do ticket 10>`): aparecem os selos dos negócios abertos dele e "Criar negócio".
2. "Criar negócio" → contato fixo, valor "2.500" → Criar: novo selo "Lead · R$ 2.500,00".
3. Clicar no selo → gaveta abre em Dados; mudar o valor → o selo muda.
4. No `/funil` em outra aba, mover o negócio para Proposta → o selo do atendimento muda em ~1 s.
5. `useCrm=false` no plano do HM → recarregar o atendimento: nada do CRM e nenhuma chamada `/crm` em `read_network_requests`. Religar.
6. Trocar para outro atendimento com a gaveta aberta → gaveta fecha e os selos são do novo contato.

Run: `npx eslint src/components/TicketDeals src/components/Ticket src/pages/Funnel && CI=true npx react-scripts test --watchAll=false`
Expected: sem erros; todas as suítes passam.

- [ ] **Step 4: Commit**

```bash
git add src/components/TicketDeals src/components/Ticket/index.js src/pages/Funnel/DealDrawer/index.js
git commit -m "Mostra os negócios do contato e cria negócio pela conversa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Depois: revisão final independente e publicação só com o usuário.
