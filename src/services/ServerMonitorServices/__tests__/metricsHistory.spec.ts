import { Op } from "sequelize";

const destroy = jest.fn();
const create = jest.fn();
const findAll = jest.fn();
jest.mock("../../../models/ServerMetric", () => ({
  __esModule: true,
  default: {
    destroy: (...a: any[]) => destroy(...a),
    create: (...a: any[]) => create(...a),
    findAll: (...a: any[]) => findAll(...a)
  }
}));
// eslint-disable-next-line import/first
import {
  clampHours,
  downsample,
  averageCpu,
  recordServerMetrics,
  purgeServerMetrics,
  getMetricsHistory,
  getCpuAverage5
} from "../metricsHistory";

const NOW = new Date("2026-10-08T12:00:00Z");

it("clamps the hours parameter", () => {
  expect(clampHours(undefined)).toBe(24);
  expect(clampHours("abc")).toBe(24);
  expect(clampHours("0")).toBe(24);
  expect(clampHours("-5")).toBe(24);
  expect(clampHours("6")).toBe(6);
  expect(clampHours("9999")).toBe(168);
});

it("downsamples keeping order and the last row", () => {
  const rows = Array.from({ length: 1440 }, (_, i) => i);
  const out = downsample(rows, 300);
  expect(out.length).toBeLessThanOrEqual(300);
  expect(out[0]).toBe(0);
  expect(out[out.length - 1]).toBe(1439);
  expect([...out].sort((a, b) => a - b)).toEqual(out);
  expect(downsample([1, 2, 3], 300)).toEqual([1, 2, 3]);
});

it("averages cpu ignoring nulls and returns null when empty", () => {
  expect(averageCpu([])).toBeNull();
  expect(averageCpu([{ cpuPercent: null }])).toBeNull();
  expect(averageCpu([{ cpuPercent: 80 }, { cpuPercent: null }, { cpuPercent: 90 }])).toBe(85);
});

it("records one row without cpuCount", async () => {
  await recordServerMetrics(async () => ({
    cpuPercent: 12,
    cpuCount: 4,
    load1: 1,
    load5: 1,
    load15: 1,
    memUsedBytes: 1,
    memTotalBytes: 2,
    apiMemBytes: 3,
    diskUsedBytes: 4,
    diskTotalBytes: 5
  }));
  expect(create).toHaveBeenCalledWith({
    cpuPercent: 12,
    load1: 1,
    load5: 1,
    load15: 1,
    memUsedBytes: 1,
    memTotalBytes: 2,
    apiMemBytes: 3,
    diskUsedBytes: 4,
    diskTotalBytes: 5
  });
});

it("purges rows older than 7 days", async () => {
  destroy.mockResolvedValueOnce(42);
  expect(await purgeServerMetrics(NOW)).toBe(42);
  expect(destroy.mock.calls[0][0].where).toEqual({ createdAt: { [Op.lt]: new Date("2026-10-01T12:00:00Z") } });
});

it("reads history since now - hours, ascending", async () => {
  findAll.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
  expect(await getMetricsHistory(24, NOW)).toEqual([{ id: 1 }, { id: 2 }]);
  const arg = findAll.mock.calls[0][0];
  expect(arg.where).toEqual({ createdAt: { [Op.gte]: new Date("2026-10-07T12:00:00Z") } });
  expect(arg.order).toEqual([["createdAt", "ASC"]]);
  expect(arg.raw).toBe(true);
});

it("averages cpu of the last 5 minutes", async () => {
  findAll.mockResolvedValueOnce([{ cpuPercent: 90 }, { cpuPercent: 92 }]);
  expect(await getCpuAverage5(NOW)).toBe(91);
  expect(findAll.mock.calls[0][0].where).toEqual({ createdAt: { [Op.gte]: new Date("2026-10-08T11:55:00Z") } });
});
