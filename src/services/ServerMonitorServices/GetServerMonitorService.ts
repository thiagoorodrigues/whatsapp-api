import os from "os";
import { readServerMetrics, MetricsSnapshot } from "./readServerMetrics";
import { Alert, ConnectionsStatus, ServicesHealth, evaluateAlerts } from "./alerts";
import { getCpuAverage5 } from "./metricsHistory";
import { checkServicesHealth, withTimeout } from "./checkServicesHealth";
import { listConnectionsStatus } from "./listConnectionsStatus";

export interface ServerMonitorResult {
  now: MetricsSnapshot;
  cpuAvg5: number | null;
  services: ServicesHealth;
  connections: ConnectionsStatus;
  alerts: Alert[];
  uptime: { api: number; host: number };
}

// Página aberta (30 s) e ponto do menu (60 s) em várias abas consultam ao
// mesmo tempo: chamadas simultâneas e dos últimos 15 s dividem um resultado.
const CACHE_MS = 15 * 1000;
let cached: { at: number; promise: Promise<ServerMonitorResult> } | null = null;

export const resetServerMonitorCache = (): void => {
  cached = null;
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const compute = async (timeoutMs: number): Promise<ServerMonitorResult> => {
  // Banco travado não pode derrubar a página que existe para mostrar isso:
  // conexões e média de CPU também têm prazo e viram vazio/null.
  const [now, cpuAvg5, services, connections] = await Promise.all([
    readServerMetrics(),
    withTimeout(getCpuAverage5(), timeoutMs).catch(() => null),
    checkServicesHealth(timeoutMs),
    withTimeout(listConnectionsStatus(), timeoutMs).catch(
      (err): ConnectionsStatus => ({ total: 0, connected: 0, down: [], error: message(err) })
    )
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

const GetServerMonitorService = ({ timeoutMs = 3000 } = {}): Promise<ServerMonitorResult> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = compute(timeoutMs);
  const entry = { at: Date.now(), promise };
  cached = entry;
  promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
};

export default GetServerMonitorService;
