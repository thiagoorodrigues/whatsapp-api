import { SerialQueue } from "../serialQueue";

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

  it("keeps going after a task throws", async () => {
    const onError = jest.fn();
    const queue = new SerialQueue("test", { onError });
    const order: string[] = [];
    queue.push(async () => { throw new Error("boom"); });
    queue.push(async () => { order.push("after"); });
    await queue.idle();
    expect(order).toEqual(["after"]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("warns once the backlog passes the threshold", async () => {
    const onBacklog = jest.fn();
    const queue = new SerialQueue("test", { backlogThreshold: 2, onBacklog });
    queue.push(() => sleep(10));
    queue.push(() => sleep(1));
    queue.push(() => sleep(1));
    expect(onBacklog).toHaveBeenCalledWith(3);
    await queue.idle();
    expect(queue.size).toBe(0);
  });
});
