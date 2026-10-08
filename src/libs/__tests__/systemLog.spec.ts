const bulkCreate = jest.fn();
jest.mock("../../models/SystemLog", () => ({ __esModule: true, default: { bulkCreate: (...a: any[]) => bulkCreate(...a) } }));

// eslint-disable-next-line import/first
import { flushLogs, mask, newProtocol, recordLog, resetLogQueueForTests } from "../systemLog";

beforeEach(() => {
  jest.useFakeTimers();
  bulkCreate.mockReset().mockResolvedValue([]);
  resetLogQueueForTests();
});
afterEach(() => jest.useRealTimers());

describe("newProtocol", () => {
  it("has 6 characters without ambiguous ones", () => {
    for (let i = 0; i < 200; i += 1) expect(newProtocol()).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
  });
});

describe("mask", () => {
  it("hides secrets at any depth, also inside arrays", () => {
    expect(
      mask({ email: "a@b.com", password: "x", nested: { apiKey: "sk", list: [{ Authorization: "Bearer y", ok: 1 }] }, senhaNova: "z" })
    ).toEqual({ email: "a@b.com", password: "***", nested: { apiKey: "***", list: [{ Authorization: "***", ok: 1 }] }, senhaNova: "***" });
  });
  it("cuts long strings and stops at deep nesting", () => {
    expect((mask("a".repeat(2000)) as string).length).toBeLessThanOrEqual(501);
    const deep: any = {}; let cur = deep;
    for (let i = 0; i < 20; i += 1) { cur.n = {}; cur = cur.n; }
    expect(JSON.stringify(mask(deep))).toContain("[…]");
  });
});

describe("recordLog / flushLogs", () => {
  it("writes in batches every 2 s", async () => {
    recordLog({ level: "info", source: "api", message: "GET /x 200" });
    recordLog({ level: "error", source: "job", message: "boom", context: { token: "t" } });
    expect(bulkCreate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    await flushLogs();
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    const rows = bulkCreate.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ level: "error", source: "job", message: "boom", context: { token: "***" } });
    expect(rows[1].createdAt).toBeInstanceOf(Date);
  });
  it("writes right away at 200 entries", async () => {
    for (let i = 0; i < 200; i += 1) recordLog({ level: "info", source: "api", message: `r${i}` });
    await flushLogs();
    expect(bulkCreate.mock.calls[0][0]).toHaveLength(200);
  });
  it("limits sizes", async () => {
    recordLog({ level: "error", source: "api", message: "m".repeat(3000), detail: "d".repeat(20000), context: { big: "x".repeat(400).split("").map(() => "y".repeat(400)) } });
    await flushLogs();
    const [row] = bulkCreate.mock.calls[0][0];
    expect(row.message.length).toBeLessThanOrEqual(1001);
    expect(row.detail.length).toBeLessThanOrEqual(8001);
    expect(JSON.stringify(row.context).length).toBeLessThanOrEqual(4100);
  });
  it("drops past 5000 queued and reports how many", async () => {
    // banco travado: o 1º lote (200) fica em voo, a fila enche até 5000 e o resto (10) é descartado
    bulkCreate.mockImplementation(() => new Promise(() => undefined));
    for (let i = 0; i < 5210; i += 1) recordLog({ level: "info", source: "api", message: `r${i}` });
    resetLogQueueForTests({ keepQueue: true });
    bulkCreate.mockReset().mockResolvedValue([]);
    await flushLogs();
    const rows = bulkCreate.mock.calls.flatMap(c => c[0]);
    expect(rows.some((r: any) => r.level === "warn" && /descartados/.test(r.message))).toBe(true);
  });
  it("never throws when the database fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    bulkCreate.mockRejectedValue(new Error("relation does not exist"));
    recordLog({ level: "error", source: "api", message: "x" });
    await expect(flushLogs()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
