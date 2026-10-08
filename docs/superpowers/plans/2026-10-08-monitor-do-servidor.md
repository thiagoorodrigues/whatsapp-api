# Monitor do servidor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página "Monitor do servidor" (só super admin, em Configurações) com CPU, memória, load e disco da VPS, saúde de Postgres/Redis/filas, conexões do WhatsApp, histórico de 24 h e alertas visuais.

**Architecture:** A API lê os números de dentro do container (`/proc`, cgroup, `statfs`, `os`), grava uma linha por minuto em `ServerMetrics` (cron já existente em `server.ts`) e expõe três rotas `isAuth + isSuper`. O painel ganha a seção `monitor` em `SettingsCustom`, um componente `ServerMonitor` com cartões, gráficos recharts e listas, e um ponto de alerta no menu.

**Tech Stack:** whatsapp-api — Node 24, TypeScript, Express 4 + express-async-errors, Sequelize 5 / sequelize-typescript, Bull, node-cron, Jest 27 + ts-jest + supertest. whatsapp-app — React (CRA), Material UI v4, recharts 2, react-scripts test.

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-08-monitor-do-servidor-design.md`

**Repos/branches:** `whatsapp-api` e `whatsapp-app`, branch `feat/server-monitor` nos dois (a da API já existe com a spec). **Não fazer push na `main`** — push na main publica em produção.

## Global Constraints

- Página e rotas só para super admin (`isAuth` + `isSuper` na API; `user.super` no painel, seção na lista `SUPER_ONLY`).
- Item "Monitor do servidor" no submenu de Configurações, dentro do bloco `user.super`, logo depois de "Logs do sistema"; rota `/settings/monitor`.
- Limites: memória, disco e CPU — aviso ≥ 85%, crítico ≥ 95%; CPU pela média dos últimos 5 min do histórico; load 5 min — aviso ≥ nº de vCPUs, crítico ≥ 2× nº de vCPUs.
- Postgres ou Redis sem resposta: crítico. Fila com job que falhou na última hora: aviso. Conexão do WhatsApp que não está `CONNECTED`: aviso.
- Cada verificação de serviço com timeout de 3 s; falha vira `{ ok: false, error }`, nunca derruba a resposta.
- Métrica indisponível → `null` → "—" no painel, sem alerta.
- Uma leitura por minuto; retenção 7 dias (limpeza 03:45); histórico padrão 24 h, máximo 168 h, no máximo 300 pontos.
- Painel atualiza a cada 30 s; histórico a cada 5 min; ponto do menu a cada 60 s.
- Alerta só na página e no menu (sem WhatsApp/e-mail).
- Textos da interface em português.

## Review Focus

1. **HM no Mac (sem `/proc` nem cgroup)** — a rota deve responder com fallback de `os` e `null` onde não houver dado, nunca 500. Teste em Task 1 (`readServerMetrics` com `readFile` que devolve `null`).
2. **Logo após o deploy, histórico vazio** — `cpuAvg5` é `null`, nenhum alerta de CPU, gráfico mostra "Sem leituras ainda". Testes em Task 2 (`evaluateAlerts` com `cpuAvg5: null`) e Task 3 (`averageCpu([])`).
3. **Redis ou Postgres travado** — a rota responde em ~3 s com `ok: false`, sem pendurar. Teste em Task 4 (`withTimeout` com promessa que nunca resolve).
4. **`?hours=` inválido** (`abc`, `0`, `-5`, `9999`) — vira 24 ou é limitado a 168, sem 500. Teste em Task 3 (`clampHours`).
5. **cgroup com valor `max` ou ausente (cgroup v1)** — memória do container cai para `rss` do processo. Teste em Task 1 (`parseCgroupMemory("max\n")` → `null` e fallback).

---

## File Structure

whatsapp-api:
- `src/services/ServerMonitorServices/readServerMetrics.ts` — parsers puros e leitura dos números da máquina.
- `src/services/ServerMonitorServices/alerts.ts` — limites, níveis e `evaluateAlerts` (puro).
- `src/models/ServerMetric.ts`, `src/database/migrations/20261008210000-create-server-metrics.ts` — tabela.
- `src/services/ServerMonitorServices/metricsHistory.ts` — gravar, limpar, histórico (com amostragem) e média de CPU.
- `src/services/ServerMonitorServices/checkServicesHealth.ts` — Postgres, Redis, filas.
- `src/services/ServerMonitorServices/listConnectionsStatus.ts` — conexões do WhatsApp.
- `src/services/ServerMonitorServices/GetServerMonitorService.ts` — junta tudo.
- `src/controllers/ServerMonitorController.ts`, `src/routes/serverMonitorRoutes.ts` — rotas.
- Modificar: `src/database/index.ts`, `src/routes/index.ts`, `src/server.ts`.

whatsapp-app:
- `src/components/ServerMonitor/format.js` (+ `format.test.js`) — níveis, bytes, tempo, textos.
- `src/components/ServerMonitor/index.js` — a página.
- `src/hooks/useServerAlerts.js` — consulta leve para o ponto do menu.
- Modificar: `src/pages/SettingsCustom/index.js`, `src/layout/MainListItems.js`.

---

### Task 1: Leitura dos números da máquina

**Files:**
- Create: `whatsapp-api/src/services/ServerMonitorServices/readServerMetrics.ts`
- Test: `whatsapp-api/src/services/ServerMonitorServices/__tests__/readServerMetrics.spec.ts`

**Interfaces:**
- Produces:
  - `interface CpuTimes { idle: number; total: number }`
  - `interface MetricsSnapshot { cpuPercent: number | null; cpuCount: number; load1: number; load5: number; load15: number; memUsedBytes: number | null; memTotalBytes: number | null; apiMemBytes: number | null; diskUsedBytes: number | null; diskTotalBytes: number | null }`
  - `parseProcStat(text: string): CpuTimes | null`
  - `cpuPercentBetween(a: CpuTimes, b: CpuTimes): number | null`
  - `parseMeminfo(text: string): { total: number; used: number } | null`
  - `parseCgroupMemory(text: string): number | null`
  - `interface ReadDeps { readFile?: (p: string) => Promise<string | null>; statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>; diskPath?: string; sampleMs?: number }`
  - `readServerMetrics(deps?: ReadDeps): Promise<MetricsSnapshot>`

- [ ] **Step 1: Write the failing test**

```ts
import {
  parseProcStat,
  cpuPercentBetween,
  parseMeminfo,
  parseCgroupMemory,
  readServerMetrics
} from "../readServerMetrics";

const STAT_A = "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 50 0 50 350 50 0 0 0 0 0\n";
const STAT_B = "cpu  200 0 200 1300 100 0 0 0 0 0\n";
const MEMINFO = "MemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    2000000 kB\n";

describe("parsers", () => {
  it("reads idle (idle + iowait) and total from the cpu line", () => {
    expect(parseProcStat(STAT_A)).toEqual({ idle: 800, total: 1000 });
    expect(parseProcStat("garbage")).toBeNull();
  });

  it("computes busy percent between two samples", () => {
    // total +800, idle +600 → 25% busy
    expect(cpuPercentBetween(parseProcStat(STAT_A)!, parseProcStat(STAT_B)!)).toBe(25);
    expect(cpuPercentBetween({ idle: 1, total: 10 }, { idle: 1, total: 10 })).toBeNull();
  });

  it("uses MemAvailable for used memory", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ total: 8000000 * 1024, used: 6000000 * 1024 });
    expect(parseMeminfo("MemTotal: 10 kB\n")).toBeNull();
  });

  it("reads cgroup v2 memory.current and ignores 'max'", () => {
    expect(parseCgroupMemory("123456\n")).toBe(123456);
    expect(parseCgroupMemory("max\n")).toBeNull();
    expect(parseCgroupMemory("")).toBeNull();
  });
});

describe("readServerMetrics", () => {
  it("reads Linux sources", async () => {
    const stats = [STAT_A, STAT_B];
    const files: Record<string, () => string> = {
      "/proc/stat": () => stats.shift() as string,
      "/proc/meminfo": () => MEMINFO,
      "/sys/fs/cgroup/memory.current": () => "300000000\n"
    };
    const snap = await readServerMetrics({
      sampleMs: 0,
      readFile: async p => (files[p] ? files[p]() : null),
      statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
      diskPath: "/x"
    });
    expect(snap.cpuPercent).toBe(25);
    expect(snap.memTotalBytes).toBe(8000000 * 1024);
    expect(snap.memUsedBytes).toBe(6000000 * 1024);
    expect(snap.apiMemBytes).toBe(300000000);
    expect(snap.diskTotalBytes).toBe(4096 * 1000);
    expect(snap.diskUsedBytes).toBe(4096 * 750);
    expect(snap.cpuCount).toBeGreaterThan(0);
    expect(typeof snap.load5).toBe("number");
  });

  it("falls back to os when /proc and cgroup are missing (Mac) and never throws", async () => {
    const snap = await readServerMetrics({
      sampleMs: 0,
      readFile: async () => null,
      statfs: async () => {
        throw new Error("ENOENT");
      },
      diskPath: "/nope"
    });
    expect(snap.memTotalBytes).toBeGreaterThan(0);
    expect(snap.apiMemBytes).toBeGreaterThan(0); // process rss
    expect(snap.diskUsedBytes).toBeNull();
    expect(snap.diskTotalBytes).toBeNull();
    expect(snap.cpuPercent === null || typeof snap.cpuPercent === "number").toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (em `whatsapp-api`): `npx jest src/services/ServerMonitorServices/__tests__/readServerMetrics.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../readServerMetrics'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import os from "os";
import fs from "fs";
import path from "path";

// Números da máquina lidos de dentro do container da API. Em Linux,
// /proc/stat e /proc/meminfo mostram a VPS inteira; o cgroup mostra só o
// container. Fora do Linux (HM no Mac) cai para o módulo os. Nunca lança:
// o que não der para ler volta null.

export interface CpuTimes {
  idle: number;
  total: number;
}

export interface MetricsSnapshot {
  cpuPercent: number | null;
  cpuCount: number;
  load1: number;
  load5: number;
  load15: number;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  apiMemBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
}

export interface ReadDeps {
  readFile?: (p: string) => Promise<string | null>;
  statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  diskPath?: string;
  sampleMs?: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export const parseProcStat = (text: string): CpuTimes | null => {
  const line = text.split("\n").find(l => l.startsWith("cpu "));
  if (!line) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 4 || n.some(Number.isNaN)) return null;
  // user nice system idle iowait irq softirq steal (guest já está em user)
  const idle = n[3] + (n[4] || 0);
  const total = n.slice(0, 8).reduce((a, b) => a + b, 0);
  return { idle, total };
};

export const cpuPercentBetween = (a: CpuTimes, b: CpuTimes): number | null => {
  const total = b.total - a.total;
  if (total <= 0) return null;
  return round1(100 * (1 - (b.idle - a.idle) / total));
};

export const parseMeminfo = (text: string): { total: number; used: number } | null => {
  const get = (key: string): number | null => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"));
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = get("MemTotal");
  const available = get("MemAvailable");
  if (total === null || available === null) return null;
  return { total, used: total - available };
};

export const parseCgroupMemory = (text: string): number | null => {
  const v = (text || "").trim();
  return /^\d+$/.test(v) ? Number(v) : null;
};

const safeRead = async (p: string): Promise<string | null> => {
  try {
    return await fs.promises.readFile(p, "utf8");
  } catch {
    return null;
  }
};

const osCpuTimes = (): CpuTimes => {
  let idle = 0;
  let total = 0;
  os.cpus().forEach(c => {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  });
  return { idle, total };
};

// Volume de mídias (/app/public em produção), que fica no disco da VPS.
const PUBLIC_FOLDER = path.resolve(__dirname, "..", "..", "..", "public");

export const readServerMetrics = async (deps: ReadDeps = {}): Promise<MetricsSnapshot> => {
  const readFile = deps.readFile || safeRead;
  const statfs = deps.statfs || ((p: string) => fs.promises.statfs(p));
  const diskPath = deps.diskPath || PUBLIC_FOLDER;
  const sampleMs = deps.sampleMs ?? 500;

  const cpuTimes = async (): Promise<CpuTimes | null> => {
    const text = await readFile("/proc/stat");
    return text ? parseProcStat(text) : osCpuTimes();
  };

  const first = await cpuTimes();
  if (sampleMs > 0) await new Promise(r => setTimeout(r, sampleMs));
  const second = await cpuTimes();
  const cpuPercent = first && second ? cpuPercentBetween(first, second) : null;

  const meminfo = await readFile("/proc/meminfo");
  const mem = meminfo ? parseMeminfo(meminfo) : null;
  const memTotalBytes = mem ? mem.total : os.totalmem();
  const memUsedBytes = mem ? mem.used : os.totalmem() - os.freemem();

  const cgroup = await readFile("/sys/fs/cgroup/memory.current");
  const apiMemBytes = (cgroup && parseCgroupMemory(cgroup)) || process.memoryUsage().rss;

  let diskUsedBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const s = await statfs(diskPath);
    diskTotalBytes = s.blocks * s.bsize;
    diskUsedBytes = (s.blocks - s.bavail) * s.bsize;
  } catch {
    // sem disco legível: fica null
  }

  const [load1, load5, load15] = os.loadavg().map(round1);
  return {
    cpuPercent,
    cpuCount: os.cpus().length,
    load1,
    load5,
    load15,
    memUsedBytes,
    memTotalBytes,
    apiMemBytes,
    diskUsedBytes,
    diskTotalBytes
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ServerMonitorServices/__tests__/readServerMetrics.spec.ts --coverage=false`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/ServerMonitorServices/readServerMetrics.ts src/services/ServerMonitorServices/__tests__/readServerMetrics.spec.ts
git commit -m "Monitor: leitura de CPU, memória, load e disco"
```

---

### Task 2: Limites e alertas

**Files:**
- Create: `whatsapp-api/src/services/ServerMonitorServices/alerts.ts`
- Test: `whatsapp-api/src/services/ServerMonitorServices/__tests__/alerts.spec.ts`

**Interfaces:**
- Consumes: `MetricsSnapshot` (Task 1).
- Produces:
  - `type AlertLevel = "warning" | "critical"`
  - `interface Alert { key: string; level: AlertLevel; message: string }`
  - `interface Check { ok: boolean; latencyMs: number | null; error?: string }`
  - `interface QueueStatus { name: string; waiting: number; active: number; delayed: number; failed: number; failedLastHour: number }`
  - `interface ServicesHealth { postgres: Check & { dbSizeBytes: number | null }; redis: Check; queues: QueueStatus[] }`
  - `interface DownConnection { id: number; name: string; companyId: number; companyName: string | null; status: string; since: Date }`
  - `interface ConnectionsStatus { total: number; connected: number; down: DownConnection[] }`
  - `percentLevel(p: number | null): AlertLevel | null`
  - `loadLevel(load5: number, cpuCount: number): AlertLevel | null`
  - `evaluateAlerts(input: { now: MetricsSnapshot; cpuAvg5: number | null; services: ServicesHealth; connections: ConnectionsStatus }): Alert[]`
  - `summarizeAlerts(alerts: Alert[]): { count: number; level: AlertLevel | null }`

- [ ] **Step 1: Write the failing test**

```ts
import { evaluateAlerts, percentLevel, loadLevel, summarizeAlerts } from "../alerts";
import { MetricsSnapshot } from "../readServerMetrics";

const GB = 1024 ** 3;
const snap = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  cpuPercent: 10,
  cpuCount: 4,
  load1: 0.5,
  load5: 0.5,
  load15: 0.5,
  memUsedBytes: 2 * GB,
  memTotalBytes: 8 * GB,
  apiMemBytes: 0.5 * GB,
  diskUsedBytes: 20 * GB,
  diskTotalBytes: 100 * GB,
  ...over
});
const healthy = {
  postgres: { ok: true, latencyMs: 2, dbSizeBytes: GB },
  redis: { ok: true, latencyMs: 1 },
  queues: [{ name: "MessageQueue", waiting: 0, active: 0, delayed: 0, failed: 12, failedLastHour: 0 }]
};
const allConnected = { total: 3, connected: 3, down: [] };
const run = (over: any = {}) =>
  evaluateAlerts({ now: snap(), cpuAvg5: 10, services: healthy, connections: allConnected, ...over });

it("levels percentages at 85 and 95", () => {
  expect(percentLevel(null)).toBeNull();
  expect(percentLevel(84.9)).toBeNull();
  expect(percentLevel(85)).toBe("warning");
  expect(percentLevel(95)).toBe("critical");
});

it("levels load against the vCPU count", () => {
  expect(loadLevel(3.9, 4)).toBeNull();
  expect(loadLevel(4, 4)).toBe("warning");
  expect(loadLevel(8, 4)).toBe("critical");
});

it("is quiet when everything is fine (old queue failures do not count)", () => {
  expect(run()).toEqual([]);
});

it("flags memory, disk, cpu average and load", () => {
  const alerts = run({
    now: snap({ memUsedBytes: 7.7 * GB, diskUsedBytes: 90 * GB, load5: 8.4 }),
    cpuAvg5: 88
  });
  expect(alerts).toEqual([
    { key: "cpu", level: "warning", message: "CPU em 88% (média de 5 min)" },
    { key: "memory", level: "critical", message: "Memória em 96%" },
    { key: "disk", level: "warning", message: "Disco em 90%" },
    { key: "load", level: "critical", message: "Load 8.4 com 4 vCPUs" }
  ]);
});

it("ignores null metrics and missing cpu history", () => {
  expect(run({ now: snap({ memUsedBytes: null, diskTotalBytes: null }), cpuAvg5: null })).toEqual([]);
});

it("flags services down, queue failures in the last hour and down connections", () => {
  const alerts = run({
    services: {
      postgres: { ok: false, latencyMs: null, dbSizeBytes: null, error: "timeout" },
      redis: { ok: false, latencyMs: null, error: "ECONNREFUSED" },
      queues: [{ name: "CampaignQueue", waiting: 0, active: 0, delayed: 0, failed: 3, failedLastHour: 2 }]
    },
    connections: {
      total: 3,
      connected: 1,
      down: [
        { id: 1, name: "A", companyId: 1, companyName: "X", status: "DISCONNECTED", since: new Date() },
        { id: 2, name: "B", companyId: 2, companyName: "Y", status: "qrcode", since: new Date() }
      ]
    }
  });
  expect(alerts.map(a => [a.key, a.level])).toEqual([
    ["postgres", "critical"],
    ["redis", "critical"],
    ["queue:CampaignQueue", "warning"],
    ["connections", "warning"]
  ]);
  expect(alerts[3].message).toBe("2 conexões do WhatsApp fora do ar");
});

it("summarizes by the worst level", () => {
  expect(summarizeAlerts([])).toEqual({ count: 0, level: null });
  expect(
    summarizeAlerts([
      { key: "a", level: "warning", message: "" },
      { key: "b", level: "critical", message: "" }
    ])
  ).toEqual({ count: 2, level: "critical" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ServerMonitorServices/__tests__/alerts.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../alerts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { MetricsSnapshot } from "./readServerMetrics";

// Limites do monitor. Constantes de propósito: não são configuráveis pela tela.
export const PERCENT_WARNING = 85;
export const PERCENT_CRITICAL = 95;

export type AlertLevel = "warning" | "critical";

export interface Alert {
  key: string;
  level: AlertLevel;
  message: string;
}

export interface Check {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  failedLastHour: number;
}

export interface ServicesHealth {
  postgres: Check & { dbSizeBytes: number | null };
  redis: Check;
  queues: QueueStatus[];
}

export interface DownConnection {
  id: number;
  name: string;
  companyId: number;
  companyName: string | null;
  status: string;
  since: Date;
}

export interface ConnectionsStatus {
  total: number;
  connected: number;
  down: DownConnection[];
}

export const percentLevel = (p: number | null): AlertLevel | null => {
  if (p === null || p === undefined) return null;
  if (p >= PERCENT_CRITICAL) return "critical";
  if (p >= PERCENT_WARNING) return "warning";
  return null;
};

export const loadLevel = (load5: number, cpuCount: number): AlertLevel | null => {
  if (!cpuCount) return null;
  if (load5 >= 2 * cpuCount) return "critical";
  if (load5 >= cpuCount) return "warning";
  return null;
};

const ratio = (used: number | null, total: number | null): number | null =>
  used === null || total === null || !total ? null : Math.round((100 * used) / total);

export const evaluateAlerts = (input: {
  now: MetricsSnapshot;
  cpuAvg5: number | null;
  services: ServicesHealth;
  connections: ConnectionsStatus;
}): Alert[] => {
  const { now, cpuAvg5, services, connections } = input;
  const alerts: Alert[] = [];
  const push = (key: string, level: AlertLevel | null, message: string) => {
    if (level) alerts.push({ key, level, message });
  };

  const cpu = cpuAvg5 === null ? null : Math.round(cpuAvg5);
  push("cpu", percentLevel(cpu), `CPU em ${cpu}% (média de 5 min)`);
  const mem = ratio(now.memUsedBytes, now.memTotalBytes);
  push("memory", percentLevel(mem), `Memória em ${mem}%`);
  const disk = ratio(now.diskUsedBytes, now.diskTotalBytes);
  push("disk", percentLevel(disk), `Disco em ${disk}%`);
  push("load", loadLevel(now.load5, now.cpuCount), `Load ${now.load5} com ${now.cpuCount} vCPUs`);

  if (!services.postgres.ok) push("postgres", "critical", "Postgres sem resposta");
  if (!services.redis.ok) push("redis", "critical", "Redis sem resposta");
  services.queues
    .filter(q => q.failedLastHour > 0)
    .forEach(q => push(`queue:${q.name}`, "warning", `Fila ${q.name} com ${q.failedLastHour} falha(s) na última hora`));

  const down = connections.down.length;
  if (down > 0) {
    push("connections", "warning", down === 1 ? "1 conexão do WhatsApp fora do ar" : `${down} conexões do WhatsApp fora do ar`);
  }
  return alerts;
};

export const summarizeAlerts = (alerts: Alert[]): { count: number; level: AlertLevel | null } => ({
  count: alerts.length,
  level: alerts.some(a => a.level === "critical") ? "critical" : alerts.length ? "warning" : null
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/ServerMonitorServices/__tests__/alerts.spec.ts --coverage=false`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/ServerMonitorServices/alerts.ts src/services/ServerMonitorServices/__tests__/alerts.spec.ts
git commit -m "Monitor: limites e alertas"
```

---

### Task 3: Tabela ServerMetrics, histórico e cron

**Files:**
- Create: `whatsapp-api/src/database/migrations/20261008210000-create-server-metrics.ts`
- Create: `whatsapp-api/src/models/ServerMetric.ts`
- Create: `whatsapp-api/src/services/ServerMonitorServices/metricsHistory.ts`
- Modify: `whatsapp-api/src/database/index.ts` (import + incluir `ServerMetric` na lista `models`, depois de `SystemLog`)
- Modify: `whatsapp-api/src/server.ts` (dois `cron.schedule`)
- Test: `whatsapp-api/src/services/ServerMonitorServices/__tests__/metricsHistory.spec.ts`

**Interfaces:**
- Consumes: `readServerMetrics`, `MetricsSnapshot` (Task 1).
- Produces:
  - model `ServerMetric` (colunas = campos de `MetricsSnapshot` exceto `cpuCount`, mais `id`, `createdAt`)
  - `clampHours(raw: unknown): number` (padrão 24, 1..168)
  - `downsample<T>(rows: T[], max?: number): T[]` (padrão 300, mantém o último)
  - `averageCpu(rows: { cpuPercent: number | null }[]): number | null`
  - `recordServerMetrics(read?: () => Promise<MetricsSnapshot>): Promise<void>`
  - `purgeServerMetrics(now?: Date): Promise<number>` (apaga > 7 dias)
  - `getMetricsHistory(hours: number, now?: Date): Promise<object[]>`
  - `getCpuAverage5(now?: Date): Promise<number | null>`

- [ ] **Step 1: Write the failing test**

```ts
import { Op } from "sequelize";

const destroy = jest.fn();
const create = jest.fn();
const findAll = jest.fn();
jest.mock("../../../models/ServerMetric", () => ({
  __esModule: true,
  default: {
    destroy: (...a: any[]) => destroy(...a),
    create: (...a: any[]) => create(...a),
    findAll: (...a: any[]) => findAll(...a)
  }
}));
// eslint-disable-next-line import/first
import {
  clampHours,
  downsample,
  averageCpu,
  recordServerMetrics,
  purgeServerMetrics,
  getMetricsHistory,
  getCpuAverage5
} from "../metricsHistory";

const NOW = new Date("2026-10-08T12:00:00Z");

it("clamps the hours parameter", () => {
  expect(clampHours(undefined)).toBe(24);
  expect(clampHours("abc")).toBe(24);
  expect(clampHours("0")).toBe(24);
  expect(clampHours("-5")).toBe(24);
  expect(clampHours("6")).toBe(6);
  expect(clampHours("9999")).toBe(168);
});

it("downsamples keeping order and the last row", () => {
  const rows = Array.from({ length: 1440 }, (_, i) => i);
  const out = downsample(rows, 300);
  expect(out.length).toBeLessThanOrEqual(300);
  expect(out[0]).toBe(0);
  expect(out[out.length - 1]).toBe(1439);
  expect([...out].sort((a, b) => a - b)).toEqual(out);
  expect(downsample([1, 2, 3], 300)).toEqual([1, 2, 3]);
});

it("averages cpu ignoring nulls and returns null when empty", () => {
  expect(averageCpu([])).toBeNull();
  expect(averageCpu([{ cpuPercent: null }])).toBeNull();
  expect(averageCpu([{ cpuPercent: 80 }, { cpuPercent: null }, { cpuPercent: 90 }])).toBe(85);
});

it("records one row without cpuCount", async () => {
  await recordServerMetrics(async () => ({
    cpuPercent: 12,
    cpuCount: 4,
    load1: 1,
    load5: 1,
    load15: 1,
    memUsedBytes: 1,
    memTotalBytes: 2,
    apiMemBytes: 3,
    diskUsedBytes: 4,
    diskTotalBytes: 5
  }));
  expect(create).toHaveBeenCalledWith({
    cpuPercent: 12,
    load1: 1,
    load5: 1,
    load15: 1,
    memUsedBytes: 1,
    memTotalBytes: 2,
    apiMemBytes: 3,
    diskUsedBytes: 4,
    diskTotalBytes: 5
  });
});

it("purges rows older than 7 days", async () => {
  destroy.mockResolvedValueOnce(42);
  expect(await purgeServerMetrics(NOW)).toBe(42);
  expect(destroy.mock.calls[0][0].where).toEqual({ createdAt: { [Op.lt]: new Date("2026-10-01T12:00:00Z") } });
});

it("reads history since now - hours, ascending", async () => {
  findAll.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
  expect(await getMetricsHistory(24, NOW)).toEqual([{ id: 1 }, { id: 2 }]);
  const arg = findAll.mock.calls[0][0];
  expect(arg.where).toEqual({ createdAt: { [Op.gte]: new Date("2026-10-07T12:00:00Z") } });
  expect(arg.order).toEqual([["createdAt", "ASC"]]);
  expect(arg.raw).toBe(true);
});

it("averages cpu of the last 5 minutes", async () => {
  findAll.mockResolvedValueOnce([{ cpuPercent: 90 }, { cpuPercent: 92 }]);
  expect(await getCpuAverage5(NOW)).toBe(91);
  expect(findAll.mock.calls[0][0].where).toEqual({ createdAt: { [Op.gte]: new Date("2026-10-08T11:55:00Z") } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ServerMonitorServices/__tests__/metricsHistory.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../../../models/ServerMetric'` / `'../metricsHistory'`.

- [ ] **Step 3: Write the migration**

```ts
import { QueryInterface, DataTypes } from "sequelize";

// Uma leitura por minuto do monitor do servidor (CPU, memória, load, disco).
// Retenção de 7 dias pela limpeza diária.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ServerMetrics", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      cpuPercent: { type: DataTypes.FLOAT, allowNull: true },
      load1: { type: DataTypes.FLOAT, allowNull: false },
      load5: { type: DataTypes.FLOAT, allowNull: false },
      load15: { type: DataTypes.FLOAT, allowNull: false },
      memUsedBytes: { type: DataTypes.BIGINT, allowNull: true },
      memTotalBytes: { type: DataTypes.BIGINT, allowNull: true },
      apiMemBytes: { type: DataTypes.BIGINT, allowNull: true },
      diskUsedBytes: { type: DataTypes.BIGINT, allowNull: true },
      diskTotalBytes: { type: DataTypes.BIGINT, allowNull: true }
    });
    await queryInterface.addIndex("ServerMetrics", ["createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ServerMetrics");
  }
};
```

- [ ] **Step 4: Write the model**

```ts
import { Table, Column, Model, PrimaryKey, AutoIncrement, CreatedAt, DataType } from "sequelize-typescript";

@Table({ tableName: "ServerMetrics", updatedAt: false })
class ServerMetric extends Model<ServerMetric> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @CreatedAt
  createdAt: Date;

  @Column(DataType.FLOAT)
  cpuPercent: number;

  @Column(DataType.FLOAT)
  load1: number;

  @Column(DataType.FLOAT)
  load5: number;

  @Column(DataType.FLOAT)
  load15: number;

  @Column(DataType.BIGINT)
  memUsedBytes: number;

  @Column(DataType.BIGINT)
  memTotalBytes: number;

  @Column(DataType.BIGINT)
  apiMemBytes: number;

  @Column(DataType.BIGINT)
  diskUsedBytes: number;

  @Column(DataType.BIGINT)
  diskTotalBytes: number;
}

export default ServerMetric;
```

Em `src/database/index.ts`: adicionar `import ServerMetric from "../models/ServerMetric";` logo abaixo do import de `SystemLog`, e trocar o final da lista `SystemLog` por `SystemLog,\n  ServerMetric`.

- [ ] **Step 5: Write `metricsHistory.ts`**

```ts
import { Op } from "sequelize";
import ServerMetric from "../../models/ServerMetric";
import { MetricsSnapshot, readServerMetrics } from "./readServerMetrics";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const clampHours = (raw: unknown): number => {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(n, 168);
};

// Pega uma a cada k linhas para caber em `max` pontos; o último ponto sempre
// entra, para o gráfico terminar na leitura mais recente.
export const downsample = <T>(rows: T[], max = 300): T[] => {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / (max - 1));
  const out = rows.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
};

export const averageCpu = (rows: { cpuPercent: number | null }[]): number | null => {
  const values = rows.map(r => r.cpuPercent).filter((v): v is number => v !== null && v !== undefined);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + Number(b), 0) / values.length) * 10) / 10;
};

export const recordServerMetrics = async (
  read: () => Promise<MetricsSnapshot> = () => readServerMetrics()
): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cpuCount, ...row } = await read();
  await ServerMetric.create(row as any);
};

export const purgeServerMetrics = async (now = new Date()): Promise<number> =>
  ServerMetric.destroy({ where: { createdAt: { [Op.lt]: new Date(now.getTime() - 7 * DAY) } } });

export const getMetricsHistory = async (hours: number, now = new Date()): Promise<object[]> =>
  ServerMetric.findAll({
    where: { createdAt: { [Op.gte]: new Date(now.getTime() - hours * HOUR) } },
    order: [["createdAt", "ASC"]],
    raw: true
  });

export const getCpuAverage5 = async (now = new Date()): Promise<number | null> => {
  const rows = await ServerMetric.findAll({
    attributes: ["cpuPercent"],
    where: { createdAt: { [Op.gte]: new Date(now.getTime() - 5 * MINUTE) } },
    raw: true
  });
  return averageCpu(rows as any);
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/services/ServerMonitorServices/__tests__/metricsHistory.spec.ts --coverage=false`
Expected: PASS (7 tests).

- [ ] **Step 7: Wire the cron in `src/server.ts`**

Adicionar o import junto aos outros:

```ts
import { purgeServerMetrics, recordServerMetrics } from "./services/ServerMonitorServices/metricsHistory";
```

E, logo depois do `cron.schedule("30 3 * * *", ...)` dos logs:

```ts
cron.schedule("* * * * *", async () => {
  try {
    await recordServerMetrics();
  } catch (error) {
    logger.error({ err: error }, "Leitura do monitor do servidor falhou");
  }
});

cron.schedule("45 3 * * *", async () => {
  try {
    const removed = await purgeServerMetrics();
    logger.info(`Monitor do servidor: ${removed} leituras antigas apagadas`);
  } catch (error) {
    logger.error({ err: error }, "Limpeza do monitor do servidor falhou");
  }
});
```

- [ ] **Step 8: Build, migrate on HM and check**

Run (em `whatsapp-api`): `npx tsc -p . && npx sequelize db:migrate`
Expected: compila sem erro; migration `20261008210000-create-server-metrics` aplicada no Postgres do HM.

- [ ] **Step 9: Commit**

```bash
git add src/database/migrations/20261008210000-create-server-metrics.ts src/models/ServerMetric.ts src/database/index.ts src/services/ServerMonitorServices/metricsHistory.ts src/services/ServerMonitorServices/__tests__/metricsHistory.spec.ts src/server.ts
git commit -m "Monitor: tabela ServerMetrics, gravação por minuto e limpeza diária"
```

---

### Task 4: Saúde dos serviços e conexões do WhatsApp

**Files:**
- Create: `whatsapp-api/src/services/ServerMonitorServices/checkServicesHealth.ts`
- Create: `whatsapp-api/src/services/ServerMonitorServices/listConnectionsStatus.ts`
- Test: `whatsapp-api/src/services/ServerMonitorServices/__tests__/servicesHealth.spec.ts`

**Interfaces:**
- Consumes: `Check`, `QueueStatus`, `ServicesHealth`, `ConnectionsStatus`, `DownConnection` (Task 2).
- Produces:
  - `withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>` (rejeita com `Error("timeout")`)
  - `checkServicesHealth(timeoutMs?: number, now?: Date): Promise<ServicesHealth>`
  - `listConnectionsStatus(): Promise<ConnectionsStatus>`

- [ ] **Step 1: Write the failing test**

```ts
const query = jest.fn();
const ping = jest.fn();
const getJobCounts = jest.fn();
const getFailed = jest.fn();
const whatsappFindAll = jest.fn();

const mockQueue = (name: string) => ({
  name,
  client: { ping: () => ping() },
  getJobCounts: () => getJobCounts(name),
  getFailed: (s: number, e: number) => getFailed(name, s, e)
});

jest.mock("../../../database", () => ({ __esModule: true, default: { query: (...a: any[]) => query(...a) } }));
jest.mock("../../../queues", () => ({
  userMonitor: mockQueue("UserMonitor"),
  messageQueue: mockQueue("MessageQueue")
}));
jest.mock("../../../models/Whatsapp", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => whatsappFindAll(...a) }
}));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import { checkServicesHealth, withTimeout } from "../checkServicesHealth";
// eslint-disable-next-line import/first
import { listConnectionsStatus } from "../listConnectionsStatus";

const NOW = new Date("2026-10-08T12:00:00Z");

beforeEach(() => {
  query.mockImplementation(async (sql: string) =>
    sql.includes("pg_database_size") ? [{ size: "1048576" }] : [{ "?column?": 1 }]
  );
  ping.mockResolvedValue("PONG");
  getJobCounts.mockResolvedValue({ waiting: 1, active: 0, delayed: 2, failed: 5, completed: 9 });
  getFailed.mockResolvedValue([
    { finishedOn: NOW.getTime() - 10 * 60 * 1000 },
    { finishedOn: NOW.getTime() - 3 * 3600 * 1000 }
  ]);
});

it("rejects a promise that never settles after the timeout", async () => {
  await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toThrow("timeout");
});

it("reports postgres, redis and every queue", async () => {
  const h = await checkServicesHealth(1000, NOW);
  expect(h.postgres).toMatchObject({ ok: true, dbSizeBytes: 1048576 });
  expect(typeof h.postgres.latencyMs).toBe("number");
  expect(h.redis).toMatchObject({ ok: true });
  expect(h.queues).toEqual([
    { name: "UserMonitor", waiting: 1, active: 0, delayed: 2, failed: 5, failedLastHour: 1 },
    { name: "MessageQueue", waiting: 1, active: 0, delayed: 2, failed: 5, failedLastHour: 1 }
  ]);
});

it("turns hangs and errors into ok:false without throwing", async () => {
  query.mockImplementation(() => new Promise(() => undefined));
  ping.mockRejectedValue(new Error("ECONNREFUSED"));
  getJobCounts.mockRejectedValue(new Error("ECONNREFUSED"));
  const started = Date.now();
  const h = await checkServicesHealth(50, NOW);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(h.postgres).toEqual({ ok: false, latencyMs: null, dbSizeBytes: null, error: "timeout" });
  expect(h.redis).toEqual({ ok: false, latencyMs: null, error: "ECONNREFUSED" });
  expect(h.queues).toEqual([]);
});

it("lists connections, separating the ones that are not CONNECTED", async () => {
  const since = new Date("2026-10-08T10:00:00Z");
  whatsappFindAll.mockResolvedValue([
    { id: 1, name: "Vendas", status: "CONNECTED", companyId: 1, updatedAt: since, company: { name: "Adra" } },
    { id: 2, name: "Suporte", status: "DISCONNECTED", companyId: 4, updatedAt: since, company: { name: "Loja" } },
    { id: 3, name: "Novo", status: "qrcode", companyId: 4, updatedAt: since, company: null }
  ]);
  expect(await listConnectionsStatus()).toEqual({
    total: 3,
    connected: 1,
    down: [
      { id: 2, name: "Suporte", companyId: 4, companyName: "Loja", status: "DISCONNECTED", since },
      { id: 3, name: "Novo", companyId: 4, companyName: null, status: "qrcode", since }
    ]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/ServerMonitorServices/__tests__/servicesHealth.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../checkServicesHealth'`.

- [ ] **Step 3: Write `checkServicesHealth.ts`**

```ts
import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import * as queues from "../../queues";
import { Check, QueueStatus, ServicesHealth } from "./alerts";

const HOUR = 3600 * 1000;

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const timed = async (fn: () => Promise<unknown>, ms: number): Promise<Check> => {
  const started = Date.now();
  try {
    await withTimeout(fn(), ms);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: null, error: message(err) };
  }
};

// Toda fila Bull exportada por src/queues.ts.
const allQueues = (): any[] =>
  Object.values(queues).filter((q: any) => q && typeof q.getJobCounts === "function");

const queueStatus = async (q: any, ms: number, now: Date): Promise<QueueStatus> => {
  const counts = await withTimeout<any>(q.getJobCounts(), ms);
  const failed = await withTimeout<any[]>(q.getFailed(0, 99), ms);
  const since = now.getTime() - HOUR;
  return {
    name: q.name,
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    delayed: counts.delayed || 0,
    failed: counts.failed || 0,
    failedLastHour: failed.filter(j => j && j.finishedOn >= since).length
  };
};

export const checkServicesHealth = async (timeoutMs = 3000, now = new Date()): Promise<ServicesHealth> => {
  const list = allQueues();

  const [pg, redis, queueResults] = await Promise.all([
    timed(() => sequelize.query("SELECT 1", { type: QueryTypes.SELECT }), timeoutMs),
    list.length
      ? timed(() => list[0].client.ping(), timeoutMs)
      : Promise.resolve<Check>({ ok: false, latencyMs: null, error: "sem filas" }),
    Promise.allSettled(list.map(q => queueStatus(q, timeoutMs, now)))
  ]);

  let dbSizeBytes: number | null = null;
  if (pg.ok) {
    try {
      const [row]: any[] = await withTimeout(
        sequelize.query("SELECT pg_database_size(current_database()) AS size", { type: QueryTypes.SELECT }),
        timeoutMs
      );
      dbSizeBytes = row ? Number(row.size) : null;
    } catch {
      dbSizeBytes = null;
    }
  }

  return {
    postgres: { ...pg, dbSizeBytes },
    redis,
    queues: queueResults
      .filter((r): r is PromiseFulfilledResult<QueueStatus> => r.status === "fulfilled")
      .map(r => r.value)
  };
};
```

- [ ] **Step 4: Write `listConnectionsStatus.ts`**

```ts
import Whatsapp from "../../models/Whatsapp";
import Company from "../../models/Company";
import { ConnectionsStatus } from "./alerts";

// Conexões de todas as empresas. "since" é o updatedAt: a última mudança,
// que para uma conexão caída costuma ser a queda.
export const listConnectionsStatus = async (): Promise<ConnectionsStatus> => {
  const rows: any[] = await Whatsapp.findAll({
    attributes: ["id", "name", "status", "companyId", "updatedAt"],
    include: [{ model: Company, attributes: ["id", "name"] }],
    order: [["companyId", "ASC"], ["name", "ASC"]]
  });
  const down = rows
    .filter(w => w.status !== "CONNECTED")
    .map(w => ({
      id: w.id,
      name: w.name,
      companyId: w.companyId,
      companyName: w.company ? w.company.name : null,
      status: w.status,
      since: w.updatedAt
    }));
  return { total: rows.length, connected: rows.length - down.length, down };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/services/ServerMonitorServices/__tests__/servicesHealth.spec.ts --coverage=false`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/ServerMonitorServices/checkServicesHealth.ts src/services/ServerMonitorServices/listConnectionsStatus.ts src/services/ServerMonitorServices/__tests__/servicesHealth.spec.ts
git commit -m "Monitor: saúde de Postgres, Redis, filas e conexões"
```

---

### Task 5: Serviço agregador, controller e rotas (só super admin)

**Files:**
- Create: `whatsapp-api/src/services/ServerMonitorServices/GetServerMonitorService.ts`
- Create: `whatsapp-api/src/controllers/ServerMonitorController.ts`
- Create: `whatsapp-api/src/routes/serverMonitorRoutes.ts`
- Modify: `whatsapp-api/src/routes/index.ts` (import + `routes.use(serverMonitorRoutes);` logo depois de `routes.use(systemLogRoutes);`)
- Test: `whatsapp-api/src/routes/__tests__/serverMonitorRoutes.spec.ts`

**Interfaces:**
- Consumes: `readServerMetrics` (T1), `evaluateAlerts`, `summarizeAlerts` (T2), `getCpuAverage5`, `getMetricsHistory`, `clampHours`, `downsample` (T3), `checkServicesHealth`, `listConnectionsStatus` (T4).
- Produces (HTTP, todas `isAuth` + `isSuper`):
  - `GET /server-monitor` → `{ now: MetricsSnapshot, cpuAvg5: number|null, services: ServicesHealth, connections: ConnectionsStatus, alerts: Alert[], uptime: { api: number, host: number } }` (segundos)
  - `GET /server-monitor/history?hours=24` → `{ hours: number, points: ServerMetric[] }`
  - `GET /server-monitor/alerts` → `{ count: number, level: "warning"|"critical"|null }`
  - `GetServerMonitorService(): Promise<ServerMonitorResult>`

- [ ] **Step 1: Write the failing test**

```ts
import "express-async-errors";
import express from "express";
import request from "supertest";
import { sign } from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";

const findByPk = jest.fn();
jest.mock("../../models/User", () => ({ __esModule: true, default: { findByPk: (...a: any[]) => findByPk(...a) } }));

const monitor = {
  now: { cpuPercent: 10 },
  cpuAvg5: 10,
  services: {},
  connections: {},
  alerts: [{ key: "disk", level: "warning", message: "Disco em 90%" }],
  uptime: { api: 1, host: 2 }
};
jest.mock("../../services/ServerMonitorServices/GetServerMonitorService", () => ({
  __esModule: true,
  default: jest.fn(async () => monitor)
}));
const getMetricsHistory = jest.fn(async () => [{ id: 1 }]);
jest.mock("../../services/ServerMonitorServices/metricsHistory", () => ({
  ...jest.requireActual("../../services/ServerMonitorServices/metricsHistory"),
  getMetricsHistory: (...a: any[]) => getMetricsHistory(...a)
}));

// eslint-disable-next-line import/first
import serverMonitorRoutes from "../serverMonitorRoutes";

const app = express().use(serverMonitorRoutes);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: err.message }));

const token = sign({ id: 7, profile: "admin", companyId: 1 }, "test-secret", { algorithm: "HS256" });
const auth = { Authorization: `Bearer ${token}` };

it("requires login", async () => {
  expect((await request(app).get("/server-monitor")).status).toBe(401);
});

it("refuses non-super users", async () => {
  findByPk.mockResolvedValue({ id: 7, super: false });
  for (const path of ["/server-monitor", "/server-monitor/history", "/server-monitor/alerts"]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await request(app).get(path).set(auth)).status).toBe(403);
  }
});

describe("super admin", () => {
  beforeEach(() => findByPk.mockResolvedValue({ id: 7, super: true }));

  it("returns the full monitor", async () => {
    const res = await request(app).get("/server-monitor").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(monitor);
  });

  it("returns history with clamped hours", async () => {
    const res = await request(app).get("/server-monitor/history?hours=abc").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hours: 24, points: [{ id: 1 }] });
    expect(getMetricsHistory).toHaveBeenCalledWith(24);
  });

  it("returns only the alert summary", async () => {
    const res = await request(app).get("/server-monitor/alerts").set(auth);
    expect(res.body).toEqual({ count: 1, level: "warning" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/routes/__tests__/serverMonitorRoutes.spec.ts --coverage=false`
Expected: FAIL — `Cannot find module '../serverMonitorRoutes'`.

- [ ] **Step 3: Write `GetServerMonitorService.ts`**

```ts
import os from "os";
import { readServerMetrics, MetricsSnapshot } from "./readServerMetrics";
import { Alert, ConnectionsStatus, ServicesHealth, evaluateAlerts } from "./alerts";
import { getCpuAverage5 } from "./metricsHistory";
import { checkServicesHealth } from "./checkServicesHealth";
import { listConnectionsStatus } from "./listConnectionsStatus";

export interface ServerMonitorResult {
  now: MetricsSnapshot;
  cpuAvg5: number | null;
  services: ServicesHealth;
  connections: ConnectionsStatus;
  alerts: Alert[];
  uptime: { api: number; host: number };
}

const GetServerMonitorService = async (): Promise<ServerMonitorResult> => {
  const [now, cpuAvg5, services, connections] = await Promise.all([
    readServerMetrics(),
    getCpuAverage5().catch(() => null),
    checkServicesHealth(),
    listConnectionsStatus()
  ]);
  return {
    now,
    cpuAvg5,
    services,
    connections,
    alerts: evaluateAlerts({ now, cpuAvg5, services, connections }),
    uptime: { api: Math.round(process.uptime()), host: Math.round(os.uptime()) }
  };
};

export default GetServerMonitorService;
```

- [ ] **Step 4: Write the controller**

```ts
import { Request, Response } from "express";
import GetServerMonitorService from "../services/ServerMonitorServices/GetServerMonitorService";
import { clampHours, downsample, getMetricsHistory } from "../services/ServerMonitorServices/metricsHistory";
import { summarizeAlerts } from "../services/ServerMonitorServices/alerts";

export const index = async (_req: Request, res: Response): Promise<Response> =>
  res.json(await GetServerMonitorService());

export const history = async (req: Request, res: Response): Promise<Response> => {
  const hours = clampHours(req.query.hours);
  const points = downsample(await getMetricsHistory(hours));
  return res.json({ hours, points });
};

export const alerts = async (_req: Request, res: Response): Promise<Response> => {
  const monitor = await GetServerMonitorService();
  return res.json(summarizeAlerts(monitor.alerts));
};
```

- [ ] **Step 5: Write the routes and register them**

`src/routes/serverMonitorRoutes.ts`:

```ts
import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as ServerMonitorController from "../controllers/ServerMonitorController";

const serverMonitorRoutes = Router();

serverMonitorRoutes.get("/server-monitor", isAuth, isSuper, ServerMonitorController.index);
serverMonitorRoutes.get("/server-monitor/history", isAuth, isSuper, ServerMonitorController.history);
serverMonitorRoutes.get("/server-monitor/alerts", isAuth, isSuper, ServerMonitorController.alerts);

export default serverMonitorRoutes;
```

Em `src/routes/index.ts`: `import serverMonitorRoutes from "./serverMonitorRoutes";` junto aos imports e `routes.use(serverMonitorRoutes);` depois de `routes.use(systemLogRoutes);`.

- [ ] **Step 6: Run the test and the whole suite**

Run: `npx jest src/routes/__tests__/serverMonitorRoutes.spec.ts --coverage=false`
Expected: PASS (5 tests).

Run: `npm test -- --coverage=false`
Expected: toda a suíte passa (inclui `openapi.spec.ts`; as rotas novas são internas e não entram na documentação pública — se o teste de openapi reclamar, seguir o que ele faz para `/system-logs`).

- [ ] **Step 7: Build and smoke-test on HM**

Run: `npx tsc -p .` e reiniciar o preview "backend" (conferir com `ps aux | grep "dist/server"` que não sobrou processo antigo). Com o token de um super admin do HM:
`curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/server-monitor | head -c 600`
Expected: JSON com `now.memTotalBytes` > 0, `services.postgres.ok: true`, `services.redis.ok: true`. Depois de 2 minutos, `GET /server-monitor/history` traz ≥ 1 ponto.

- [ ] **Step 8: Commit**

```bash
git add src/services/ServerMonitorServices/GetServerMonitorService.ts src/controllers/ServerMonitorController.ts src/routes/serverMonitorRoutes.ts src/routes/index.ts src/routes/__tests__/serverMonitorRoutes.spec.ts
git commit -m "Monitor: rotas /server-monitor só para super admin"
```

---

### Task 6: Formatação e níveis no painel

**Files (whatsapp-app, branch `feat/server-monitor` criada a partir da `main`):**
- Create: `whatsapp-app/src/components/ServerMonitor/format.js`
- Test: `whatsapp-app/src/components/ServerMonitor/format.test.js`

**Interfaces:**
- Consumes: JSON das rotas da Task 5.
- Produces:
  - `percent(used, total) → number | null` (inteiro)
  - `percentLevel(p) → "ok" | "warning" | "critical" | null` (85/95)
  - `loadLevel(load5, cpuCount) → "ok" | "warning" | "critical"`
  - `formatBytes(n) → string` ("—" para null; "512 MB", "7,7 GB")
  - `formatUptime(seconds) → string` ("3 d 4 h", "5 h 12 min", "8 min")
  - `toChartPoints(points) → { time, cpu, memory, disk, load5 }[]`
  - `connectionStatusLabel(status) → string`

- [ ] **Step 1: Create the branch**

```bash
cd ../whatsapp-app && git checkout main && git checkout -b feat/server-monitor
```

- [ ] **Step 2: Write the failing test**

```js
import {
	percent,
	percentLevel,
	loadLevel,
	formatBytes,
	formatUptime,
	toChartPoints,
	connectionStatusLabel,
} from "./format";

const GB = 1024 ** 3;

it("computes whole percentages and handles missing data", () => {
	expect(percent(6 * GB, 8 * GB)).toBe(75);
	expect(percent(null, 8 * GB)).toBeNull();
	expect(percent(1, 0)).toBeNull();
});

it("levels percentages at 85 and 95", () => {
	expect(percentLevel(null)).toBeNull();
	expect(percentLevel(84)).toBe("ok");
	expect(percentLevel(85)).toBe("warning");
	expect(percentLevel(95)).toBe("critical");
});

it("levels load against vCPUs", () => {
	expect(loadLevel(3.9, 4)).toBe("ok");
	expect(loadLevel(4, 4)).toBe("warning");
	expect(loadLevel(8, 4)).toBe("critical");
});

it("formats bytes in pt-BR", () => {
	expect(formatBytes(null)).toBe("—");
	expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
	expect(formatBytes(7.74 * GB)).toBe("7,7 GB");
});

it("formats uptime", () => {
	expect(formatUptime(8 * 60)).toBe("8 min");
	expect(formatUptime(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
	expect(formatUptime(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
});

it("turns history rows into chart points", () => {
	expect(
		toChartPoints([
			{
				createdAt: "2026-10-08T12:00:00.000Z",
				cpuPercent: 12.5,
				memUsedBytes: 6 * GB,
				memTotalBytes: 8 * GB,
				diskUsedBytes: null,
				diskTotalBytes: null,
				load5: 0.8,
			},
		])
	).toEqual([{ time: Date.parse("2026-10-08T12:00:00.000Z"), cpu: 12.5, memory: 75, disk: null, load5: 0.8 }]);
});

it("labels connection statuses", () => {
	expect(connectionStatusLabel("DISCONNECTED")).toBe("Desconectada");
	expect(connectionStatusLabel("qrcode")).toBe("Aguardando QR Code");
	expect(connectionStatusLabel("OPENING")).toBe("Conectando");
	expect(connectionStatusLabel("XYZ")).toBe("XYZ");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (em `whatsapp-app`): `CI=true npx react-scripts test src/components/ServerMonitor/format.test.js`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 4: Write `format.js`**

```js
// Mesmos limites da API (alerts.ts): aviso 85%, crítico 95%;
// load: aviso no nº de vCPUs, crítico no dobro.
export const percent = (used, total) =>
	used === null || used === undefined || !total ? null : Math.round((100 * used) / total);

export const percentLevel = (p) => {
	if (p === null || p === undefined) return null;
	if (p >= 95) return "critical";
	if (p >= 85) return "warning";
	return "ok";
};

export const loadLevel = (load5, cpuCount) => {
	if (load5 >= 2 * cpuCount) return "critical";
	if (load5 >= cpuCount) return "warning";
	return "ok";
};

const number = (n, digits) =>
	n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatBytes = (n) => {
	if (n === null || n === undefined) return "—";
	const GB = 1024 ** 3;
	const MB = 1024 ** 2;
	if (n >= GB) return `${number(n / GB, 1)} GB`;
	return `${number(n / MB, 0)} MB`;
};

export const formatUptime = (seconds) => {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d} d ${h} h`;
	if (h > 0) return `${h} h ${m} min`;
	return `${m} min`;
};

export const toChartPoints = (points) =>
	(points || []).map((p) => ({
		time: Date.parse(p.createdAt),
		cpu: p.cpuPercent === null || p.cpuPercent === undefined ? null : Number(p.cpuPercent),
		memory: percent(p.memUsedBytes === null ? null : Number(p.memUsedBytes), Number(p.memTotalBytes)),
		disk: percent(p.diskUsedBytes === null ? null : Number(p.diskUsedBytes), Number(p.diskTotalBytes)),
		load5: Number(p.load5),
	}));

const STATUS_LABEL = {
	CONNECTED: "Conectada",
	DISCONNECTED: "Desconectada",
	qrcode: "Aguardando QR Code",
	OPENING: "Conectando",
	PAIRING: "Pareando",
	TIMEOUT: "Sem resposta",
};

export const connectionStatusLabel = (status) => STATUS_LABEL[status] || status;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/components/ServerMonitor/format.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ServerMonitor/format.js src/components/ServerMonitor/format.test.js
git commit -m "Monitor: formatação e níveis do painel"
```

---

### Task 7: Página Monitor do servidor, seção de Configurações e ponto no menu

**Files:**
- Create: `whatsapp-app/src/components/ServerMonitor/index.js`
- Create: `whatsapp-app/src/hooks/useServerAlerts.js`
- Modify: `whatsapp-app/src/pages/SettingsCustom/index.js`
- Modify: `whatsapp-app/src/layout/MainListItems.js`

**Interfaces:**
- Consumes: rotas da Task 5; `format.js` (Task 6); `api` de `src/services/api`; `toastError`; tokens do tema (`theme.tokens.*`, `theme.radii.panel`) como em `components/SystemLogs`.
- Produces: `<ServerMonitor />`; `useServerAlerts(enabled: boolean) → { count, level }`.

- [ ] **Step 1: Write `useServerAlerts.js`**

```js
import { useEffect, useState } from "react";
import api from "../services/api";

// Resumo leve dos alertas do monitor para o ponto do menu. Só consulta para
// super admin; erro de rede apenas mantém o último valor.
const useServerAlerts = (enabled) => {
	const [state, setState] = useState({ count: 0, level: null });

	useEffect(() => {
		if (!enabled) return undefined;
		let alive = true;
		const load = () =>
			api
				.get("/server-monitor/alerts")
				.then(({ data }) => alive && setState(data))
				.catch(() => undefined);
		load();
		const timer = setInterval(load, 60 * 1000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [enabled]);

	return state;
};

export default useServerAlerts;
```

- [ ] **Step 2: Write `components/ServerMonitor/index.js`**

```js
import React, { useCallback, useEffect, useState } from "react";
import moment from "moment";
import clsx from "clsx";
import { makeStyles } from "@material-ui/core/styles";
import { Button } from "@material-ui/core";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip as ChartTooltip,
	XAxis,
	YAxis,
} from "recharts";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import {
	connectionStatusLabel,
	formatBytes,
	formatUptime,
	loadLevel,
	percent,
	percentLevel,
	toChartPoints,
} from "./format";

const useStyles = makeStyles((theme) => {
	const t = theme.tokens;
	return {
		root: { display: "flex", flexDirection: "column", gap: theme.spacing(2), minHeight: 0, overflowY: "auto", ...theme.scrollbarStylesSoft },
		card: { backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: theme.radii.panel, padding: theme.spacing(2, 2.5) },
		head: { display: "flex", alignItems: "center", gap: 12, "& > div": { flex: 1 } },
		title: { margin: 0, fontSize: 18, fontWeight: 700, color: t.textPrimary },
		hint: { margin: "2px 0 0", fontSize: 13, color: t.textTertiary },
		banner: { borderRadius: theme.radii.panel, padding: theme.spacing(1.5, 2), fontSize: 13.5, fontWeight: 600, "& ul": { margin: "4px 0 0", paddingLeft: 18, fontWeight: 400 } },
		bannerWarning: { backgroundColor: theme.palette.warning.light, color: theme.palette.warning.dark || theme.palette.warning.main },
		bannerCritical: { backgroundColor: theme.palette.error.main, color: "#fff" },
		tiles: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, [theme.breakpoints.down("sm")]: { gridTemplateColumns: "repeat(2, 1fr)" } },
		tileLabel: { fontSize: 12.5, color: t.textTertiary },
		tileValue: { display: "block", fontSize: 26, fontWeight: 700, color: t.textPrimary, margin: "2px 0 6px" },
		tileDetail: { fontSize: 12, color: t.textSecondary },
		bar: { height: 6, borderRadius: 3, backgroundColor: t.surfaceMuted, overflow: "hidden", margin: "4px 0 6px", "& span": { display: "block", height: "100%" } },
		ok: { backgroundColor: theme.palette.success.main },
		warning: { backgroundColor: theme.palette.warning.main },
		critical: { backgroundColor: theme.palette.error.main },
		sectionTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: t.textPrimary },
		chart: { height: 260 },
		chartSmall: { height: 160 },
		empty: { padding: 24, textAlign: "center", color: t.textTertiary, fontSize: 13 },
		grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, [theme.breakpoints.down("sm")]: { gridTemplateColumns: "1fr" } },
		table: { width: "100%", borderCollapse: "collapse", fontSize: 13, color: t.textPrimary, "& th": { textAlign: "left", fontWeight: 600, color: t.textSecondary, padding: "6px 8px", borderBottom: `1px solid ${t.border}` }, "& td": { padding: "6px 8px", borderBottom: `1px solid ${t.divider || t.border}` } },
		kv: { display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 12px", fontSize: 13, margin: 0, "& dt": { color: t.textTertiary }, "& dd": { margin: 0 } },
		dot: { display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 6 },
	};
});

const Tile = ({ label, value, level, fill, detail }) => {
	const classes = useStyles();
	return (
		<div className={classes.card}>
			<span className={classes.tileLabel}>{label}</span>
			<strong className={classes.tileValue}>{value}</strong>
			{fill !== null && fill !== undefined && (
				<div className={classes.bar}>
					<span className={classes[level || "ok"]} style={{ width: `${Math.min(100, fill)}%` }} />
				</div>
			)}
			<span className={classes.tileDetail}>{detail}</span>
		</div>
	);
};

const Status = ({ ok, children }) => {
	const classes = useStyles();
	return (
		<span>
			<span className={clsx(classes.dot, ok ? classes.ok : classes.critical)} />
			{children}
		</span>
	);
};

const pct = (p) => (p === null || p === undefined ? "—" : `${Math.round(p)}%`);
const timeTick = (v) => moment(v).format("HH:mm");

const ServerMonitor = () => {
	const classes = useStyles();
	const [data, setData] = useState(null);
	const [history, setHistory] = useState([]);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const { data: monitor } = await api.get("/server-monitor");
			setData(monitor);
		} catch (err) {
			toastError(err);
		}
		setLoading(false);
	}, []);

	const loadHistory = useCallback(async () => {
		try {
			const { data: res } = await api.get("/server-monitor/history", { params: { hours: 24 } });
			setHistory(toChartPoints(res.points));
		} catch (err) {
			toastError(err);
		}
	}, []);

	useEffect(() => {
		load();
		loadHistory();
		const now = setInterval(load, 30 * 1000);
		const hist = setInterval(loadHistory, 5 * 60 * 1000);
		return () => {
			clearInterval(now);
			clearInterval(hist);
		};
	}, [load, loadHistory]);

	const refresh = () => {
		load();
		loadHistory();
	};

	if (!data) {
		return <div className={clsx(classes.card, classes.empty)}>{loading ? "Carregando…" : "Sem dados do servidor."}</div>;
	}

	const { now, cpuAvg5, services, connections, alerts, uptime } = data;
	const memPct = percent(now.memUsedBytes, now.memTotalBytes);
	const diskPct = percent(now.diskUsedBytes, now.diskTotalBytes);
	const critical = alerts.some((a) => a.level === "critical");

	return (
		<div className={classes.root}>
			<div className={clsx(classes.card, classes.head)}>
				<div>
					<h2 className={classes.title}>Monitor do servidor</h2>
					<p className={classes.hint}>Atualiza a cada 30 s. Números da VPS lidos pelo container da API.</p>
				</div>
				<Button variant="outlined" size="small" onClick={refresh} disabled={loading}>
					Atualizar
				</Button>
			</div>

			{alerts.length > 0 && (
				<div className={clsx(classes.banner, critical ? classes.bannerCritical : classes.bannerWarning)}>
					{critical ? "Atenção: há problemas críticos no servidor" : "Avisos do servidor"}
					<ul>
						{alerts.map((a) => (
							<li key={a.key}>{a.message}</li>
						))}
					</ul>
				</div>
			)}

			<div className={classes.tiles}>
				<Tile
					label="CPU"
					value={pct(now.cpuPercent)}
					fill={now.cpuPercent}
					level={percentLevel(cpuAvg5 ?? now.cpuPercent)}
					detail={`Média 5 min: ${pct(cpuAvg5)} · ${now.cpuCount} vCPUs`}
				/>
				<Tile
					label="Memória"
					value={pct(memPct)}
					fill={memPct}
					level={percentLevel(memPct)}
					detail={`${formatBytes(now.memUsedBytes)} de ${formatBytes(now.memTotalBytes)} · API ${formatBytes(now.apiMemBytes)}`}
				/>
				<Tile
					label="Load (1 · 5 · 15 min)"
					value={String(now.load5).replace(".", ",")}
					fill={Math.round((100 * now.load5) / (2 * now.cpuCount))}
					level={loadLevel(now.load5, now.cpuCount)}
					detail={`${now.load1} · ${now.load5} · ${now.load15} de ${now.cpuCount} vCPUs`}
				/>
				<Tile
					label="Disco"
					value={pct(diskPct)}
					fill={diskPct}
					level={percentLevel(diskPct)}
					detail={`${formatBytes(now.diskUsedBytes)} de ${formatBytes(now.diskTotalBytes)}`}
				/>
			</div>

			<div className={classes.card}>
				<h3 className={classes.sectionTitle}>Últimas 24 horas</h3>
				{history.length === 0 ? (
					<div className={classes.empty}>Sem leituras ainda. A primeira aparece em até 1 minuto.</div>
				) : (
					<>
						<div className={classes.chart}>
							<ResponsiveContainer>
								<LineChart data={history}>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={timeTick} />
									<YAxis domain={[0, 100]} unit="%" width={44} />
									<ChartTooltip labelFormatter={(v) => moment(v).format("DD/MM HH:mm")} formatter={(v) => `${v}%`} />
									<Legend />
									<Line type="monotone" dataKey="cpu" name="CPU" stroke="#2563eb" dot={false} connectNulls />
									<Line type="monotone" dataKey="memory" name="Memória" stroke="#16a34a" dot={false} connectNulls />
									<Line type="monotone" dataKey="disk" name="Disco" stroke="#d97706" dot={false} connectNulls />
								</LineChart>
							</ResponsiveContainer>
						</div>
						<div className={classes.chartSmall}>
							<ResponsiveContainer>
								<LineChart data={history}>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={timeTick} />
									<YAxis width={44} />
									<ChartTooltip labelFormatter={(v) => moment(v).format("DD/MM HH:mm")} />
									<Line type="monotone" dataKey="load5" name="Load 5 min" stroke="#7c3aed" dot={false} />
								</LineChart>
							</ResponsiveContainer>
						</div>
					</>
				)}
			</div>

			<div className={classes.grid2}>
				<div className={classes.card}>
					<h3 className={classes.sectionTitle}>Serviços</h3>
					<dl className={classes.kv}>
						<dt>Postgres</dt>
						<dd>
							<Status ok={services.postgres.ok}>
								{services.postgres.ok ? `${services.postgres.latencyMs} ms · banco ${formatBytes(services.postgres.dbSizeBytes)}` : `Sem resposta (${services.postgres.error})`}
							</Status>
						</dd>
						<dt>Redis</dt>
						<dd>
							<Status ok={services.redis.ok}>
								{services.redis.ok ? `${services.redis.latencyMs} ms` : `Sem resposta (${services.redis.error})`}
							</Status>
						</dd>
						<dt>API no ar há</dt>
						<dd>{formatUptime(uptime.api)}</dd>
						<dt>VPS no ar há</dt>
						<dd>{formatUptime(uptime.host)}</dd>
					</dl>
					<table className={classes.table} style={{ marginTop: 12 }}>
						<thead>
							<tr>
								<th>Fila</th>
								<th>Aguardando</th>
								<th>Ativos</th>
								<th>Agendados</th>
								<th>Falhas (1 h)</th>
							</tr>
						</thead>
						<tbody>
							{services.queues.map((q) => (
								<tr key={q.name}>
									<td>{q.name}</td>
									<td>{q.waiting}</td>
									<td>{q.active}</td>
									<td>{q.delayed}</td>
									<td>{q.failedLastHour}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className={classes.card}>
					<h3 className={classes.sectionTitle}>
						WhatsApp — {connections.connected} de {connections.total} conectadas
					</h3>
					{connections.down.length === 0 ? (
						<div className={classes.empty}>Todas as conexões estão conectadas.</div>
					) : (
						<table className={classes.table}>
							<thead>
								<tr>
									<th>Empresa</th>
									<th>Conexão</th>
									<th>Status</th>
									<th>Desde</th>
								</tr>
							</thead>
							<tbody>
								{connections.down.map((c) => (
									<tr key={c.id}>
										<td>{c.companyName || `Empresa ${c.companyId}`}</td>
										<td>{c.name}</td>
										<td>{connectionStatusLabel(c.status)}</td>
										<td>{moment(c.since).format("DD/MM HH:mm")}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>
		</div>
	);
};

export default ServerMonitor;
```

- [ ] **Step 3: Register the section in `pages/SettingsCustom/index.js`**

- Import: `import ServerMonitor from "../../components/ServerMonitor";` abaixo do import de `SystemLogs`.
- Comentário do topo: acrescentar `/settings/monitor` à lista de endereços.
- `SECTIONS`: adicionar `monitor: "monitor",` depois de `logs: "logs",`.
- `SUPER_ONLY`: `["companies", "plans", "logs", "monitor"]`.
- No `useEffect`: `if (!section || section === "logs" || section === "monitor") return;`
- No `switch`: depois do `case "logs"`:

```js
      case "monitor":
        return <ServerMonitor />;
```

- [ ] **Step 4: Add the menu item and alert dot in `layout/MainListItems.js`**

- Import: `import useServerAlerts from "../hooks/useServerAlerts";` e um ícone já existente em `layout/icons` (usar o mesmo `ListIcon` se não houver um de atividade/gráfico; conferir `grep -n "export const" src/layout/icons*`).
- Dentro do componente `MainListItems`, perto dos outros hooks: `const serverAlerts = useServerAlerts(!!user.super);`
- Componente pequeno no arquivo, acima de `MainListItems`:

```js
// Ponto de alerta do monitor do servidor (só super admin).
const AlertDot = ({ level }) =>
  level ? (
    <span
      aria-label={level === "critical" ? "Problema crítico no servidor" : "Aviso do servidor"}
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 6,
        flexShrink: 0,
        backgroundColor: level === "critical" ? "#dc2626" : "#d97706",
      }}
    />
  ) : null;
```

- No item "Configurações", trocar `trailing={chevron(openSettings)}` por:

```js
              trailing={
                <>
                  {user.super && <AlertDot level={serverAlerts.level} />}
                  {chevron(openSettings)}
                </>
              }
```

- No bloco `user.super`, logo depois de "Logs do sistema":

```js
                    <NavItem
                      sub
                      to="/settings/monitor"
                      primary="Monitor do servidor"
                      icon={<ListIcon />}
                      trailing={<AlertDot level={serverAlerts.level} />}
                    />
```

- [ ] **Step 5: Run the app tests**

Run (em `whatsapp-app`): `CI=true npx react-scripts test`
Expected: todos passam (inclui `format.test.js`).

- [ ] **Step 6: Verify on HM in the browser**

Com backend (Task 5) e o preview "frontend" no ar, logado como super admin:
1. Abrir `/settings/monitor`: cartões com números (no Mac, CPU/memória vêm do `os`), serviços com Postgres e Redis verdes, filas listadas, WhatsApp com contagem.
2. Esperar 2 min e clicar "Atualizar": o gráfico mostra pontos.
3. Console sem erros (`read_console_messages`); rede: `/server-monitor` 200.
4. Logar como usuário não super: o item não aparece no menu e `/settings/monitor` redireciona para `/settings`.
5. Tema escuro: conferir contraste dos cartões e da faixa.
6. Screenshot para o usuário.

- [ ] **Step 7: Commit**

```bash
git add src/components/ServerMonitor/index.js src/hooks/useServerAlerts.js src/pages/SettingsCustom/index.js src/layout/MainListItems.js
git commit -m "Monitor do servidor em Configurações (só super admin)"
```

---

### Task 8: Publicar (somente com o "pode publicar" do usuário)

- [ ] **Step 1:** HM: fast-forward das duas `feat/server-monitor` na `main` local, `npx tsc -p .`, `npx sequelize db:migrate`, reiniciar o preview "backend" (conferir processo órfão). Mostrar ao usuário.
- [ ] **Step 2:** Pedir confirmação explícita antes do push na `main` (push = deploy em produção pelo EasyPanel; a migration roda sozinha ao subir a API).
- [ ] **Step 3:** Depois do push, conferir: `curl -s -o /dev/null -w "%{http_code}" https://chatapi.wazzy.com.br/server-monitor` → `401` (rota no ar; `404` = versão antiga — chamar de novo a URL do webhook de deploy). Abrir `chat.wazzy.com.br/settings/monitor` como super admin e conferir disco/memória com o Monitor do EasyPanel.
