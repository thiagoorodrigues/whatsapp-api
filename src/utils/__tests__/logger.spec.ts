const recordLog = jest.fn();
jest.mock("../../libs/systemLog", () => ({
  recordLog: (...a: any[]) => recordLog(...a),
  newProtocol: () => "ABC234"
}));

// eslint-disable-next-line import/first
import { logger, rawLogger, logEntryFromArgs } from "../logger";
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
});
