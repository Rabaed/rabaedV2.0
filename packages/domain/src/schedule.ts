import { timeZone as riyadh } from "./locale.ts";

/**
 * When the worker's scheduled jobs run (spec RP-344): the daily email digest at
 * 07:00 Riyadh, Sunday to Thursday, and the weekly Step Age report on Sunday at
 * 07:00. A schedule names days of the week and a local time in a time zone; the
 * worker asks which run is due now, and runs it once (the database records it).
 */

export const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof weekdays)[number];

export interface WeeklySchedule {
  readonly days: readonly Weekday[];
  /** Local time of day, in `timeZone`. */
  readonly hour: number;
  readonly minute: number;
  readonly timeZone: string;
}

/** The daily digest: 07:00 Riyadh, Sunday to Thursday (the KSA working week). Friday's and Saturday's carry over to Sunday. */
export const dailyDigestSchedule: WeeklySchedule = {
  days: ["sunday", "monday", "tuesday", "wednesday", "thursday"],
  hour: 7,
  minute: 0,
  timeZone: riyadh,
};

/** The weekly Step Age report (RP-359; workflow-engine.md §10): Sunday 07:00 Riyadh. */
export const weeklyStepAgeReportSchedule: WeeklySchedule = {
  days: ["sunday"],
  hour: 7,
  minute: 0,
  timeZone: riyadh,
};

/** How late a missed run may still go (the worker was down at its time): the same working day, never the next. */
export const MAX_LATE_MS = 12 * 3_600_000;

/** The wall-clock date and the offset from UTC (ms) in `timeZone` at `instant`. */
function localParts(instant: Date, timeZone: string): { year: number; month: number; day: number; offsetMs: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return { year: parts.year!, month: parts.month!, day: parts.day!, offsetMs: asUtc - (instant.getTime() - instant.getMilliseconds()) };
}

/** The run of `schedule` at its time on the local date `daysBack` days before `now`'s local date, if that date is one of its days. */
function runOn(schedule: WeeklySchedule, now: Date, daysBack: number): Date | null {
  const today = localParts(now, schedule.timeZone);
  const wallClock = Date.UTC(today.year, today.month - 1, today.day - daysBack, schedule.hour, schedule.minute);
  if (!schedule.days.includes(weekdays[new Date(wallClock).getUTCDay()]!)) return null;
  // The offset at that moment (a zone with daylight saving may differ from today's).
  const guess = wallClock - today.offsetMs;
  return new Date(wallClock - localParts(new Date(guess), schedule.timeZone).offsetMs);
}

/** The latest run of `schedule` at or before `now`. */
export function latestRun(schedule: WeeklySchedule, now: Date): Date {
  for (let daysBack = 0; daysBack <= 7; daysBack++) {
    const run = runOn(schedule, now, daysBack);
    if (run && run.getTime() <= now.getTime()) return run;
  }
  throw new Error("a weekly schedule needs at least one day");
}

/**
 * The run that is due at `now`: the latest one, unless it is more than
 * `MAX_LATE_MS` old (a run missed while the worker was down is not made up the
 * next day). Null when none is due. The caller runs it once per run time.
 */
export function dueRun(schedule: WeeklySchedule, now: Date): Date | null {
  const run = latestRun(schedule, now);
  return now.getTime() - run.getTime() <= MAX_LATE_MS ? run : null;
}

