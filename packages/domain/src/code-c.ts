import { z } from "zod";
import { holdsChainCondition, type ChainBucketCondition, type ChainBucketInput } from "./chain-bucket.ts";

/**
 * The Dashboard's Code C line (RP-352, spec RP-344; visibility.md "Dashboard
 * and Location Status", scenario 64): on a `review_code` Type, each Revision
 * chain that has had at least one Code C the viewer sees counts once, by its
 * latest Revision the viewer sees (V1 per Revision):
 * - `approvedOnRevision`: the latest Revision got Code A or B;
 * - `rejectedAfterC`: the latest Revision got Code D;
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

/** What the rule reads: chainBucket's input, and whether any Revision of the chain the viewer sees got Code C. */
export type CodeCInput = ChainBucketInput & { hadCodeC: boolean };

export type CodeCCondition = ChainBucketCondition & { hadCodeC?: boolean };
export type CodeCRule = { readonly when: CodeCCondition; readonly state: CodeCState | null };

const onChain = { outcomeKind: "review_code", hadCodeC: true } as const;

/** The rule, in order: the first condition that holds gives the state. */
export const codeCRules: readonly CodeCRule[] = [
  { when: { hadCodeC: false }, state: null },
  { when: { stageCategory: "cancelled" }, state: null },
  { when: { ...onChain, outcome: "A" }, state: "approvedOnRevision" },
  { when: { ...onChain, outcome: "B" }, state: "approvedOnRevision" },
  { when: { ...onChain, outcome: "D" }, state: "rejectedAfterC" },
  // Nobody but its raiser sees a Revision before it is Submitted (V1), as in chainBucket.
  { when: { open: true, submitted: false, raisedByViewer: false }, state: null },
  { when: { ...onChain, open: true, raisedByViewer: true }, state: "revisionInProgress" },
  { when: { ...onChain, open: true }, state: "awaitingRevision" },
  { when: { ...onChain, outcome: "C", raisedByViewer: true }, state: "noRevisionYet" },
  { when: { ...onChain, outcome: "C" }, state: "awaitingRevision" },
];

/** The Code C state of a chain, or null when it isn't on the Code C line. */
export function codeCState(input: CodeCInput): CodeCState | null {
  return (
    codeCRules.find(({ when: { hadCodeC, ...rest } }) => (hadCodeC === undefined || hadCodeC === input.hadCodeC) && holdsChainCondition(rest, input))
      ?.state ?? null
  );
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
