import { describe, expect, it } from "vitest";
import { dailyDigestSchedule, dueRun, latestRun, type WeeklySchedule } from "./schedule.ts";

// The week of Sunday 4 October 2026. Riyadh is UTC+3 all year: 07:00 there is 04:00 UTC.
const riyadh = (day: number, time: string) => new Date(`2026-10-${String(day).padStart(2, "0")}T${time}:00+03:00`);
const at7 = (day: number) => riyadh(day, "07:00");

describe("the daily digest's schedule: 07:00 Riyadh, Sunday to Thursday", () => {
  it.each([
    [4, "Sunday"],
    [5, "Monday"],
    [6, "Tuesday"],
    [7, "Wednesday"],
    [8, "Thursday"],
  ])("runs on %s the %sth at 07:00 Riyadh time, 04:00 UTC", (day) => {
    expect(dueRun(dailyDigestSchedule, riyadh(day, "07:00"))).toEqual(at7(day));
    expect(dueRun(dailyDigestSchedule, riyadh(day, "07:30"))).toEqual(at7(day));
    expect(at7(day).toISOString()).toBe(`2026-10-0${day}T04:00:00.000Z`);
  });

  it("is not due before 07:00 Riyadh, even when it is already past 04:00 somewhere else", () => {
    expect(dueRun(dailyDigestSchedule, riyadh(6, "06:59"))).toBeNull();
    // 06:30 Riyadh is 03:30 UTC: the UTC date is the same day, the hour not yet.
    expect(latestRun(dailyDigestSchedule, riyadh(6, "06:30"))).toEqual(at7(5));
  });

  it("follows the Riyadh date, not the UTC one: 01:00 Riyadh on Sunday is still Saturday in UTC", () => {
    const sundayNight = riyadh(4, "01:00");
    expect(sundayNight.getUTCDay()).toBe(6);
    expect(latestRun(dailyDigestSchedule, sundayNight)).toEqual(new Date("2026-10-01T04:00:00Z"));
  });

  it("does not run on Friday or Saturday: the latest run stays Thursday's, so what collects carries over to Sunday", () => {
    for (const time of ["07:00", "12:00", "23:59"]) {
      expect(latestRun(dailyDigestSchedule, riyadh(9, time))).toEqual(at7(8));
      expect(latestRun(dailyDigestSchedule, riyadh(10, time))).toEqual(at7(8));
      expect(dueRun(dailyDigestSchedule, riyadh(9, time))).toBeNull();
      expect(dueRun(dailyDigestSchedule, riyadh(10, time))).toBeNull();
    }
    expect(dueRun(dailyDigestSchedule, riyadh(11, "07:00"))).toEqual(at7(11));
  });

  it("makes up a missed run later the same day (a worker restarted), but never the next day", () => {
    expect(dueRun(dailyDigestSchedule, riyadh(5, "18:59"))).toEqual(at7(5));
    expect(dueRun(dailyDigestSchedule, riyadh(5, "19:01"))).toBeNull();
    // Thursday's run is not made up on Friday morning.
    expect(dueRun(dailyDigestSchedule, riyadh(9, "06:00"))).toBeNull();
  });
});

describe("a weekly schedule", () => {
  const sundays: WeeklySchedule = { days: ["sunday"], hour: 7, minute: 0, timeZone: "Asia/Riyadh" };

  it("on one day runs once a week", () => {
    expect(dueRun(sundays, riyadh(4, "07:05"))).toEqual(at7(4));
    expect(latestRun(sundays, riyadh(10, "23:00"))).toEqual(at7(4));
    expect(dueRun(sundays, riyadh(11, "07:00"))).toEqual(at7(11));
  });

  it("keeps the minute and the time zone", () => {
    const utcMonday: WeeklySchedule = { days: ["monday"], hour: 9, minute: 30, timeZone: "UTC" };
    expect(latestRun(utcMonday, new Date("2026-10-06T00:00:00Z"))).toEqual(new Date("2026-10-05T09:30:00Z"));
  });
});
