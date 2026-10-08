import "express-async-errors";
import express from "express";
import request from "supertest";
import { sign } from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";

const findByPk = jest.fn();
jest.mock("../../models/User", () => ({ __esModule: true, default: { findByPk: (...a: any[]) => findByPk(...a) } }));

const monitor = {
  now: { cpuPercent: 10 },
  cpuAvg5: 10,
  services: {},
  connections: {},
  alerts: [{ key: "disk", level: "warning", message: "Disco em 90%" }],
  uptime: { api: 1, host: 2 }
};
jest.mock("../../services/ServerMonitorServices/GetServerMonitorService", () => ({
  __esModule: true,
  default: jest.fn(async () => monitor)
}));
const getMetricsHistory = jest.fn(async (..._a: any[]) => [{ id: 1 }]);
jest.mock("../../services/ServerMonitorServices/metricsHistory", () => ({
  ...jest.requireActual("../../services/ServerMonitorServices/metricsHistory"),
  getMetricsHistory: (...a: any[]) => getMetricsHistory(...a)
}));

// eslint-disable-next-line import/first
import serverMonitorRoutes from "../serverMonitorRoutes";

const app = express().use(serverMonitorRoutes);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: err.message }));

const token = sign({ id: 7, profile: "admin", companyId: 1 }, "test-secret", { algorithm: "HS256" });
const auth = { Authorization: `Bearer ${token}` };

it("requires login", async () => {
  expect((await request(app).get("/server-monitor")).status).toBe(401);
});

it("refuses non-super users", async () => {
  findByPk.mockResolvedValue({ id: 7, super: false });
  for (const path of ["/server-monitor", "/server-monitor/history", "/server-monitor/alerts"]) {
    // eslint-disable-next-line no-await-in-loop
    expect((await request(app).get(path).set(auth)).status).toBe(403);
  }
});

describe("super admin", () => {
  beforeEach(() => findByPk.mockResolvedValue({ id: 7, super: true }));

  it("returns the full monitor", async () => {
    const res = await request(app).get("/server-monitor").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(monitor);
  });

  it("returns history with clamped hours", async () => {
    const res = await request(app).get("/server-monitor/history?hours=abc").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hours: 24, points: [{ id: 1 }] });
    expect(getMetricsHistory).toHaveBeenCalledWith(24);
  });

  it("returns only the alert summary", async () => {
    const res = await request(app).get("/server-monitor/alerts").set(auth);
    expect(res.body).toEqual({ count: 1, level: "warning" });
  });
});
