// Run with TZ=America/Sao_Paulo, like the server.
jest.mock("../../../models/Setting", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

// eslint-disable-next-line import/first
import Setting from "../../../models/Setting";
// eslint-disable-next-line import/first
import Company from "../../../models/Company";
// eslint-disable-next-line import/first
import Queue from "../../../models/Queue";
// eslint-disable-next-line import/first
import { nextBusinessSlot, getSchedulesForTicket } from "../businessHours";

const day = (weekdayEn: string, startTime = "08:00", endTime = "18:00") => ({ weekdayEn, startTime, endTime });
const weekdays = [
  day("monday"), day("tuesday"), day("wednesday"), day("thursday"), day("friday"),
  day("saturday", "", ""), day("sunday", "", "")
];
// 2026-10-05 is a Monday (local time, as the server runs with TZ set).
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe("nextBusinessSlot", () => {
  it("keeps a time inside business hours", () => {
    expect(nextBusinessSlot(at(5, 10), weekdays)).toEqual(at(5, 10));
  });
  it("treats the closing minute as open", () => {
    expect(nextBusinessSlot(at(5, 18), weekdays)).toEqual(at(5, 18));
  });
  it("moves an early time to the opening", () => {
    expect(nextBusinessSlot(at(5, 7, 30), weekdays)).toEqual(at(5, 8));
  });
  it("moves a time after closing to the next day's opening", () => {
    expect(nextBusinessSlot(at(5, 19), weekdays)).toEqual(at(6, 8));
  });
  it("skips the weekend", () => {
    expect(nextBusinessSlot(at(9, 19), weekdays)).toEqual(at(12, 8));
    expect(nextBusinessSlot(at(10, 12), weekdays)).toEqual(at(12, 8));
  });
  it("does not hold messages when no day is open", () => {
    expect(nextBusinessSlot(at(10, 3), [])).toEqual(at(10, 3));
    expect(nextBusinessSlot(at(10, 3), [day("monday", "", ""), day("sunday", null as any, null as any)])).toEqual(at(10, 3));
  });
});

describe("getSchedulesForTicket", () => {
  beforeEach(() => jest.clearAllMocks());
  it("uses the company hours when scheduleType is company", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "company" });
    (Company.findByPk as jest.Mock).mockResolvedValue({ schedules: weekdays });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toBe(weekdays);
    expect(Setting.findOne).toHaveBeenCalledWith({ where: { companyId: 4, key: "scheduleType" } });
  });
  it("uses the queue hours of this company when scheduleType is queue", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "queue" });
    (Queue.findOne as jest.Mock).mockResolvedValue({ schedules: weekdays });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toBe(weekdays);
    expect(Queue.findOne).toHaveBeenCalledWith({ where: { id: 3, companyId: 4 }, attributes: ["schedules"] });
  });
  it("has no restriction without a queue, a setting, or a known type", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "queue" });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: null })).toEqual([]);
    (Setting.findOne as jest.Mock).mockResolvedValue(null);
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toEqual([]);
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "disabled" });
    expect(await getSchedulesForTicket({ companyId: 4, queueId: 3 })).toEqual([]);
  });
});
