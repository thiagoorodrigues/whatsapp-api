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
