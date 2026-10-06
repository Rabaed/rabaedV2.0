import type { Locale } from "./locale.ts";
import { timeZone } from "./locale.ts";
import type { BilingualText } from "./company.ts";
import { workItemQuery, type WorkItemQuery } from "./work-item-query.ts";

// The weekly Step Age report (RP-359; workflow-engine.md Â§10, visibility.md the
// Step Age reports row and scenario 21). Every Sunday at 07:00 Riyadh time, each
// Member holding the Assign permission on an active Project is emailed the open
// items they can see there, grouped by Step Age: their Participant's items and,
// for the Owner's and Owner Representative's Members, their oversight items.
// Ages are as the recipient sees them (app.step_as_seen): another Company's
// item counts from when it reached that Company, never its internal moves (V14).

/** The hour of Sunday, Riyadh time, the report is sent at. */
const SEND_HOUR = 7;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone,
  weekday: "short",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** `at` as Riyadh's wall clock. */
function riyadh(at: Date) {
  const parts = Object.fromEntries(wallClock.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday!,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * When this week's report is due, while `now` is in the Sunday it is due on
 * (from 07:00 to midnight, Riyadh time); null on any other day, and before 07:00.
 * A worker that was down on Sunday morning still sends it later that day, and
 * never a week late.
 */
export function stepAgeReportDueAt(now: Date): Date | null {
  const t = riyadh(now);
  if (t.weekday !== "Sun" || t.hour < SEND_HOUR) return null;
  // Riyadh's offset from UTC at `now` (whole seconds; the milliseconds aside).
  const offset = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - (now.getTime() - now.getMilliseconds());
  return new Date(Date.UTC(t.year, t.month - 1, t.day, SEND_HOUR) - offset);
}

/** The report's Step Age groups: 4 is "4 weeks or more". */
export const stepAgeReportWeeks = [4, 3, 2, 1] as const;
export type StepAgeReportWeeks = (typeof stepAgeReportWeeks)[number];

/** Items grouped by Step Age, 4+ weeks first; each group keeps the items' order, and an empty one is left out. */
export function stepAgeReportGroups<T extends { stepAgeWeeks: number }>(items: readonly T[]): { weeks: StepAgeReportWeeks; items: T[] }[] {
  return stepAgeReportWeeks
    .map((weeks) => ({ weeks, items: items.filter((i) => Math.min(Math.max(i.stepAgeWeeks, 1), 4) === weeks) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The List query showing the report's items: the open Stages (`openStageKeys`,
 * the Module's Draft and in-progress Stages), oldest first, and with `stepAgeMin`
 * only those at least that many weeks at their Step. The work item query reads
 * through the same visibility and app.step_as_seen as the report.
 */
export function stepAgeReportQuery(openStageKeys: readonly string[], stepAgeMin?: 2 | 3 | 4): WorkItemQuery {
  return workItemQuery.parse({ stage: [...openStageKeys], ...(stepAgeMin === undefined ? {} : { stepAgeMin }) });
}

/** One item of a report, as its recipient may see it. */
export interface StepAgeReportItem {
  workItemId: string;
  /** Null while the item has none (a Draft). */
  documentNumber: string | null;
  subject: string;
  /** The Stage as the recipient sees it (app.step_as_seen). */
  stage: BilingualText;
  /** Who holds it: the recipient's own Company's Step, or another Company by name only (V14). */
  with: { kind: "own"; step: BilingualText } | { kind: "company"; companyName: BilingualText } | null;
  stepAgeWeeks: number;
}

/** One recipient's weekly Step Age report on one Project, ready for the mailer. */
export interface StepAgeReport {
  to: string;
  /** The recipient's preferred language for email, else their locale. */
  language: Locale;
  projectId: string;
  projectName: BilingualText;
  /** The Module's open Stages, for the link to the List (stepAgeReportQuery). */
  openStageKeys: string[];
  /** Oldest first. */
  items: StepAgeReportItem[];
}
