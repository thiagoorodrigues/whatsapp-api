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
