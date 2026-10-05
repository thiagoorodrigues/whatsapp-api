import Company from "../../models/Company";
import Queue from "../../models/Queue";
import Setting from "../../models/Setting";

export interface WeekSchedule {
  weekdayEn: string;
  startTime: string | null;
  endTime: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const isOpen = (s?: WeekSchedule): s is WeekSchedule & { startTime: string; endTime: string } =>
  !!s && !!s.startTime && !!s.endTime;

const atTime = (base: Date, hhmm: string): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
};

/**
 * First moment at or after `date` inside business hours. A day with empty
 * times is closed; with no open day at all there is no restriction (a
 * follow-up is never held forever).
 */
export const nextBusinessSlot = (date: Date, schedules: WeekSchedule[]): Date => {
  const list = Array.isArray(schedules) ? schedules : [];
  if (!list.some(isOpen)) return date;
  for (let offset = 0; offset <= 7; offset += 1) {
    const dayStart = new Date(date);
    dayStart.setDate(dayStart.getDate() + offset);
    const schedule = list.find(s => s.weekdayEn === WEEKDAYS[dayStart.getDay()]);
    if (isOpen(schedule)) {
      const opens = atTime(dayStart, schedule.startTime);
      const closes = atTime(dayStart, schedule.endTime);
      if (offset > 0) return opens;
      if (date < opens) return opens;
      if (date <= closes) return date;
    }
  }
  return date;
};

// Same choice as the out-of-hours message: company or queue hours.
export const getSchedulesForTicket = async (ticket: { companyId: number; queueId: number | null }): Promise<WeekSchedule[]> => {
  const setting = await Setting.findOne({ where: { companyId: ticket.companyId, key: "scheduleType" } });
  if (setting?.value === "company") {
    const company = await Company.findByPk(ticket.companyId, { attributes: ["schedules"] });
    return (company?.schedules as WeekSchedule[]) || [];
  }
  if (setting?.value === "queue" && ticket.queueId) {
    const queue = await Queue.findOne({ where: { id: ticket.queueId, companyId: ticket.companyId }, attributes: ["schedules"] });
    return (queue?.schedules as WeekSchedule[]) || [];
  }
  return [];
};
