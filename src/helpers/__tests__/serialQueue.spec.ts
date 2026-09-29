import { SerialQueue, queueFor } from "../serialQueue";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("SerialQueue", () => {
  it("runs tasks one at a time, in order", async () => {
    const queue = new SerialQueue("test");
    const order: string[] = [];
    queue.push(async () => { await sleep(20); order.push("a"); });
    queue.push(async () => { order.push("b"); });
    queue.push(async () => { await sleep(5); order.push("c"); });
    await queue.idle();
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("keeps going after a task throws, async or sync", async () => {
    const onError = jest.fn();
    const queue = new SerialQueue("test", { onError });
    const order: string[] = [];
    queue.push(async () => { throw new Error("boom"); });
    queue.push(() => { throw new Error("sync"); });
    queue.push(async () => { order.push("after"); });
    await queue.idle();
    expect(order).toEqual(["after"]);
    expect(onError.mock.calls.map(c => c[0].message)).toEqual(["boom", "sync"]);
    expect(queue.size).toBe(0);
  });

  it("keeps going when onError itself throws", async () => {
    const queue = new SerialQueue("test", { onError: () => { throw new Error("logger down"); } });
    const order: string[] = [];
    queue.push(async () => { throw new Error("boom"); });
    queue.push(async () => { order.push("after"); });
    await queue.idle();
    expect(order).toEqual(["after"]);
    expect(queue.size).toBe(0);
  });

  it("gives up on a task that never settles and moves on", async () => {
    const onError = jest.fn();
    const queue = new SerialQueue("test", { onError, taskTimeoutMs: 30 });
    const order: string[] = [];
    queue.push(() => new Promise(() => {}));
    queue.push(async () => { order.push("after"); });
    await queue.idle();
    expect(order).toEqual(["after"]);
    expect(onError.mock.calls[0][0].message).toMatch(/timed out/);
  });

  it("warns once when the backlog crosses the threshold", async () => {
    const onBacklog = jest.fn();
    const queue = new SerialQueue("test", { backlogThreshold: 2, onBacklog });
    queue.push(() => sleep(10));
    queue.push(() => sleep(1));
    queue.push(() => sleep(1));
    expect(onBacklog).toHaveBeenCalledTimes(1);
    expect(onBacklog).toHaveBeenCalledWith(2);
    await queue.idle();
    expect(queue.size).toBe(0);
  });
});

describe("queueFor", () => {
  it("returns the same queue for the same key and keeps the first options", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const a = queueFor("spec-1", { onError: first });
    const b = queueFor("spec-1", { onError: second });
    expect(a).toBe(b);
    b.push(async () => { throw new Error("x"); });
    await b.idle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(queueFor("spec-2")).not.toBe(a);
  });
});
