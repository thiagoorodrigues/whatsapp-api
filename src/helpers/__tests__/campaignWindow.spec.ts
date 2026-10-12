import { campaignWindow } from "../campaignWindow";

describe("campaignWindow", () => {
  const now = new Date("2026-10-12T04:13:00.050Z");

  it("takes a campaign whose time passed a moment ago (scheduled for the current minute)", () => {
    const { from, to } = campaignWindow(now);
    const scheduledAt = new Date("2026-10-12T04:13:00.000Z");
    expect(scheduledAt >= from && scheduledAt <= to).toBe(true);
  });

  it("takes a campaign whose time passed while the api was down, up to one hour", () => {
    const { from } = campaignWindow(now);
    expect(from.toISOString()).toBe("2026-10-12T03:13:00.050Z");
  });

  it("still looks one hour ahead", () => {
    const { to } = campaignWindow(now);
    expect(to.toISOString()).toBe("2026-10-12T05:13:00.050Z");
  });
});
