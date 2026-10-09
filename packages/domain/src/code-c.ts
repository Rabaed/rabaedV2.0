import { z } from "zod";
import { chainConditionKeys, holdsChainCondition, unseenBeforeSubmit, type ChainBucketCondition, type ChainBucketInput } from "./chain-bucket.ts";

/**
 * The Dashboard's Code C line (RP-352, spec RP-344; visibility.md "Dashboard
 * and Location Status", scenario 64): on a Type whose outcome set has an outcome
 * offering a Revision ("Code C", RP-429), each Revision chain that has had at
 * least one such outcome the viewer sees counts once, by its latest Revision the
 * viewer sees (V1 per Revision):
 * - `approvedOnRevision`: the latest Revision got a positive outcome (Code A or B);
 * - `rejectedAfterC`: the latest Revision got a negative outcome offering no
 *   Revision (Code D);
 * - awaiting revision: the latest is the Code C Revision itself, or an open
 *   Revision. The raiser's own Participant sees it split into
 *   `noRevisionYet` and `revisionInProgress`; every other Company sees one
 *   `awaitingRevision`, so a Revision still in the raiser's Draft is never told
 *   apart (scenario 64).
 * A chain whose latest Revision is cancelled counts nowhere on the line.
 *
 * Like chainBucket, the rule is a list of conditions read in order, and the
 * work item query turns the same list into its SQL (the `codeC` filter and the
 * Dashboard's counts), so a figure and the List behind it can't disagree.
 */

export const codeCStates = ["approvedOnRevision", "awaitingRevision", "noRevisionYet", "revisionInProgress", "rejectedAfterC"] as const;
export type CodeCState = (typeof codeCStates)[number];

/** The `codeC` filter of the work item query: the three sub-states, and the raiser's two halves of awaiting revision. */
export const codeCFilterSchema = z.enum(codeCStates);
export type CodeCFilter = CodeCState;

/** What the rule reads: chainBucket's input, and whether any Revision of the chain the viewer sees got an outcome offering a Revision (Code C). */
export type CodeCInput = ChainBucketInput & { hadCodeC: boolean };

export type CodeCCondition = ChainBucketCondition & { hadCodeC?: boolean };
export type CodeCRule = { readonly when: CodeCCondition; readonly state: CodeCState | null };

/** Every key a Code C condition may give: chainBucket's, and `hadCodeC`. */
export const codeCConditionKeys: readonly (keyof CodeCCondition)[] = [...chainConditionKeys, "hadCodeC"];

const onChain = { hadCodeC: true } as const;

/**
 * The rule, in order: the first condition that holds gives the state. It reads
 * outcomes by their place in the Type's set (RP-429), never by code: "Code C" is
 * an outcome that offers a Revision, "approved" a positive one, "rejected" a
 * negative one that doesn't.
 */
export const codeCRules: readonly CodeCRule[] = [
  { when: { hadCodeC: false }, state: null },
  { when: { stageCategory: "cancelled" }, state: null },
  { when: { ...onChain, offersRevision: false, polarity: "positive" }, state: "approvedOnRevision" },
  { when: { ...onChain, offersRevision: false, polarity: "negative" }, state: "rejectedAfterC" },
  // Nobody but its raiser sees a Revision before it is Submitted (V1), as in chainBucket.
  { when: unseenBeforeSubmit, state: null },
  { when: { ...onChain, open: true, raisedByViewer: true }, state: "revisionInProgress" },
  { when: { ...onChain, open: true }, state: "awaitingRevision" },
  { when: { ...onChain, offersRevision: true, raisedByViewer: true }, state: "noRevisionYet" },
  { when: { ...onChain, offersRevision: true }, state: "awaitingRevision" },
];

/** The Code C state of a chain, or null when it isn't on the Code C line. */
export function codeCState(input: CodeCInput): CodeCState | null {
  return codeCRules.find(({ when }) => holdsCodeCCondition(when, input))?.state ?? null;
}

/** Whether every key of `when` holds for `input`: chainBucket's keys, and `hadCodeC`. */
export function holdsCodeCCondition({ hadCodeC, ...rest }: CodeCCondition, input: CodeCInput): boolean {
  return (hadCodeC === undefined || hadCodeC === input.hadCodeC) && holdsChainCondition(rest, input);
}

/** The states a `codeC` filter takes in: awaiting revision is also both halves of the raiser's split. */
export const codeCFilterTakesIn: Record<CodeCFilter, readonly CodeCState[]> = {
  approvedOnRevision: ["approvedOnRevision"],
  awaitingRevision: ["awaitingRevision", "noRevisionYet", "revisionInProgress"],
  noRevisionYet: ["noRevisionYet"],
  revisionInProgress: ["revisionInProgress"],
  rejectedAfterC: ["rejectedAfterC"],
};

/** The states a `codeC` filter of several values takes in. */
export function codeCFilterStates(filter: readonly CodeCFilter[]): CodeCState[] {
  return [...new Set(filter.flatMap((f) => codeCFilterTakesIn[f]))];
}
