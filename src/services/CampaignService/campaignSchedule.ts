// Campaign settings: intervals in seconds, `longerIntervalAfter` in number of
// messages (0 = never). The first `longerIntervalAfter` messages are spaced
// by `messageInterval`; from then on, by `greaterInterval`.
export interface CampaignIntervals {
  messageInterval: number;
  longerIntervalAfter: number;
  greaterInterval: number;
}

const seconds = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** When each of the `count` messages goes out, starting at `start`. */
export const sendTimes = (start: Date, count: number, intervals: CampaignIntervals): Date[] => {
  const messageInterval = seconds(intervals.messageInterval);
  const greaterInterval = seconds(intervals.greaterInterval);
  const after = Math.floor(seconds(intervals.longerIntervalAfter));

  const times: Date[] = [];
  let at = new Date(start).getTime();
  for (let i = 0; i < count; i += 1) {
    const longer = after > 0 && i >= after;
    at += (longer ? greaterInterval : messageInterval) * 1000;
    times.push(new Date(at));
  }
  return times;
};
