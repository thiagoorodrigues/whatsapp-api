# CRM etapa 4 — Configurações do CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, escolhido pelo usuário). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela de configurações do CRM para o admin: criar, renomear, colorir e arquivar funis; definir filas com acesso e "vendedor vê só os seus"; editar colunas (adicionar, renomear, cor, reordenar, arquivar, apagar movendo os negócios); e editar motivos de perda.

**Architecture:** Página nova `pages/FunnelSettings` em `/funil/configuracoes`, aberta por um botão de engrenagem no Funil de vendas (só admin). Usa a API da etapa 1 (`/crm/funnels`, `/crm/funnels/:id`, `/archive`, `/stages`, `/stages/order`, `/stages/:id`, `/crm/loss-reasons`) e `GET /queue`, com uma mudança pequena no backend: `includeArchived` também traz as colunas arquivadas (Task 1b). A regra de reordenar fica pura em `order.js` com testes. Reordenar usa botões subir/descer (acessível por teclado, sem arrastar).

**Tech Stack:** React 17, Material-UI 4, react-scripts test.

**Spec:** `docs/superpowers/specs/2026-09-30-crm-funil-vendas-design.md` — "Telas → Configurações do CRM" (abas Funis e Motivos de perda) e passo 4 da "Ordem de entrega". A aba "Criação automática" fica para a etapa 5, junto com a API das regras.

## Global Constraints

- Só admin (`user.profile === "admin"`); outro perfil vê "Somente administradores podem configurar o CRM." Rota bloqueada por `withPlanFeature(..., "useCrm", "CRM")`.
- Ganho e Perdido: só nome e cor; sem subir/descer, arquivar ou apagar.
- Apagar coluna com negócios abre um diálogo para escolher a coluna de destino (`DELETE ...?moveTo=`); sem negócios, só confirma.
- Arquivar funil: confirmação; arquivados aparecem numa lista à parte ("Mostrar arquivados") com "Desarquivar". Limite do plano: a API devolve `ERR_CRM_FUNNEL_LIMIT`, mostrado pelo `toastError`.
- Salvamento ao sair do campo (nome) e na hora (cor, filas, switches), como na gaveta do negócio.
- Textos em português; comentários em inglês; commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; sem push.

## Review Focus

1. **Subir a primeira coluna aberta ou descer a última** → nada acontece (botão desabilitado), Ganho/Perdido nunca mudam de lugar. Teste em `order.test.js`.
2. **Apagar coluna com negócios sem escolher destino** → não apaga; o diálogo exige a coluna. Destino só entre colunas abertas, não arquivadas, diferentes da apagada. Teste `deleteTargets`.
3. **Nome vazio** (funil, coluna, motivo) → volta ao nome anterior sem chamar a API.
4. **Funil sem fila** → aviso "Só administradores verão este funil" no editor.
5. **Duas abas editando ao mesmo tempo** → a tela recarrega ao receber `company-${id}-funnel`; sem resposta antiga sobrescrevendo (`createLatest`).

---

### Task 1: Regras puras de ordem e destino

**Files:**
- Create: `whatsapp-app/src/pages/FunnelSettings/order.js`, `order.test.js`

**Interfaces:**
- Produces: `openStages(stages)`, `canMove(stages, stageId, delta): boolean`, `moveOpenStage(stages, stageId, delta): number[]` (ids das colunas abertas na nova ordem), `deleteTargets(stages, stageId): Stage[]`.

- [ ] **Step 1: Teste que falha**

```js
import { openStages, canMove, moveOpenStage, deleteTargets } from "./order";

const stages = [
  { id: 1, kind: "open", position: 1024, archived: false },
  { id: 2, kind: "open", position: 2048, archived: false },
  { id: 3, kind: "open", position: 3072, archived: true },
  { id: 4, kind: "open", position: 4096, archived: false },
  { id: 5, kind: "won", position: 0, archived: false },
  { id: 6, kind: "lost", position: 0, archived: false },
];

describe("openStages", () => {
  it("keeps open, non-archived stages in order", () => {
    expect(openStages(stages).map((s) => s.id)).toEqual([1, 2, 4]);
  });
});

describe("canMove / moveOpenStage", () => {
  it("moves a stage one step up or down among the open ones", () => {
    expect(moveOpenStage(stages, 2, -1)).toEqual([2, 1, 4]);
    expect(moveOpenStage(stages, 2, 1)).toEqual([1, 4, 2]);
  });
  it("blocks the edges and won/lost", () => {
    expect(canMove(stages, 1, -1)).toBe(false);
    expect(canMove(stages, 4, 1)).toBe(false);
    expect(canMove(stages, 5, -1)).toBe(false);
    expect(canMove(stages, 2, 1)).toBe(true);
    expect(moveOpenStage(stages, 1, -1)).toEqual([1, 2, 4]);
  });
});

describe("deleteTargets", () => {
  it("offers only other open, active stages", () => {
    expect(deleteTargets(stages, 2).map((s) => s.id)).toEqual([1, 4]);
  });
});
```

Run: `cd whatsapp-app && CI=true npx react-scripts test --watchAll=false src/pages/FunnelSettings` → FAIL (módulo inexistente).

- [ ] **Step 2: Implementar**

```js
const byPosition = (a, b) => a.position - b.position || a.id - b.id;

// Open stages that show on the board, in board order.
export const openStages = (stages) => stages.filter((s) => s.kind === "open" && !s.archived).sort(byPosition);

export const canMove = (stages, stageId, delta) => {
  const ids = openStages(stages).map((s) => s.id);
  const index = ids.indexOf(stageId);
  return index !== -1 && index + delta >= 0 && index + delta < ids.length;
};

// New order of the open stages, as PUT /stages/order expects.
export const moveOpenStage = (stages, stageId, delta) => {
  const ids = openStages(stages).map((s) => s.id);
  if (!canMove(stages, stageId, delta)) return ids;
  const index = ids.indexOf(stageId);
  const [moved] = ids.splice(index, 1);
  ids.splice(index + delta, 0, moved);
  return ids;
};

export const deleteTargets = (stages, stageId) => openStages(stages).filter((s) => s.id !== stageId);
```

Run → PASS. Commit: `Adiciona as regras de ordem das colunas nas configurações do CRM`.

---

### Task 1b: Colunas arquivadas na listagem de configuração (backend)

**Files:**
- Modify: `whatsapp-api/src/services/CrmServices/FunnelService.ts` (`listFunnels`)
- Test: `whatsapp-api/src/services/CrmServices/__tests__/FunnelService.spec.ts`

**Interfaces:**
- Produces: `GET /crm/funnels?includeArchived=true` (admin) devolve também as colunas arquivadas; sem o parâmetro, nada muda.

- [ ] **Step 1: Teste que falha** (no `FunnelService.spec.ts`, importar `listFunnels` e acrescentar `findAll: jest.fn().mockResolvedValue([])` ao mock de `Funnel`):

```ts
describe("listFunnels", () => {
  const stageWhere = () => (Funnel.findAll as jest.Mock).mock.calls[0][0].include[0].where;
  it("hides archived stages on the board", async () => {
    await listFunnels(admin);
    expect(stageWhere()).toEqual({ archived: false });
  });
  it("brings archived stages to the admin settings", async () => {
    await listFunnels(admin, { includeArchived: true });
    expect(stageWhere()).toBeUndefined();
  });
  it("keeps them hidden for non-admins even when asked", async () => {
    await listFunnels(seller, { includeArchived: true });
    expect(stageWhere()).toEqual({ archived: false });
  });
});
```

Run: `cd whatsapp-api && npx jest src/services/CrmServices/__tests__/FunnelService.spec.ts --coverage=false` → FAIL nos dois últimos.

- [ ] **Step 2: Implementar** — em `listFunnels`, montar o include com `where: { archived: false }` só quando `!withArchived` (para admin com `includeArchived`, sem `where` nas colunas). `sortStages` já ordena arquivadas junto; a tela separa por `archived`.

Run de novo → PASS; `npx tsc --noEmit -p .` limpo. Commit: `Lista colunas arquivadas nas configurações do CRM`.

---

### Task 2: Página, rota e motivos de perda

**Files:**
- Create: `whatsapp-app/src/pages/FunnelSettings/index.js`, `LossReasons.js`
- Modify: `whatsapp-app/src/routes/index.js` (import + `FunnelSettingsGated` + rota `/funil/configuracoes` antes de `/funil`), `whatsapp-app/src/layout/index.js` (`["/funil/configuracoes", "Configurações do CRM"]` antes de `["/funil", ...]`), `whatsapp-app/src/pages/Funnel/index.js` (botão engrenagem para admin)

**Interfaces:**
- Produces: `<LossReasons />` (autossuficiente); página com abas "Funis" (Task 3 preenche) e "Motivos de perda".

- [ ] **Step 1: LossReasons**

```js
import React, { useCallback, useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import Switch from "@material-ui/core/Switch";
import Button from "@material-ui/core/Button";
import api from "../../services/api";
import toastError from "../../errors/toastError";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 },
    row: { display: "flex", alignItems: "center", gap: 12 },
    add: { display: "flex", gap: 8, marginTop: 16, maxWidth: 520 },
    hint: { fontSize: 13, color: t.textSecondary, margin: "0 0 12px" },
  };
});

const ReasonRow = ({ reason, onSaved }) => {
  const classes = useStyles();
  const [name, setName] = useState(reason.name);
  useEffect(() => setName(reason.name), [reason.name]);

  const save = async (patch) => {
    try {
      const { data } = await api.put(`/crm/loss-reasons/${reason.id}`, patch);
      onSaved(data);
    } catch (err) {
      toastError(err);
      setName(reason.name);
    }
  };

  return (
    <li className={classes.row}>
      <TextField
        size="small"
        variant="outlined"
        fullWidth
        value={name}
        inputProps={{ "aria-label": `Nome do motivo ${reason.name}`, maxLength: 255 }}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) return setName(reason.name);
          if (name.trim() !== reason.name) save({ name: name.trim() });
          return undefined;
        }}
      />
      <Switch
        color="primary"
        checked={reason.active}
        onChange={(e) => save({ active: e.target.checked })}
        inputProps={{ "aria-label": `Motivo ${reason.name} ativo` }}
      />
    </li>
  );
};

const LossReasons = () => {
  const classes = useStyles();
  const [reasons, setReasons] = useState([]);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/crm/loss-reasons");
      setReasons(data);
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post("/crm/loss-reasons", { name: name.trim() });
      setName("");
      load();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <section aria-label="Motivos de perda">
      <p className={classes.hint}>Motivos desativados deixam de aparecer ao marcar um negócio como perdido.</p>
      <ul className={classes.list}>
        {reasons.map((r) => (
          <ReasonRow key={r.id} reason={r} onSaved={(saved) => setReasons((list) => list.map((x) => (x.id === saved.id ? saved : x)))} />
        ))}
      </ul>
      <form className={classes.add} onSubmit={add}>
        <TextField size="small" variant="outlined" fullWidth label="Novo motivo" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="contained" color="primary" disabled={!name.trim()}>Adicionar</Button>
      </form>
    </section>
  );
};

export default LossReasons;
```

- [ ] **Step 2: Página com abas**

```js
import React, { useContext, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import MainContainer from "../../components/MainContainer";
import { AuthContext } from "../../context/Auth/AuthContext";
import LossReasons from "./LossReasons";
import Funnels from "./Funnels";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    panel: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: 24,
      backgroundColor: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: theme.radii.panel,
      ...theme.scrollbarStylesSoft,
    },
    tabs: { marginBottom: 12 },
    denied: { padding: 24, color: t.textSecondary },
  };
});

const FunnelSettings = () => {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const [tab, setTab] = useState(0);

  if (user.profile !== "admin") {
    return (
      <MainContainer>
        <div className={classes.denied}>Somente administradores podem configurar o CRM.</div>
      </MainContainer>
    );
  }

  return (
    <MainContainer>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} indicatorColor="primary" textColor="primary" className={classes.tabs}>
        <Tab label="Funis" />
        <Tab label="Motivos de perda" />
      </Tabs>
      <div className={classes.panel}>{tab === 0 ? <Funnels /> : <LossReasons />}</div>
    </MainContainer>
  );
};

export default FunnelSettings;
```

Até a Task 3, criar `Funnels.js` provisório: `const Funnels = () => null; export default Funnels;`.

- [ ] **Step 3: Rota, título e botão**

`routes/index.js`: `import FunnelSettings from "../pages/FunnelSettings";`, `const FunnelSettingsGated = withPlanFeature(FunnelSettings, "useCrm", "CRM");` e, antes da rota `/funil`:

```js
                <Route exact path="/funil/configuracoes" component={FunnelSettingsGated} isPrivate />
```

`layout/index.js`: em `PAGE_TITLES`, antes de `["/funil", "Funil de vendas"],` → `["/funil/configuracoes", "Configurações do CRM"],` (a lista usa o prefixo mais longo).

`pages/Funnel/index.js`: importar `IconButton`, `Tooltip`, `SettingsIcon` (`@material-ui/icons/Settings`) e `Link as RouterLink` (`react-router-dom`); depois do `AddButton`:

```js
            {isAdmin && (
              <Tooltip title="Configurações do CRM">
                <IconButton component={RouterLink} to="/funil/configuracoes" aria-label="Configurações do CRM">
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
            )}
```

E no `EmptyState` do admin, nada muda (criar o primeiro funil continua lá).

- [ ] **Step 4: Conferir e commitar**

HM: engrenagem em `/funil` → página com abas; aba Motivos: renomear "Outro" para "Outro motivo" e voltar; desativar "Sem resposta" → some do diálogo de perda no funil; reativar; adicionar "Prazo". `npx eslint src/pages/FunnelSettings src/pages/Funnel src/routes src/layout` sem erros. Commit: `Adiciona a página de configurações do CRM com motivos de perda`.

---

### Task 3: Funis e colunas

**Files:**
- Create/replace: `whatsapp-app/src/pages/FunnelSettings/Funnels.js`, `StagesEditor.js`, `DeleteStageDialog.js`

**Interfaces:**
- Consumes: `openStages`, `canMove`, `moveOpenStage`, `deleteTargets` (Task 1); `createLatest` (`pages/Funnel/latest`); `socketConnection`.

- [ ] **Step 1: DeleteStageDialog**

```js
import React, { useEffect, useState } from "react";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import MenuItem from "@material-ui/core/MenuItem";

// Asks where the deals go when the stage still has some (count from the API).
const DeleteStageDialog = ({ stage, dealCount, targets, onCancel, onConfirm }) => {
  const [moveTo, setMoveTo] = useState("");
  useEffect(() => setMoveTo(""), [stage]);
  if (!stage) return null;
  const needsTarget = dealCount > 0;
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="delete-stage-title">
      <DialogTitle id="delete-stage-title">Apagar a coluna “{stage.name}”?</DialogTitle>
      <DialogContent>
        {needsTarget ? (
          <TextField
            select
            fullWidth
            variant="outlined"
            label={`Mover ${dealCount} negócio(s) para`}
            value={moveTo}
            onChange={(e) => setMoveTo(Number(e.target.value))}
          >
            {targets.map((t) => (
              <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
            ))}
          </TextField>
        ) : (
          "A coluna está vazia e será apagada."
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button color="primary" variant="contained" disabled={needsTarget && !moveTo} onClick={() => onConfirm(needsTarget ? moveTo : undefined)}>
          Apagar coluna
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteStageDialog;
```

A contagem vem de `GET /crm/funnels/:id/stats` (etapa 2), que devolve `count` por coluna.

- [ ] **Step 2: StagesEditor**

```js
import React, { useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import IconButton from "@material-ui/core/IconButton";
import Tooltip from "@material-ui/core/Tooltip";
import Button from "@material-ui/core/Button";
import ArrowUpwardIcon from "@material-ui/icons/ArrowUpward";
import ArrowDownwardIcon from "@material-ui/icons/ArrowDownward";
import ArchiveIcon from "@material-ui/icons/Archive";
import UnarchiveIcon from "@material-ui/icons/Unarchive";
import DeleteIcon from "@material-ui/icons/DeleteOutline";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import DeleteStageDialog from "./DeleteStageDialog";
import { canMove, deleteTargets, moveOpenStage } from "./order";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 },
    row: { display: "flex", alignItems: "center", gap: 8 },
    archived: { opacity: 0.55 },
    color: { width: 36, height: 36, padding: 0, border: `1px solid ${t.border}`, borderRadius: 8, background: "none", cursor: "pointer" },
    tag: { fontSize: 11, fontWeight: 700, color: t.textTertiary, minWidth: 64 },
    add: { display: "flex", gap: 8, marginTop: 12 },
  };
});

const KIND_LABEL = { won: "Ganho", lost: "Perdido" };

const StageRow = ({ funnelId, stage, stages, onChanged, onDelete }) => {
  const classes = useStyles();
  const [name, setName] = useState(stage.name);
  useEffect(() => setName(stage.name), [stage.name]);
  const locked = stage.kind !== "open";

  const update = async (patch) => {
    try {
      await api.put(`/crm/funnels/${funnelId}/stages/${stage.id}`, patch);
      onChanged();
    } catch (err) {
      toastError(err);
      setName(stage.name);
    }
  };

  const move = async (delta) => {
    try {
      await api.put(`/crm/funnels/${funnelId}/stages/order`, { stageIds: moveOpenStage(stages, stage.id, delta) });
      onChanged();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <li className={`${classes.row} ${stage.archived ? classes.archived : ""}`}>
      <input
        type="color"
        className={classes.color}
        value={stage.color}
        aria-label={`Cor da coluna ${stage.name}`}
        onChange={(e) => update({ color: e.target.value })}
      />
      <TextField
        size="small"
        variant="outlined"
        fullWidth
        value={name}
        inputProps={{ "aria-label": `Nome da coluna ${stage.name}`, maxLength: 255 }}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) return setName(stage.name);
          if (name.trim() !== stage.name) update({ name: name.trim() });
          return undefined;
        }}
      />
      {locked ? (
        <span className={classes.tag}>{KIND_LABEL[stage.kind]}</span>
      ) : (
        <>
          <Tooltip title="Subir">
            <span>
              <IconButton size="small" aria-label={`Subir ${stage.name}`} disabled={stage.archived || !canMove(stages, stage.id, -1)} onClick={() => move(-1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Descer">
            <span>
              <IconButton size="small" aria-label={`Descer ${stage.name}`} disabled={stage.archived || !canMove(stages, stage.id, 1)} onClick={() => move(1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={stage.archived ? "Desarquivar" : "Arquivar"}>
            <IconButton size="small" aria-label={`${stage.archived ? "Desarquivar" : "Arquivar"} ${stage.name}`} onClick={() => update({ archived: !stage.archived })}>
              {stage.archived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Apagar">
            <IconButton size="small" aria-label={`Apagar ${stage.name}`} onClick={() => onDelete(stage)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )}
    </li>
  );
};

const StagesEditor = ({ funnelId, stages, onChanged }) => {
  const classes = useStyles();
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.post(`/crm/funnels/${funnelId}/stages`, { name: newName.trim() });
      setNewName("");
      onChanged();
    } catch (err) {
      toastError(err);
    }
  };

  const askDelete = async (stage) => {
    try {
      const { data } = await api.get(`/crm/funnels/${funnelId}/stats`);
      const row = data.stages.find((s) => s.stageId === stage.id);
      setDeleting({ stage, count: row ? row.count : 0 });
    } catch (err) {
      setDeleting({ stage, count: 0 });
    }
  };

  const confirmDelete = async (moveTo) => {
    const { stage } = deleting;
    setDeleting(null);
    try {
      await api.delete(`/crm/funnels/${funnelId}/stages/${stage.id}`, { params: moveTo ? { moveTo } : {} });
      onChanged();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <ul className={classes.list} aria-label="Colunas do funil">
        {stages.map((s) => (
          <StageRow key={s.id} funnelId={funnelId} stage={s} stages={stages} onChanged={onChanged} onDelete={askDelete} />
        ))}
      </ul>
      <form className={classes.add} onSubmit={add}>
        <TextField size="small" variant="outlined" fullWidth label="Nova coluna" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" variant="contained" color="primary" disabled={!newName.trim()}>Adicionar</Button>
      </form>
      <DeleteStageDialog
        stage={deleting && deleting.stage}
        dealCount={deleting ? deleting.count : 0}
        targets={deleting ? deleteTargets(stages, deleting.stage.id) : []}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
};

export default StagesEditor;
```

Nota: as colunas arquivadas só chegam com `includeArchived=true` (Task 1b); o quadro, que não manda esse parâmetro, continua sem elas.

- [ ] **Step 3: Funnels (lista + editor)**

```js
import React, { useCallback, useEffect, useRef, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";
import Switch from "@material-ui/core/Switch";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import Autocomplete from "@material-ui/lab/Autocomplete";
import api from "../../services/api";
import toastError from "../../errors/toastError";
import ConfirmationModal from "../../components/ConfirmationModal";
import { socketConnection } from "../../services/socket";
import { createLatest } from "../Funnel/latest";
import StagesEditor from "./StagesEditor";

const useStyles = makeStyles((theme) => {
  const t = theme.tokens;
  return {
    root: { display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" },
    side: { width: 240, display: "flex", flexDirection: "column", gap: 8 },
    item: {
      textAlign: "left",
      padding: "8px 12px",
      borderRadius: theme.radii.control,
      border: `1px solid ${t.border}`,
      background: t.surface,
      color: t.textPrimary,
      font: "inherit",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    selected: { borderColor: t.brand, boxShadow: `0 0 0 1px ${t.brand}` },
    dot: { width: 10, height: 10, borderRadius: "50%" },
    editor: { flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 },
    row: { display: "flex", gap: 12, alignItems: "center" },
    color: { width: 40, height: 40, padding: 0, border: `1px solid ${t.border}`, borderRadius: 8, background: "none", cursor: "pointer" },
    warning: { fontSize: 13, color: t.warningText, background: t.warningSoft, padding: "8px 12px", borderRadius: 8 },
    label: { margin: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: t.textTertiary },
    archivedLabel: { fontSize: 12, color: t.textTertiary },
  };
});

const Funnels = () => {
  const classes = useStyles();
  const [funnels, setFunnels] = useState([]);
  const [queues, setQueues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [archiving, setArchiving] = useState(false);
  const latest = useRef(createLatest());

  const load = useCallback(async () => {
    const request = latest.current.next();
    try {
      const { data } = await api.get("/crm/funnels", { params: { includeArchived: true } });
      if (!latest.current.isCurrent(request)) return;
      setFunnels(data);
      setSelectedId((id) => (data.some((f) => f.id === id) ? id : data[0] ? data[0].id : null));
    } catch (err) {
      toastError(err);
    }
  }, []);

  useEffect(() => {
    load();
    api.get("/queue").then(({ data }) => setQueues(data)).catch(() => setQueues([]));
  }, [load]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketConnection({ companyId });
    socket.on(`company-${companyId}-funnel`, load);
    return () => socket.disconnect();
  }, [load]);

  const funnel = funnels.find((f) => f.id === selectedId) || null;
  useEffect(() => setName(funnel ? funnel.name : ""), [funnel && funnel.id, funnel && funnel.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (patch) => {
    try {
      await api.put(`/crm/funnels/${funnel.id}`, patch);
      load();
    } catch (err) {
      toastError(err);
      setName(funnel.name);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { data } = await api.post("/crm/funnels", { name: newName.trim() });
      setNewName("");
      setSelectedId(data.id);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const setArchived = async (archived) => {
    try {
      await api.post(`/crm/funnels/${funnel.id}/archive`, { archived });
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const visible = funnels.filter((f) => showArchived || !f.archived);

  return (
    <div className={classes.root}>
      <div className={classes.side}>
        <h3 className={classes.label}>Funis</h3>
        {visible.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`${classes.item} ${f.id === selectedId ? classes.selected : ""}`}
            aria-pressed={f.id === selectedId}
            onClick={() => setSelectedId(f.id)}
          >
            <span className={classes.dot} style={{ backgroundColor: f.color }} aria-hidden="true" />
            <span>{f.name}</span>
            {f.archived && <span className={classes.archivedLabel}>(arquivado)</span>}
          </button>
        ))}
        <FormControlLabel
          control={<Switch size="small" color="primary" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
          label="Mostrar arquivados"
        />
        <form onSubmit={create} className={classes.row}>
          <TextField size="small" variant="outlined" label="Novo funil" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" color="primary" variant="contained" disabled={!newName.trim()}>Criar</Button>
        </form>
      </div>

      {funnel && (
        <div className={classes.editor}>
          <div className={classes.row}>
            <input
              type="color"
              className={classes.color}
              value={funnel.color}
              aria-label="Cor do funil"
              onChange={(e) => update({ color: e.target.value })}
            />
            <TextField
              fullWidth
              variant="outlined"
              label="Nome do funil"
              value={name}
              inputProps={{ maxLength: 255 }}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (!name.trim()) return setName(funnel.name);
                if (name.trim() !== funnel.name) update({ name: name.trim() });
                return undefined;
              }}
            />
          </div>

          <Autocomplete
            multiple
            options={queues}
            value={queues.filter((q) => funnel.queueIds.includes(q.id))}
            getOptionLabel={(q) => q.name}
            getOptionSelected={(o, v) => o.id === v.id}
            onChange={(e, value) => update({ queueIds: value.map((q) => q.id) })}
            renderInput={(params) => <TextField {...params} variant="outlined" label="Filas com acesso" />}
          />
          {funnel.queueIds.length === 0 && (
            <div className={classes.warning}>Sem fila: só administradores verão este funil.</div>
          )}

          <FormControlLabel
            control={<Switch color="primary" checked={funnel.ownDealsOnly} onChange={(e) => update({ ownDealsOnly: e.target.checked })} />}
            label="Vendedor vê só os próprios negócios e os sem responsável"
          />

          <h3 className={classes.label}>Colunas</h3>
          <StagesEditor funnelId={funnel.id} stages={funnel.stages} onChanged={load} />

          <div>
            {funnel.archived ? (
              <Button variant="outlined" color="primary" onClick={() => setArchived(false)}>Desarquivar funil</Button>
            ) : (
              <Button variant="outlined" onClick={() => setArchiving(true)}>Arquivar funil</Button>
            )}
          </div>
          <ConfirmationModal
            title={`Arquivar o funil “${funnel.name}”?`}
            open={archiving}
            onClose={() => setArchiving(false)}
            onConfirm={() => setArchived(true)}
          >
            O funil some do quadro e da criação de negócios. Os negócios continuam guardados e voltam ao desarquivar.
          </ConfirmationModal>
        </div>
      )}
    </div>
  );
};

export default Funnels;
```

Antes de usar `ConfirmationModal`, conferir a assinatura em `components/ConfirmationModal` (`title, children, open, onClose, onConfirm`, como em `pages/AiAgents`).

- [ ] **Step 4: Conferir no HM**

1. Selecionar "Vendas": mudar a cor e o nome; voltar o nome.
2. Filas: adicionar uma fila → aviso some; remover todas → aviso aparece.
3. Colunas: adicionar "Demonstração"; descer até antes de Ganho (último "Descer" desabilitado); conferir a ordem no `/funil`.
4. Apagar "Demonstração" vazia → apaga. Apagar "Lead" (com negócios) → diálogo pede o destino; escolher "Qualificação" → negócios vão para lá.
5. Arquivar "Parcerias" → some do seletor do `/funil`; "Mostrar arquivados" → aparece com "(arquivado)"; "Desarquivar funil" volta.
6. Nome vazio em funil/coluna/motivo → volta ao anterior, sem PUT em `read_network_requests`.

Run: `npx eslint src/pages/FunnelSettings && CI=true npx react-scripts test --watchAll=false`
Expected: sem erros; tudo passa.

- [ ] **Step 5: Commit**

```bash
git add src/pages/FunnelSettings
git commit -m "Adiciona a edição de funis e colunas nas configurações do CRM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Depois: revisão final independente; merge e publicação só com o usuário.
