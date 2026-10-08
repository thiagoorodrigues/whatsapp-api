import express from "express";
import request from "supertest";
import "express-async-errors";
import multer from "multer";

const recordLog = jest.fn();
jest.mock("../../libs/systemLog", () => ({ recordLog: (...a: any[]) => recordLog(...a), newProtocol: () => "K7Q2M9" }));
jest.mock("../../utils/logger", () => ({ rawLogger: { warn: jest.fn(), error: jest.fn() }, logger: { warn: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import requestLog from "../requestLog";
// eslint-disable-next-line import/first
import errorHandler from "../errorHandler";
// eslint-disable-next-line import/first
import AppError from "../../errors/AppError";

const app = express();
app.use(express.json());
app.use(requestLog);
app.use((req: any, _res, next) => { req.user = { id: "9", companyId: 4 }; next(); });
app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/ok", (_req, res) => res.json({ ok: true }));
app.get("/system-logs", (_req, res) => res.json([]));
app.post("/app-error", () => { throw new AppError("ERR_NO_SCHEDULE_FOUND", 404); });
app.post("/crash", () => { throw new Error("cannot read property x of undefined"); });
app.post("/upload", () => { throw new multer.MulterError("LIMIT_FILE_SIZE"); });
app.use(errorHandler);

beforeEach(() => recordLog.mockClear());

describe("requestLog + errorHandler", () => {
  it("records a successful request as info", async () => {
    await request(app).get("/ok?token=abc").expect(200);
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "info", source: "api", method: "GET", route: "/ok", status: 200, companyId: 4, userId: 9 });
    expect(recordLog.mock.calls[0][0].durationMs).toEqual(expect.any(Number));
  });
  it("skips the status route, options and the log page itself", async () => {
    await request(app).get("/");
    await request(app).options("/ok");
    await request(app).get("/system-logs");
    expect(recordLog).not.toHaveBeenCalled();
  });
  it("records an AppError once, as warn with code and masked body", async () => {
    const res = await request(app).post("/app-error").send({ id: 1, password: "segredo" }).expect(404);
    expect(res.body).toEqual({ error: "ERR_NO_SCHEDULE_FOUND" });
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "warn", status: 404, code: "ERR_NO_SCHEDULE_FOUND", protocol: "K7Q2M9", route: "/app-error" });
    expect(recordLog.mock.calls[0][0].context.body).toEqual({ id: 1, password: "segredo" }); // mascarado depois, no gravador
  });
  it("answers ERR_INTERNAL with a protocol on unexpected errors", async () => {
    const res = await request(app).post("/crash").expect(500);
    expect(res.body).toEqual({ error: "ERR_INTERNAL", protocol: "K7Q2M9" });
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "error", status: 500, code: "ERR_INTERNAL", message: "cannot read property x of undefined" });
    expect(recordLog.mock.calls[0][0].detail).toContain("Error: cannot read property");
  });
  it("keeps the upload error codes", async () => {
    const res = await request(app).post("/upload").expect(400);
    expect(res.body).toEqual({ error: "ERR_FILE_TOO_LARGE" });
    expect(recordLog).toHaveBeenCalledTimes(1);
  });
});
