import { isSameDueDate } from "../UpdateCompanyService";

describe("isSameDueDate", () => {
  it("treats the form date and the stored timestamp of the same day as equal", () => {
    expect(isSameDueDate("2093-03-14", new Date("2093-03-14T03:00:00.000Z"))).toBe(true);
    expect(isSameDueDate("2093-03-14", "2093-03-14T03:00:00.000Z")).toBe(true);
  });

  it("detects a different day", () => {
    expect(isSameDueDate("2093-04-14", new Date("2093-03-14T03:00:00.000Z"))).toBe(false);
  });

  it("handles empty dates", () => {
    expect(isSameDueDate(null, null)).toBe(true);
    expect(isSameDueDate(null, new Date())).toBe(false);
    expect(isSameDueDate("2093-03-14", null)).toBe(false);
  });
});
