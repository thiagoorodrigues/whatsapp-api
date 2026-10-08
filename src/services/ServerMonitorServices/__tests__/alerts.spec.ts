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
