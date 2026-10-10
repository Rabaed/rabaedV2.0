import { z } from "zod";
import { activityFeed } from "./activity-feed.ts";
import { bilingualText } from "./company.ts";
import { moduleKeySchema } from "./module.ts";
import type { OutcomeAction, OutcomePolarity } from "./outcome.ts";
import { projectSummary } from "./project.ts";
import { workItemRow, type TransitionKind, type workItemEventTypes } from "./work-item.ts";

type WorkItemEventType = (typeof workItemEventTypes)[number];

/**
 * Home (RP-407, spec RP-447; visibility.md "Home across Projects"): what needs
 * the Member across their Projects. Every number and row is the sum or merge of
 * a per-Project read the Member already has (the Projects page's Need My Action
 * count, the List's counts and rows, the Activity Feed), over their active
 * Projects only, so Home shows nothing those reads don't.
 */

/** Step Age at or above which an item counts in Home's "4+ weeks at their step" tile. Never a due date. */
export const homeStepAgeWeeks = 4;
/** Rows in the "Needs my action" card, as the design kit shows; the tile counts them all. */
export const homeNeedsMyActionLimit = 4;
/** Entries in "Recent activity", as the design kit shows. */
export const homeActivityLimit = 4;

/**
 * What an activity entry says the person or Company did, in the past tense (the design kit's
 * "approved … (Code B)"): from the event's type, its Transition's kind and, for a Code, the
 * Code's own kind (approval, revise and resubmit, rejection). The Code itself is the entry's `outcome`.
 */
export const homeActivityVerbs = [
  "submitted",
  "sentForReview",
  "returned",
  "sentBack",
  "approved",
  "rejected",
  "returnedForRevision",
  "closed",
  "cancelled",
  "pickedUp",
  "returnedToPool",
  "assigned",
  "recommended",
  "noted",
  "updated",
] as const;
export type HomeActivityVerb = (typeof homeActivityVerbs)[number];

/** The project a Home row belongs to: what its Members see of it on every page. */
const homeProject = z.object({ id: z.uuid(), code: z.string(), name: bilingualText });

export const home = z.object({
  counts: z.object({
    /** The Member's Projects that are not closed. */
    activeProjects: z.number().int().nonnegative(),
    /** The sum of each active Project's Need My Action count: Steps they hold and Steps not picked up of their Step Pool; never a Draft. */
    needMyAction: z.number().int().nonnegative(),
    /** Open items the Member's own Participant holds, at their Step for `homeStepAgeWeeks`+ weeks as the Member sees it (V14); never a Draft. */
    longAtStep: z.number().int().nonnegative(),
    /**
     * "Waiting with others": open items my own Participant raised that another Participant holds now (even
     * one since withdrawn), one per Revision chain, counted by the List's own filters; never a Draft, which
     * my own Participant holds.
     */
    waitingWithOthers: z.number().int().nonnegative(),
  }),
  /** The items behind the Need My Action count, the newest-waiting first, up to `homeNeedsMyActionLimit`. */
  needsMyAction: z.array(workItemRow.extend({ project: homeProject, moduleKey: moduleKeySchema })),
  /** The newest Activity Feed entries across the active Projects, up to `homeActivityLimit`, each with what was done. */
  activity: z.array(activityFeed.shape.entries.element.extend({ project: homeProject, verb: z.enum(homeActivityVerbs) })),
  /** The Member's Projects, as the Projects page lists them. */
  projects: z.array(projectSummary),
  /**
   * Each of the Member's Projects' Submittals they see: the count of its Submittals List (the latest Revision of
   * each chain, open and closed), so never an item the List hides. A closed Project's card shows its count too (its List is still theirs to read); it adds to no other Home figure.
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

/** The outcome an event issued, as its Type's outcome set defines it (outcome.ts): its polarity and its actions. */
export type HomeActivityOutcome = { polarity: OutcomePolarity; actions: readonly OutcomeAction[] };

/**
 * What an Activity Feed event did, as Home words it: a Code by its own kind (a positive one
 * approved; a negative one that offers a Revision, such as Code C, returned for revision; any
 * other negative one, such as Code D, rejected), a Transition by its kind, any other event by
 * its type.
 */
export function homeActivityVerb(type: WorkItemEventType, kind: TransitionKind | null, outcome: HomeActivityOutcome | null): HomeActivityVerb {
  if (outcome) {
    if (outcome.polarity === "positive") return "approved";
    return outcome.actions.some((a) => a.kind === "offer_revision") ? "returnedForRevision" : "rejected";
  }
  switch (type) {
    case "transition":
    case "issue_code":
      switch (kind) {
        case "submit":
          return "submitted";
        case "send":
          return "sentForReview";
        case "return":
          return "returned";
        case "send_back":
          return "sentBack";
        case "close":
          return "closed";
        case "cancel":
          return "cancelled";
        default:
          return "updated";
      }
    case "cancelled":
      return "cancelled";
    // Events written before RP-512 keep their old type; they read as Pick up and Return to pool.
    case "picked_up":
    case "claimed":
      return "pickedUp";
    case "returned_to_pool":
    case "released":
      return "returnedToPool";
    case "assigned":
    case "admin_reassigned":
      return "assigned";
    case "recommend_code":
      return "recommended";
    case "internal_note":
      return "noted";
    default:
      return "updated";
  }
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

/** The newest `limit` entries of several Projects' feeds (each already newest first), newest first; ties by id. */
export function mergeActivity<T extends { id: string; at: string }>(feeds: readonly (readonly T[])[], limit: number): T[] {
  return feeds
    .flat()
    .toSorted((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, limit);
}
