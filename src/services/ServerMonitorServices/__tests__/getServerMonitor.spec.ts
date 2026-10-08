const readServerMetrics = jest.fn();
const getCpuAverage5 = jest.fn();
const checkServicesHealth = jest.fn();
const listConnectionsStatus = jest.fn();
jest.mock("../readServerMetrics", () => ({ readServerMetrics: (...a: any[]) => readServerMetrics(...a) }));
jest.mock("../metricsHistory", () => ({ getCpuAverage5: (...a: any[]) => getCpuAverage5(...a) }));
jest.mock("../checkServicesHealth", () => ({
  ...jest.requireActual("../checkServicesHealth"),
  checkServicesHealth: (...a: any[]) => checkServicesHealth(...a)
}));
jest.mock("../listConnectionsStatus", () => ({ listConnectionsStatus: (...a: any[]) => listConnectionsStatus(...a) }));
jest.mock("../../../database", () => ({ __esModule: true, default: {} }));
jest.mock("../../../queues", () => ({}));

// eslint-disable-next-line import/first
import GetServerMonitorService, { resetServerMonitorCache } from "../GetServerMonitorService";

const snap = { cpuPercent: 10, cpuCount: 4, load1: 0, load5: 0, load15: 0, memUsedBytes: 1, memTotalBytes: 10, apiMemBytes: 1, diskUsedBytes: 1, diskTotalBytes: 10 };
const healthy = { postgres: { ok: true, latencyMs: 1, dbSizeBytes: 1 }, redis: { ok: true, latencyMs: 1 }, queues: [] };

beforeEach(() => {
  resetServerMonitorCache();
  readServerMetrics.mockResolvedValue(snap);
  getCpuAverage5.mockResolvedValue(10);
  checkServicesHealth.mockResolvedValue(healthy);
  listConnectionsStatus.mockResolvedValue({ total: 1, connected: 1, down: [] });
});

it("still answers when the database hangs on connections and cpu history", async () => {
  getCpuAverage5.mockImplementation(() => new Promise(() => undefined));
  listConnectionsStatus.mockImplementation(() => new Promise(() => undefined));
  const started = Date.now();
  const r = await GetServerMonitorService({ timeoutMs: 50 });
  expect(Date.now() - started).toBeLessThan(1000);
  expect(r.cpuAvg5).toBeNull();
  expect(r.connections).toEqual({ total: 0, connected: 0, down: [], error: "timeout" });
  expect(r.now).toEqual(snap);
});

it("still answers when connections reject", async () => {
  listConnectionsStatus.mockRejectedValue(new Error("ECONNREFUSED"));
  const r = await GetServerMonitorService({ timeoutMs: 50 });
  expect(r.connections.error).toBe("ECONNREFUSED");
});

it("shares one result for concurrent and recent calls (short cache)", async () => {
  const [a, b] = await Promise.all([GetServerMonitorService(), GetServerMonitorService()]);
  const c = await GetServerMonitorService();
  expect(a).toBe(b);
  expect(c).toBe(a);
  expect(readServerMetrics).toHaveBeenCalledTimes(1);
});

it("does not cache a failure", async () => {
  readServerMetrics.mockRejectedValueOnce(new Error("boom"));
  await expect(GetServerMonitorService()).rejects.toThrow("boom");
  await expect(GetServerMonitorService()).resolves.toMatchObject({ now: snap });
});
