import {
  setStatus,
  getStatus,
  isReady,
  gatewayUp,
  refresh,
  checkHealth,
  startHealthPoll,
  stopHealthPoll,
  resetState
} from "../state";

const client = (over: any = {}) =>
  ({
    health: jest.fn().mockResolvedValue({ status: "ok", connected: 1, sessions: 1 }),
    status: jest.fn().mockResolvedValue({ state: "connected" }),
    ...over
  } as any);

describe("estado das conexões whatsmeow", () => {
  afterEach(() => {
    stopHealthPoll();
    resetState();
    jest.useRealTimers();
  });

  it("só connected deixa isReady verdadeiro", () => {
    expect(isReady(1)).toBe(false);
    for (const s of ["qr", "pair_code", "disconnected", "logged_out"] as const) {
      setStatus(1, s);
      expect(isReady(1)).toBe(false);
    }
    setStatus(1, "connected");
    expect(isReady(1)).toBe(true);
    setStatus(1, "disconnected");
    expect(isReady(1)).toBe(false);
    expect(isReady(2)).toBe(false);
  });

  it("health falho derruba isReady e a volta não reconecta sem evento", async () => {
    const c = client();
    setStatus(1, "connected");
    c.health.mockRejectedValueOnce(new Error("down"));
    await checkHealth(c);
    expect(gatewayUp()).toBe(false);
    expect(isReady(1)).toBe(false);

    await checkHealth(c);
    expect(gatewayUp()).toBe(true);
    expect(isReady(1)).toBe(false);

    setStatus(1, "connected");
    expect(isReady(1)).toBe(true);
  });

  it("refresh consulta o gateway e confirma o estado", async () => {
    const c = client();
    await refresh(1, c);
    expect(c.status).toHaveBeenCalledWith(1);
    expect(isReady(1)).toBe(true);

    c.status.mockResolvedValueOnce({ state: "qr" });
    await refresh(1, c);
    expect(getStatus(1)).toBe("qr");
    expect(isReady(1)).toBe(false);
  });

  it("refresh com falha deixa a conexão não pronta", async () => {
    const c = client({ status: jest.fn().mockRejectedValue(new Error("x")) });
    setStatus(1, "connected");
    await refresh(1, c);
    expect(isReady(1)).toBe(false);
  });

  it("o poll roda a cada intervalo e para com stopHealthPoll", async () => {
    jest.useFakeTimers();
    const c = client();
    startHealthPoll(c, 1000);
    await Promise.resolve();
    expect(c.health).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000);
    expect(c.health).toHaveBeenCalledTimes(2);
    stopHealthPoll();
    jest.advanceTimersByTime(5000);
    expect(c.health).toHaveBeenCalledTimes(2);
  });
});
