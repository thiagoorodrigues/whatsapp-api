const recordLog = jest.fn();
jest.mock("../../libs/systemLog", () => ({
  recordLog: (...a: any[]) => recordLog(...a),
  newProtocol: () => "ABC234"
}));

// eslint-disable-next-line import/first
import { logger, rawLogger, logEntryFromArgs } from "../logger";
// eslint-disable-next-line import/first
import AppError from "../../errors/AppError";
// eslint-disable-next-line import/first
import { requestContext } from "../../libs/requestContext";

beforeEach(() => recordLog.mockClear());

describe("logger", () => {
  it("records errors with the stack", () => {
    logger.error(new Error("falhou o envio"));
    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({ level: "error", source: "job", message: "falhou o envio", protocol: "ABC234" }));
    expect(recordLog.mock.calls[0][0].detail).toContain("Error: falhou o envio");
  });
  it("records { err } objects and extra text", () => {
    logger.error({ err: new Error("timeout") }, "Fila CampaignQueue job 7 falhou");
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "error", message: "Fila CampaignQueue job 7 falhou: timeout" });
  });
  it("records warnings, not info", () => {
    logger.info("tudo bem");
    logger.warn("fila com 300 pendentes");
    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "warn", message: "fila com 300 pendentes" });
  });
  it("tags logs written during a request with it", () => {
    const req: any = { method: "POST", originalUrl: "/ai-agents/3/test?x=1", user: { companyId: 4, id: "9" } };
    requestContext.run({ req, res: {} as any }, () => logger.error("algo"));
    expect(recordLog.mock.calls[0][0]).toMatchObject({ source: "api", companyId: 4, userId: 9, method: "POST", route: "/ai-agents/3/test" });
  });
  it("rawLogger never records", () => {
    rawLogger.error(new Error("x"));
    expect(recordLog).not.toHaveBeenCalled();
  });
  it("builds a message from mixed arguments", () => {
    expect(logEntryFromArgs("error", ["MessageQueue -> SendMessage: error", "sem conexão"]).message).toBe(
      "MessageQueue -> SendMessage: error sem conexão"
    );
  });
  it("never throws to the caller when recording fails", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    recordLog.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    expect(() => logger.error("algo")).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("puts plain objects in context, not in the message", () => {
    logger.error({ token: "abc", id: 1 }, "x");
    const entry = recordLog.mock.calls[0][0];
    expect(entry.message).toBe("x");
    expect(entry.message).not.toContain("abc");
    expect(entry.context).toEqual({ token: "abc", id: 1 });
  });
  it("puts the rest of { err, ...rest } in context", () => {
    logger.error({ err: new Error("e"), jobId: 7 }, "falhou");
    expect(recordLog.mock.calls[0][0]).toMatchObject({ message: "falhou: e", context: { jobId: 7 } });
  });
  it("finds an Error that is not the first argument", () => {
    logger.error("falhou", new Error("boom"));
    const entry = recordLog.mock.calls[0][0];
    expect(entry.message).toBe("falhou: boom");
    expect(entry.detail).toContain("Error: boom");
  });
  it("records AppError warnings", () => {
    logger.warn(new AppError("ERR_X", 400));
    expect(recordLog.mock.calls[0][0]).toMatchObject({ level: "warn", message: "ERR_X" });
  });
});
