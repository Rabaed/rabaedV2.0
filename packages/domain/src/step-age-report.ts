import type { BilingualText } from "./company.ts";
import type { Locale } from "./locale.ts";
import { workItemQuery, type WorkItemQuery } from "./work-item-query.ts";

// The weekly Step Age report (RP-359; workflow-engine.md §10, visibility.md the
// Step Age reports row and scenario 21). Every Sunday at 07:00 Riyadh time
// (weeklyStepAgeReportSchedule), each Member holding the Assign permission on
// an active Project is emailed the open items they can see there, grouped by
// Step Age: their Participant's items and, for the Owner's and Owner
// Representative's Members, their oversight items. Ages are as the recipient
// sees them (app.step_as_seen): another Company's item counts from when it
// reached that Company, never its internal moves (V14).

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
 * the Module's Draft and in-progress Stages) with a Step Age, so no un-numbered
 * Draft (scenario 76), oldest first; with `stepAgeMin`, only those at least that
 * many weeks at their Step. The work item query reads through the same
 * visibility and app.step_as_seen as the report.
 */
export function stepAgeReportQuery(openStageKeys: readonly string[], stepAgeMin: 1 | 2 | 3 | 4 = 1): WorkItemQuery {
  return workItemQuery.parse({ stage: [...openStageKeys], stepAgeMin });
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
