import { z } from "zod";
import { activityFeed } from "./activity-feed.ts";
import { bilingualText } from "./company.ts";
import { moduleKeySchema } from "./module.ts";
import { projectSummary } from "./project.ts";
import { workItemRow, type WorkItemRow } from "./work-item.ts";

/**
 * Home (RP-407, spec RP-447; visibility.md "Home across Projects"): what needs
 * the Member across their Projects. Every number and row is the sum or merge of
 * a per-Project read the Member already has (the Projects page's Need My Action
 * count, the List's rows, the Activity Feed), over their active Projects only,
 * so Home shows nothing those reads don't.
 */

/** Step Age at or above which an item counts in Home's "at their step for 4+ weeks" tile. Never a due date. */
export const homeStepAgeWeeks = 4;
/** Rows in the "Needs my action" list; the tile counts them all, and "View all" shows the rest. */
export const homeNeedsMyActionLimit = 5;
/** Entries in "Recent activity"; "View all" opens a Project's Activity Feed when there are more. */
export const homeActivityLimit = 5;

/** The Project a Home row belongs to: what its Members see of it on every page. */
const homeProject = z.object({ id: z.uuid(), code: z.string(), name: bilingualText });

export const home = z.object({
  counts: z.object({
    /** The Member's Projects that are not closed. */
    activeProjects: z.number().int().nonnegative(),
    /** The sum of each active Project's Need My Action count: Steps they hold and unclaimed Steps of their Step Pool; never a Draft. */
    needMyAction: z.number().int().nonnegative(),
    /** Open items the Member's own Participant holds, at their Step for `homeStepAgeWeeks`+ weeks as the Member sees it (V14); never a Draft. */
    longAtStep: z.number().int().nonnegative(),
    /**
     * "Submitted by my Company, waiting with others": open items my own Participant raised that another
     * Participant holds now (`isWaitingWithOthers`), one per Revision chain, from the List rows I read; never a Draft.
     */
    waitingWithOthers: z.number().int().nonnegative(),
  }),
  /** The items behind the Need My Action count, the newest-waiting first, up to `homeNeedsMyActionLimit`. */
  needsMyAction: z.array(workItemRow.extend({ project: homeProject, moduleKey: moduleKeySchema })),
  /** The newest Activity Feed entries across the active Projects, up to `homeActivityLimit`. */
  activity: z.array(activityFeed.shape.entries.element.extend({ project: homeProject })),
  /** Whether the active Projects' feeds hold more entries than `activity` shows. */
  moreActivity: z.boolean(),
  /** The Member's Projects, as the Projects page lists them. */
  projects: z.array(projectSummary),
  /**
   * Each active Project's Submittals the Member sees: the rows of its Submittals List (the latest Revision of
   * each chain, open and closed), so never an item the List hides. A closed Project has none (it contributes nothing).
   */
  submittals: z.record(z.uuid(), z.number().int().nonnegative()),
});
export type Home = z.infer<typeof home>;
export type HomeWorkItem = Home["needsMyAction"][number];
export type HomeActivityEntry = Home["activity"][number];

/** Home's greeting by the time of day in Saudi Arabia (UTC+3 all year): morning to noon, afternoon to 6 pm, then evening. */
export function homeGreeting(now: Date): "morning" | "afternoon" | "evening" {
  const hour = (now.getUTCHours() + 3) % 24;
  return hour >= 4 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
}

/**
 * Newest-waiting first: the item that reached its Step last comes first. An
 * item with no Step Age (no Document Number yet) has no time to sort by
 * (scenario 61), so it goes last, by Subject then id.
 */
export function byNewestWaiting<T extends { id: string; title: string; stepEnteredAt: string | null }>(a: T, b: T): number {
  if (a.stepEnteredAt !== b.stepEnteredAt) {
    if (a.stepEnteredAt === null) return 1;
    if (b.stepEnteredAt === null) return -1;
    return a.stepEnteredAt < b.stepEnteredAt ? 1 : -1;
  }
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Whether a List row is "Submitted by my Company, waiting with others": open, held by another Company
 * (`with.kind` "company", V14), and raised by my own Participant. The row tells the last by its Creation
 * Date, which only the raiser's Participant reads (visibility.md "Creation Date") and which every item
 * that has left its Draft has; so another Company's item, which I may see but never raised, never counts.
 */
export function isWaitingWithOthers(row: Pick<WorkItemRow, "with" | "creationDate">): boolean {
  return row.with?.kind === "company" && row.creationDate !== null;
}

/** How long ago something happened, as Home's recent activity says it: now, minutes, hours, then the date from a day on. */
export type RelativeAge = { unit: "now" } | { unit: "minutes" | "hours"; count: number } | { unit: "date" };

/** How long before `now` the time `at` was (a time ahead of `now`, from a skewed clock, is "now"). */
export function relativeAge(at: string, now: Date): RelativeAge {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return { unit: "now" };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  if (minutes < 24 * 60) return { unit: "hours", count: Math.floor(minutes / 60) };
  return { unit: "date" };
}

/** The Project with the most of something (Home's "Open board" and "View all"): the first listed on a tie; none when all are zero. */
export function busiestProjectId(counts: readonly (readonly [projectId: string, count: number])[]): string | undefined {
  let best: readonly [string, number] | undefined;
  for (const entry of counts) if (entry[1] > 0 && (!best || entry[1] > best[1])) best = entry;
  return best?.[0];
}

/** The newest `limit` entries of several Projects' feeds (each already newest first), newest first; ties by id. */
export function mergeActivity<T extends { id: string; at: string }>(feeds: readonly (readonly T[])[], limit: number): T[] {
  return feeds
    .flat()
    .toSorted((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, limit);
}
