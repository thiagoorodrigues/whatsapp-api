const query = jest.fn();
const ping = jest.fn();
const getJobCounts = jest.fn();
const zcount = jest.fn();
const whatsappFindAll = jest.fn();

const mockQueue = (name: string) => ({
  name,
  client: { ping: () => ping(), zcount: (...a: any[]) => zcount(...a) },
  toKey: (k: string) => `bull:${name}:${k}`,
  getJobCounts: () => getJobCounts(name)
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

const gwHealth = jest.fn();
const stats = jest.fn();
jest.mock("../../../channels/whatsmeow/client", () => ({ gatewayClient: () => ({ health: () => gwHealth() }) }));
jest.mock("../../../channels/whatsmeow/consumer", () => ({ consumerStats: () => stats() }));

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
  zcount.mockResolvedValue(1);
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
  // Conta pelo índice do Redis (score = hora da falha), sem carregar os jobs.
  expect(zcount).toHaveBeenCalledWith("bull:MessageQueue:failed", NOW.getTime() - 3600 * 1000, "+inf");
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

describe("gateway no motor whatsmeow", () => {
  afterEach(() => {
    delete process.env.WHATSAPP_ENGINE;
    delete process.env.GATEWAY_URL;
    delete process.env.GATEWAY_TOKEN;
  });

  it("does not add gateway or stream with baileys", async () => {
    const h = await checkServicesHealth(1000, NOW);
    expect(h).not.toHaveProperty("gateway");
    expect(h).not.toHaveProperty("stream");
    expect(gwHealth).not.toHaveBeenCalled();
  });

  it("adds gateway health and stream stats with whatsmeow", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    gwHealth.mockResolvedValue({ status: "ok", connected: 2, sessions: 3 });
    stats.mockResolvedValue({ running: true, consumer: "c", pending: 1, lagMs: 500, deadLetters: 4, connections: [] });
    const h = await checkServicesHealth(1000, NOW);
    expect(h.gateway).toMatchObject({ ok: true, connected: 2, sessions: 3 });
    expect(h.stream).toEqual({ running: true, pending: 1, lagMs: 500, deadLetters: 4 });
  });

  it("reports an unreachable gateway as ok:false", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    gwHealth.mockRejectedValue(new Error("ECONNREFUSED"));
    stats.mockResolvedValue({ running: false, consumer: null, pending: 0, lagMs: 0, deadLetters: 0, connections: [] });
    const h = await checkServicesHealth(1000, NOW);
    expect(h.gateway).toEqual({ ok: false, latencyMs: null, connected: null, sessions: null, error: "ECONNREFUSED" });
  });
});
