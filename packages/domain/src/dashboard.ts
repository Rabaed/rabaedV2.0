import { z } from "zod";
import { chainBucketSchema, chainBuckets, outcomeKinds, type ChainBucket, type OutcomeKind } from "./chain-bucket.ts";
import { codeCFilterSchema, type CodeCFilter, type CodeCState } from "./code-c.ts";
import { bilingualText, type BilingualText } from "./company.ts";

/**
 * The Dashboard (spec RP-344, design §5): one card per Work Item Type, grouped
 * by Module, counting Revision chains by the latest Revision the viewer sees
 * (`chainBucket`). Every number carries the work item query filter that
 * reproduces it, so it opens the List of exactly the chains it counts. Nothing
 * here is measured against time.
 */

/** The Modules that hold Work Items, as the Dashboard orders them: the Snag List's open/closed cards first. */
export const moduleKeys = ["snag_list", "submittals", "inspections", "site_reports", "drawings"] as const;
export type ModuleKey = (typeof moduleKeys)[number];

/** The bars of a card, by its Type's outcome kind. */
export const dashboardBars: Record<OutcomeKind, readonly ChainBucket[]> = {
  review_code: ["pending", "C", "A", "B", "D"],
  inspection_result: ["pending", "passed", "passed_with_comments", "failed"],
  none: ["pending", "approved", "rejected"],
};

/** What counts as approved for the Approved % (A+B, or Passed + Passed with Comments). */
export const approvedBuckets: Record<OutcomeKind, readonly ChainBucket[]> = {
  review_code: ["A", "B"],
  inspection_result: ["passed", "passed_with_comments"],
  none: ["approved"],
};

export const openBuckets: readonly ChainBucket[] = ["pending", "in_preparation"];
export const closedBuckets: readonly ChainBucket[] = chainBuckets.filter((b) => !openBuckets.includes(b));

/** The List filter behind a number: the Type, the buckets (none: every chain of the Type), and on the Code C line its sub-states. */
const figureQuery = z.object({ type: z.array(z.string()), bucket: z.array(chainBucketSchema), codeC: z.array(codeCFilterSchema).optional() });
export type DashboardFigureQuery = z.infer<typeof figureQuery>;

const figure = z.object({ count: z.number().int().nonnegative(), query: figureQuery });
export type DashboardFigure = z.infer<typeof figure>;

const cardType = z.object({ code: z.string(), name: bilingualText });

/**
 * The Code C line (RP-352, codeCState): "Code C 5 · approved on revision 3
 * (60%) · awaiting revision 2", rejected after C when there is any, and
 * awaiting revision split into "no Revision yet" and "Revision in progress"
 * when the viewer's own Participant raised any of those chains.
 */
const codeCLine = z.object({
  total: figure,
  approvedOnRevision: figure.extend({ percent: z.number().int().min(0).max(100) }),
  awaitingRevision: figure,
  /** The raiser's own split of awaiting revision; null for every other Company. */
  split: z.object({ noRevisionYet: figure, revisionInProgress: figure }).nullable(),
  rejectedAfterC: figure.nullable(),
});
export type DashboardCodeCLine = z.infer<typeof codeCLine>;

export const dashboardCardSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("outcomes"),
    type: cardType,
    outcomeKind: z.enum(outcomeKinds),
    /** Every chain the viewer sees. */
    total: figure,
    bars: z.array(figure.extend({ bucket: chainBucketSchema })),
    /** The viewer's own Participant's chains not yet Submitted; null when it has none. */
    inPreparation: figure.nullable(),
    approved: figure.extend({ percent: z.number().int().min(0).max(100) }),
    /** Null on a Type without Review Codes, or when no chain the viewer sees has had a Code C. */
    codeC: codeCLine.nullable(),
  }),
  z.object({
    kind: z.literal("open_closed"),
    type: cardType,
    outcomeKind: z.enum(outcomeKinds),
    total: figure,
    open: figure,
    closed: figure,
  }),
]);
export type DashboardCard = z.infer<typeof dashboardCardSchema>;

export const dashboard = z.object({
  modules: z.array(z.object({ key: z.enum(moduleKeys), cards: z.array(dashboardCardSchema) })),
});
export type Dashboard = z.infer<typeof dashboard>;

export type DashboardCardInput = {
  type: { code: string; name: BilingualText };
  moduleKey: ModuleKey;
  outcomeKind: OutcomeKind;
  /** How many of the Type's chains the viewer sees in each bucket; `null` for those in none. */
  counts: ReadonlyMap<ChainBucket | null, number>;
  /** How many of the Type's chains the viewer sees in each Code C state (codeCState); `null` for those on no line. */
  codeCCounts?: ReadonlyMap<CodeCState | null, number>;
};

const percentOf = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

/** The Code C line from its state counts, or null when it has no chain. */
function codeCLineOf(typeCode: string, counts: ReadonlyMap<CodeCState | null, number>): DashboardCodeCLine | null {
  const of = (filter: CodeCFilter[], states: CodeCState[] = filter): DashboardFigure => ({
    count: states.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0),
    query: { type: [typeCode], bucket: [], codeC: filter },
  });
  const total = of(["approvedOnRevision", "awaitingRevision", "rejectedAfterC"], ["approvedOnRevision", "awaitingRevision", "noRevisionYet", "revisionInProgress", "rejectedAfterC"]);
  if (total.count === 0) return null;
  const approved = of(["approvedOnRevision"]);
  const noRevisionYet = of(["noRevisionYet"]);
  const revisionInProgress = of(["revisionInProgress"]);
  const rejected = of(["rejectedAfterC"]);
  return {
    total,
    approvedOnRevision: { ...approved, percent: percentOf(approved.count, total.count) },
    awaitingRevision: of(["awaitingRevision"], ["awaitingRevision", "noRevisionYet", "revisionInProgress"]),
    split: noRevisionYet.count + revisionInProgress.count > 0 ? { noRevisionYet, revisionInProgress } : null,
    rejectedAfterC: rejected.count > 0 ? rejected : null,
  };
}

/** A Type's card from its bucket counts. */
export function dashboardCard({ type, moduleKey, outcomeKind, counts, codeCCounts = new Map() }: DashboardCardInput): DashboardCard {
  const of = (buckets: readonly ChainBucket[]): DashboardFigure => ({
    count: buckets.reduce((sum, b) => sum + (counts.get(b) ?? 0), 0),
    query: { type: [type.code], bucket: [...buckets] },
  });
  const total: DashboardFigure = { count: [...counts.values()].reduce((sum, n) => sum + n, 0), query: { type: [type.code], bucket: [] } };
  const card = { type: { code: type.code, name: type.name }, outcomeKind, total };
  if (moduleKey === "snag_list") return { ...card, kind: "open_closed", open: of(openBuckets), closed: of(closedBuckets) };
  const inPreparation = of(["in_preparation"]);
  const approved = of(approvedBuckets[outcomeKind]);
  return {
    ...card,
    kind: "outcomes",
    bars: dashboardBars[outcomeKind].map((bucket) => ({ bucket, ...of([bucket]) })),
    inPreparation: inPreparation.count > 0 ? inPreparation : null,
    approved: { ...approved, percent: percentOf(approved.count, total.count) },
    codeC: outcomeKind === "review_code" ? codeCLineOf(type.code, codeCCounts) : null,
  };
}
