import { createHistoryImporter, importDay, importWindow } from "../historyImport";

const msg = (id: string, isoTime: string): any => ({
  key: { id, remoteJid: "5531999999999@s.whatsapp.net", fromMe: false },
  messageTimestamp: Math.floor(new Date(isoTime).getTime() / 1000),
  message: { conversation: id }
});

const flush = () => new Promise(r => setTimeout(r, 0));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const setup = (over: any = {}) => {
  const handled: string[] = [];
  const logs: string[] = [];
  const deps = {
    load: jest.fn(async () => ({ importMessages: true, initialDate: "2026-09-01", finalDate: "2026-10-10", ...over.conn })),
    exists: jest.fn(async (id: string) => (over.existing || []).includes(id)),
    handle: jest.fn(async (m: any) => {
      if (over.slowMs) await wait(over.slowMs);
      handled.push(m.key.id);
    }),
    finish: jest.fn(async () => undefined),
    log: (s: string) => logs.push(s),
    pauseMs: 0,
    idleMs: 30
  };
  return { importer: createHistoryImporter(deps), deps, handled, logs };
};

describe("importWindow", () => {
  it("reads the dates in Brasília time, including both whole days", () => {
    const w = importWindow("2026-09-01", "2026-10-10")!;
    expect(new Date(w.from).toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-10-11T02:59:59.999Z");
  });
  it("without a final date goes up to now", () => {
    const w = importWindow("2026-09-01", null)!;
    expect(w.to).toBe(Infinity);
  });
  it("needs a valid initial date", () => {
    expect(importWindow(null, "2026-10-10")).toBeNull();
    expect(importWindow("lixo", null)).toBeNull();
  });
});

describe("importDay", () => {
  it("accepts the DATEONLY string or a Date", () => {
    expect(importDay("2026-09-01")).toBe("2026-09-01");
    expect(importDay(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-01");
    expect(importDay(null)).toBeNull();
    expect(importDay(new Date("x"))).toBeNull();
  });
});

describe("createHistoryImporter", () => {
  it("imports only messages in the window that do not exist yet", async () => {
    const { importer, handled, logs } = setup({ existing: ["b"] });
    importer.onBatch([
      msg("a", "2026-09-01T00:30:00-03:00"),
      msg("b", "2026-09-15T10:00:00-03:00"),
      msg("c", "2026-08-31T23:59:00-03:00"),
      msg("d", "2026-10-10T23:30:00-03:00")
    ]);
    await importer.idle();
    expect(handled).toEqual(["a", "d"]);
    expect(logs.join("\n")).toMatch(/2 gravadas, 1 já existiam, 1 fora do período/);
  });

  it("does not finish while batches are still waiting in the queue", async () => {
    const { importer, deps, handled } = setup({ slowMs: 25 });
    // Batch 2 arrives while batch 1 is being processed and takes longer than idleMs.
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")]);
    importer.onBatch([1, 2, 3].map(i => msg(`b${i}`, "2026-09-10T10:00:00-03:00")));
    importer.onBatch([msg("c", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    expect(handled).toEqual(["a", "b1", "b2", "b3", "c"]);
    expect(deps.finish).not.toHaveBeenCalled();
    await wait(60);
    expect(deps.finish).toHaveBeenCalledTimes(1);
  });

  it("a new batch after the queue empties restarts the idle count", async () => {
    const { importer, deps } = setup();
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    await wait(15);
    importer.onBatch([msg("b", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    await wait(20);
    expect(deps.finish).not.toHaveBeenCalled();
    await wait(30);
    expect(deps.finish).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the option is off", async () => {
    const { importer, deps, handled } = setup({ conn: { importMessages: false } });
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    await wait(40);
    expect(handled).toEqual([]);
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("logs and skips when there is no initial date", async () => {
    const { importer, handled, logs } = setup({ conn: { initialDate: null } });
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    expect(handled).toEqual([]);
    expect(logs.join("\n")).toMatch(/sem data inicial/);
  });

  it("cancel stops the idle timer", async () => {
    const { importer, deps } = setup();
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    importer.cancel();
    await wait(40);
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it("a failing message does not stop the batch", async () => {
    const { importer, deps, handled, logs } = setup();
    deps.handle.mockImplementationOnce(async () => { throw new Error("boom"); });
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00"), msg("b", "2026-09-10T10:00:00-03:00")]);
    await importer.idle();
    await flush();
    expect(handled).toEqual(["b"]);
    expect(logs.join("\n")).toMatch(/1 gravadas.*1 com erro/);
  });

  it("runs the batch preparation (contacts) before its messages, even with the option off", async () => {
    const order: string[] = [];
    const { importer, deps } = setup();
    deps.handle.mockImplementation(async (m: any) => { order.push(`msg:${m.key.id}`); });
    importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")], async () => { order.push("contacts"); });
    await importer.idle();
    expect(order).toEqual(["contacts", "msg:a"]);

    const off = setup({ conn: { importMessages: false } });
    const before = jest.fn(async () => undefined);
    off.importer.onBatch([msg("a", "2026-09-10T10:00:00-03:00")], before);
    await off.importer.idle();
    expect(before).toHaveBeenCalled();
  });
});
