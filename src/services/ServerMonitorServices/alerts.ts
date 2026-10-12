import { MetricsSnapshot } from "./readServerMetrics";

// Limites do monitor. Constantes de propósito: não são configuráveis pela tela.
export const PERCENT_WARNING = 85;
export const PERCENT_CRITICAL = 95;
// Atraso do consumer do stream do gateway: o gateway guarda 3 dias de eventos.
export const STREAM_LAG_WARNING_MS = 60 * 60 * 1000;

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

// Só existe com o motor whatsmeow.
export interface GatewayStatus extends Check {
  connected: number | null;
  sessions: number | null;
}

export interface StreamStatus {
  running: boolean;
  pending: number;
  lagMs: number;
  deadLetters: number;
}

export interface ServicesHealth {
  postgres: Check & { dbSizeBytes: number | null };
  redis: Check;
  queues: QueueStatus[];
  gateway?: GatewayStatus;
  stream?: StreamStatus;
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
  error?: string;
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

  if (services.gateway && !services.gateway.ok) {
    push("gateway", "critical", "Gateway do WhatsApp sem resposta");
  }
  if (services.stream) {
    const { running, lagMs, deadLetters } = services.stream;
    if (!running) push("stream", "critical", "Consumer de eventos do gateway parado");
    if (lagMs >= STREAM_LAG_WARNING_MS) {
      push("stream-lag", "warning", `Eventos do gateway atrasados em ${Math.round(lagMs / 60000)} min`);
    }
    if (deadLetters > 0) {
      push("stream-dead", "warning", `${deadLetters} evento(s) do gateway na fila de falhas (wa:dead)`);
    }
  }

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
