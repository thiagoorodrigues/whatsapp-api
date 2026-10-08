import { Op } from "sequelize";

const findAll = jest.fn();
const companyFindAll = jest.fn();
const userFindAll = jest.fn();
const query = jest.fn();
jest.mock("../../../models/SystemLog", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAll(...a) } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findAll: (...a: any[]) => companyFindAll(...a) } }));
jest.mock("../../../models/User", () => ({ __esModule: true, default: { findAll: (...a: any[]) => userFindAll(...a) } }));
jest.mock("../../../database", () => ({ __esModule: true, default: { query: (...a: any[]) => query(...a) } }));

// eslint-disable-next-line import/first
import ListSystemLogsService from "../ListSystemLogsService";
// eslint-disable-next-line import/first
import SummarySystemLogsService from "../SummarySystemLogsService";
// eslint-disable-next-line import/first
import { acceptClientLog, resetClientLogLimiter } from "../clientLogLimiter";

const row = (id: number, extra: any = {}) => ({ toJSON: () => ({ id, companyId: 4, userId: 9, ...extra }) });

describe("ListSystemLogsService", () => {
  beforeEach(() => {
    companyFindAll.mockResolvedValue([{ id: 4, name: "Adra" }]);
    userFindAll.mockResolvedValue([{ id: 9, name: "Samuel" }]);
  });
  it("filters, defaults to the last hour and names company and user", async () => {
    findAll.mockResolvedValue([row(2), row(1)]);
    const result = await ListSystemLogsService({ level: "error", source: "api", companyId: "4", status: "500", search: " K7Q ", pageNumber: "1" });
    const options = findAll.mock.calls[0][0];
    expect(options.where).toMatchObject({ level: "error", source: "api", companyId: 4, status: 500 });
    expect(options.where.createdAt[Op.gte].getTime()).toBeGreaterThan(Date.now() - 3600 * 1000 - 5000);
    expect(options.where[Op.or]).toHaveLength(4);
    expect(options.limit).toBe(51);
    expect(options.offset).toBe(0);
    expect(result).toEqual({ hasMore: false, logs: [expect.objectContaining({ id: 2, companyName: "Adra", userName: "Samuel" }), expect.objectContaining({ id: 1 })] });
  });
  it("pages by 50 and reports more", async () => {
    findAll.mockResolvedValue(Array.from({ length: 51 }, (_, i) => row(i)));
    const result = await ListSystemLogsService({ pageNumber: "2", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" });
    expect(findAll.mock.calls[0][0].offset).toBe(50);
    expect(findAll.mock.calls[0][0].where.createdAt[Op.lte]).toEqual(new Date("2026-10-02T00:00:00Z"));
    expect(result.hasMore).toBe(true);
    expect(result.logs).toHaveLength(50);
  });
  it("ignores invalid filters", async () => {
    findAll.mockResolvedValue([]);
    await ListSystemLogsService({ level: "drop table", companyId: "abc", status: "x", from: "ontem" });
    const where = findAll.mock.calls[0][0].where;
    expect(where.level).toBeUndefined();
    expect(where.companyId).toBeUndefined();
    expect(where.status).toBeUndefined();
    expect(where.createdAt[Op.gte]).toBeInstanceOf(Date);
  });
});

describe("SummarySystemLogsService", () => {
  it("counts the last 24 h", async () => {
    query.mockResolvedValue([{ errors: "3", warnings: "10", requests: "1200", avgMs: "84" }]);
    expect(await SummarySystemLogsService()).toEqual({ errors: 3, warnings: 10, requests: 1200, avgMs: 84 });
    query.mockResolvedValue([{ errors: "0", warnings: "0", requests: "0", avgMs: null }]);
    expect((await SummarySystemLogsService()).avgMs).toBeNull();
  });
});

describe("acceptClientLog", () => {
  beforeEach(() => resetClientLogLimiter());
  it("allows 30 per user per minute", () => {
    const now = 1000000;
    for (let i = 0; i < 30; i += 1) expect(acceptClientLog(9, now)).toBe(true);
    expect(acceptClientLog(9, now + 1000)).toBe(false);
    expect(acceptClientLog(8, now + 1000)).toBe(true);
    expect(acceptClientLog(9, now + 61000)).toBe(true);
  });
});
