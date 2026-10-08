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
  const statfs = deps.statfs || ((p: string) => (fs.promises as any).statfs(p)); // @types/node antigo não tem statfs (Node 24 tem)
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
