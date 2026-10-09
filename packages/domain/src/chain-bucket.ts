import { z } from "zod";
import { dashboardBarOutcomes, offersRevision, outcomeCodePattern, type Outcome, type OutcomePolarity } from "./outcome.ts";
import { isOpenStageCategory, stageCategories, type WorkItemOutcome } from "./work-item.ts";

/**
 * The bucket a Revision chain counts in on the Dashboard (spec RP-344,
 * visibility.md "Dashboard and Location Status"), by the latest Revision of the
 * chain the viewer sees:
 * - `pending`: open and Submitted, for everyone who sees it;
 * - `in_preparation`: open and not yet Submitted (Draft or internal review), for
 *   the raiser's Participant only (V1);
 * - once closed, its outcome when that is one of its Type's Dashboard bars
 *   (`dashboardBarOutcomes`: a closing outcome of a set with two or more, such as
 *   a Review Code, an Inspection Result or one a Project Admin added, RP-429);
 *   otherwise Approved or Rejected by its Stage; or Cancelled.
 *
 * The rule is a list of conditions read in order, the first that holds giving
 * the bucket. The work item query turns the same list into its SQL (the
 * `bucket` filter and the Dashboard's counts), so a Dashboard number and the
 * List behind it can't disagree. It reads outcomes by their place in the Type's
 * set (bar, polarity, follow-up actions), never by code.
 */

export type StageCategory = (typeof stageCategories)[number];

/** The buckets that aren't an outcome: open chains, chains counted by their Stage, and cancelled ones. */
export const fixedChainBuckets = ["pending", "in_preparation", "approved", "rejected", "cancelled"] as const;
export type FixedChainBucket = (typeof fixedChainBuckets)[number];

/** A bucket: a fixed one, or an outcome code of the Type's set (an outcome never takes a fixed open bucket's code). */
export const chainBucketSchema = z.string().regex(outcomeCodePattern);
export type ChainBucket = string;

/** What the rule reads: the chain's latest visible Revision, and whether the viewer's Participant raised it. */
export type ChainBucketInput = {
  stageCategory: StageCategory;
  outcome: WorkItemOutcome | null;
  /** It has a Submission Date (`submitted_at`). */
  submitted: boolean;
  /** The viewer's own Participant raised it. */
  raisedByViewer: boolean;
} & ChainOutcomeTraits;

/** What the rule reads of its outcome, from its Type's set (`chainOutcomeTraits`). */
export type ChainOutcomeTraits = {
  /** Its outcome is one of its Type's Dashboard bars (`dashboardBarOutcomes`). */
  outcomeBar: boolean;
  /** Its outcome's polarity; null while open, when cancelled, or for an outcome not in the set. */
  polarity: OutcomePolarity | null;
  /** Its outcome offers the raiser a Revision (Code C). */
  offersRevision: boolean;
};

/** What the rule reads of `outcome` in its Type's set. */
export function chainOutcomeTraits(set: readonly Outcome[], outcome: string | null): ChainOutcomeTraits {
  const found = outcome === null ? undefined : set.find((o) => o.code === outcome);
  if (!found) return { outcomeBar: false, polarity: null, offersRevision: false };
  return { outcomeBar: dashboardBarOutcomes(set).includes(found), polarity: found.polarity, offersRevision: offersRevision(found) };
}

/** One condition of the rule: every key given must hold. `open` is read from the Stage category. */
export type ChainBucketCondition = {
  open?: boolean;
  submitted?: boolean;
  raisedByViewer?: boolean;
  outcome?: WorkItemOutcome;
  stageCategory?: StageCategory;
  outcomeBar?: boolean;
  polarity?: OutcomePolarity;
  offersRevision?: boolean;
};

/** The bucket a rule gives: a fixed one, the chain's own outcome (`outcomeBucket`), or none. */
export const outcomeBucket = { fromOutcome: true } as const;
export type ChainBucketRule = { readonly when: ChainBucketCondition; readonly bucket: FixedChainBucket | typeof outcomeBucket | null };

/**
 * How each key of a condition holds. One entry per key, so a new key can't be
 * added without saying how it holds; the work item query's SQL builder is typed
 * the same way, so it must say it too.
 */
const holds: { [K in keyof ChainBucketCondition]-?: (value: NonNullable<ChainBucketCondition[K]>, input: ChainBucketInput) => boolean } = {
  open: (open, input) => open === isOpenStageCategory(input.stageCategory),
  submitted: (submitted, input) => submitted === input.submitted,
  raisedByViewer: (raised, input) => raised === input.raisedByViewer,
  outcome: (outcome, input) => outcome === input.outcome,
  stageCategory: (category, input) => category === input.stageCategory,
  outcomeBar: (bar, input) => bar === input.outcomeBar,
  polarity: (polarity, input) => polarity === input.polarity,
  offersRevision: (offers, input) => offers === input.offersRevision,
};

/** Every key a condition may give, each handled by `holdsChainCondition`. */
export const chainConditionKeys = Object.keys(holds) as (keyof ChainBucketCondition)[];

/**
 * V1: nobody but its raiser sees a Revision before it is Submitted. Should
 * anyone else see one, it counts nowhere: in no bucket, nor on the Code C line.
 */
export const unseenBeforeSubmit = { open: true, submitted: false, raisedByViewer: false } as const satisfies ChainBucketCondition;

/** The rule, in order: the first condition that holds gives the bucket. */
export const chainBucketRules: readonly ChainBucketRule[] = [
  { when: unseenBeforeSubmit, bucket: null },
  { when: { open: true, submitted: true }, bucket: "pending" },
  { when: { open: true, raisedByViewer: true }, bucket: "in_preparation" },
  { when: { outcome: "cancelled" }, bucket: "cancelled" },
  { when: { stageCategory: "cancelled" }, bucket: "cancelled" },
  { when: { open: false, outcomeBar: true }, bucket: outcomeBucket },
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
  const bucket = chainBucketRules.find((rule) => holdsChainCondition(rule.when, input))?.bucket ?? null;
  return typeof bucket === "object" && bucket !== null ? input.outcome : bucket;
}

/** The buckets of open chains. */
export const openBuckets: readonly ChainBucket[] = ["pending", "in_preparation"];
