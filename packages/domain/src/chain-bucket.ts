import { z } from "zod";
import { isOpenStageCategory, outcomeSets, stageCategories, type WorkItemOutcome } from "./work-item.ts";

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

/**
 * How each key of a condition holds. One entry per key, so a new key can't be
 * added without saying how it holds; the work item query's SQL builder is typed
 * the same way, so it must say it too.
 */
const holds: { [K in keyof ChainBucketCondition]-?: (value: NonNullable<ChainBucketCondition[K]>, input: ChainBucketInput) => boolean } = {
  open: (open, input) => open === isOpenStageCategory(input.stageCategory),
  submitted: (submitted, input) => submitted === input.submitted,
  raisedByViewer: (raised, input) => raised === input.raisedByViewer,
  outcomeKind: (kind, input) => kind === input.outcomeKind,
  outcome: (outcome, input) => outcome === input.outcome,
  stageCategory: (category, input) => category === input.stageCategory,
};

/** Every key a condition may give, each handled by `holdsChainCondition`. */
export const chainConditionKeys = Object.keys(holds) as (keyof ChainBucketCondition)[];

/**
 * V1: nobody but its raiser sees a Revision before it is Submitted. Should
 * anyone else see one, it counts nowhere: in no bucket, nor on the Code C line.
 */
export const unseenBeforeSubmit = { open: true, submitted: false, raisedByViewer: false } as const satisfies ChainBucketCondition;

const codeRules = (outcomeKind: OutcomeKind, outcomes: readonly (WorkItemOutcome & ChainBucket)[]): ChainBucketRule[] =>
  outcomes.map((outcome) => ({ when: { outcomeKind, outcome }, bucket: outcome }));

/** The rule, in order: the first condition that holds gives the bucket. */
export const chainBucketRules: readonly ChainBucketRule[] = [
  { when: unseenBeforeSubmit, bucket: null },
  { when: { open: true, submitted: true }, bucket: "pending" },
  { when: { open: true, raisedByViewer: true }, bucket: "in_preparation" },
  { when: { outcome: "cancelled" }, bucket: "cancelled" },
  { when: { stageCategory: "cancelled" }, bucket: "cancelled" },
  ...codeRules("review_code", outcomeSets.review_code),
  ...codeRules("inspection_result", outcomeSets.inspection_result),
  { when: { stageCategory: "closed_positive" }, bucket: "approved" },
  { when: { stageCategory: "closed_negative" }, bucket: "rejected" },
];

/** Whether every key of `when` holds for `input` (shared with the Code C rule). */
export function holdsChainCondition(when: ChainBucketCondition, input: ChainBucketInput): boolean {
  return Object.entries(when).every(([key, value]) => {
    const holdsKey = holds[key as keyof ChainBucketCondition] as ((value: unknown, input: ChainBucketInput) => boolean) | undefined;
    if (!holdsKey) throw new Error(`Not a chain condition key: ${key}`);
    return value === undefined || holdsKey(value, input);
  });
}

/** The bucket a chain counts in, or null when it counts in none. */
export function chainBucket(input: ChainBucketInput): ChainBucket | null {
  return chainBucketRules.find((rule) => holdsChainCondition(rule.when, input))?.bucket ?? null;
}

/** The buckets of a chain that has been Submitted: every bucket but In preparation (the Approved %'s denominator). */
export const submittedBuckets: readonly ChainBucket[] = chainBuckets.filter((b) => b !== "in_preparation");
