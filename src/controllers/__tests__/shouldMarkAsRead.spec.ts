import shouldMarkAsRead from "../../helpers/shouldMarkAsRead";

describe("shouldMarkAsRead", () => {
  it("marks as read by default (opening the conversation)", () => {
    expect(shouldMarkAsRead({})).toBe(true);
    expect(shouldMarkAsRead(undefined)).toBe(true);
  });

  it("skips marking when peeking (markAsRead=false)", () => {
    expect(shouldMarkAsRead({ markAsRead: "false" })).toBe(false);
    expect(shouldMarkAsRead({ markAsRead: false as any })).toBe(false);
  });

  it("keeps marking for any other value", () => {
    expect(shouldMarkAsRead({ markAsRead: "true" })).toBe(true);
    expect(shouldMarkAsRead({ markAsRead: "" })).toBe(true);
  });
});
