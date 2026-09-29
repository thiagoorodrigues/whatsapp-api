import { reconnectDecision } from "../reconnectPolicy";

describe("reconnectDecision", () => {
  it("logs out on loggedOut (401), 402 and forbidden (403)", () => {
    for (const code of [401, 402, 403]) {
      expect(reconnectDecision(code, 0)).toEqual({ action: "logout" });
    }
  });

  it("reconnects immediately on restartRequired (515)", () => {
    expect(reconnectDecision(515, 3)).toEqual({ action: "reconnect", delayMs: 0 });
  });

  it("backs off 2s, 5s, 15s, 30s, 60s and stays at 60s", () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map(attempt => reconnectDecision(408, attempt));
    expect(delays.map(d => d.action === "reconnect" && d.delayMs)).toEqual([2000, 5000, 15000, 30000, 60000, 60000, 60000]);
  });

  it("keeps 406 (client version rejected) on the backoff path, creds intact", () => {
    expect(reconnectDecision(406, 0)).toEqual({ action: "reconnect", delayMs: 2000 });
  });

  it("treats an unknown or missing status as a plain reconnect", () => {
    expect(reconnectDecision(undefined, 0)).toEqual({ action: "reconnect", delayMs: 2000 });
    expect(reconnectDecision(500, 1)).toEqual({ action: "reconnect", delayMs: 5000 });
  });
});
