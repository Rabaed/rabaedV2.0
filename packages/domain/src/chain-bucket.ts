import { z } from "zod";
import { isOpenStageCategory, stageCategories, type WorkItemOutcome } from "./work-item.ts";

/**
 * The bucket a Revision chain counts in on the Dashboard (spec RP-344,
 * visibility.md "Dashboard and Location Status"), by the latest Revision of the
 * chain the viewer sees:
 * - `pending`: open and Submitted, for everyone who sees it;
 * - `in_preparation`: open and not yet Submitted (Draft or internal review), for
 *   the raiser's Participant only (V1);
 * - once closed, its outcome: a Review Code, an Inspection Result, Approved or
 *   Rejected by its Stage for a Type with neither, or Cancelled.
 *
 * The rule is a list of conditions read in order, the first that holds giving
 * the bucket. The work item query turns the same list into its SQL (the
 * `bucket` filter and the Dashboard's counts), so a Dashboard number and the
 * List behind it can't disagree.
 */

/** How a Work Item Type's items end (`work_item_type.outcome_kind`). */
export const outcomeKinds = ["review_code", "inspection_result", "none"] as const;
export type OutcomeKind = (typeof outcomeKinds)[number];

export type StageCategory = (typeof stageCategories)[number];

export const chainBuckets = [
  "pending",
  "in_preparation",
  "A",
  "B",
  "C",
  "D",
  "passed",
  "passed_with_comments",
  "failed",
  "approved",
  "rejected",
  "cancelled",
] as const;
export const chainBucketSchema = z.enum(chainBuckets);
export type ChainBucket = (typeof chainBuckets)[number];

/** What the rule reads: the chain's latest visible Revision, and whether the viewer's Participant raised it. */
export type ChainBucketInput = {
  outcomeKind: OutcomeKind;
  stageCategory: StageCategory;
  outcome: WorkItemOutcome | null;
  /** It has a Submission Date (`submitted_at`). */
  submitted: boolean;
  /** The viewer's own Participant raised it. */
  raisedByViewer: boolean;
};

/** One condition of the rule: every key given must hold. `open` is read from the Stage category. */
export type ChainBucketCondition = {
  open?: boolean;
  submitted?: boolean;
  raisedByViewer?: boolean;
  outcomeKind?: OutcomeKind;
  outcome?: WorkItemOutcome;
  stageCategory?: StageCategory;
};

export type ChainBucketRule = { readonly when: ChainBucketCondition; readonly bucket: ChainBucket | null };

const codeRules = (outcomeKind: OutcomeKind, outcomes: readonly (WorkItemOutcome & ChainBucket)[]): ChainBucketRule[] =>
  outcomes.map((outcome) => ({ when: { outcomeKind, outcome }, bucket: outcome }));

/** The rule, in order: the first condition that holds gives the bucket. */
export const chainBucketRules: readonly ChainBucketRule[] = [
  { when: { open: true, submitted: true }, bucket: "pending" },
  { when: { open: true, raisedByViewer: true }, bucket: "in_preparation" },
  // Nobody but its raiser sees an item before it is Submitted (V1); should anyone else, it counts nowhere.
  { when: { open: true }, bucket: null },
  { when: { outcome: "cancelled" }, bucket: "cancelled" },
  { when: { stageCategory: "cancelled" }, bucket: "cancelled" },
  ...codeRules("review_code", ["A", "B", "C", "D"]),
  ...codeRules("inspection_result", ["passed", "passed_with_comments", "failed"]),
  { when: { stageCategory: "closed_positive" }, bucket: "approved" },
  { when: { stageCategory: "closed_negative" }, bucket: "rejected" },
];

function holds(when: ChainBucketCondition, input: ChainBucketInput): boolean {
  return (
    (when.open === undefined || when.open === isOpenStageCategory(input.stageCategory)) &&
    (when.submitted === undefined || when.submitted === input.submitted) &&
    (when.raisedByViewer === undefined || when.raisedByViewer === input.raisedByViewer) &&
    (when.outcomeKind === undefined || when.outcomeKind === input.outcomeKind) &&
    (when.outcome === undefined || when.outcome === input.outcome) &&
    (when.stageCategory === undefined || when.stageCategory === input.stageCategory)
  );
}

/** The bucket a chain counts in, or null when it counts in none. */
export function chainBucket(input: ChainBucketInput): ChainBucket | null {
  return chainBucketRules.find((rule) => holds(rule.when, input))?.bucket ?? null;
}
