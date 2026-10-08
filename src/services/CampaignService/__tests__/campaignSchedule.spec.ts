import { sendTimes } from "../campaignSchedule";

const start = new Date("2026-10-08T12:00:00Z");
const gaps = (times: Date[]) => times.map((t, i) => (t.getTime() - (i ? times[i - 1] : start).getTime()) / 1000);

describe("sendTimes", () => {
  it("uses the longer interval after the given number of messages", () => {
    const times = sendTimes(start, 5, { messageInterval: 20, longerIntervalAfter: 3, greaterInterval: 60 });
    expect(gaps(times)).toEqual([20, 20, 20, 60, 60]);
  });

  it("never uses the longer interval when it is disabled (0)", () => {
    const times = sendTimes(start, 4, { messageInterval: 5, longerIntervalAfter: 0, greaterInterval: 600 });
    expect(gaps(times)).toEqual([5, 5, 5, 5]);
  });

  it("treats missing or invalid values as no interval", () => {
    const times = sendTimes(start, 2, { messageInterval: undefined as any, longerIntervalAfter: "x" as any, greaterInterval: -1 });
    expect(gaps(times)).toEqual([0, 0]);
  });
});
