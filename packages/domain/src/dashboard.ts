import { z } from "zod";
import { chainBucketSchema, fixedChainBuckets, openBuckets, type ChainBucket } from "./chain-bucket.ts";
import { codeCFilterSchema, codeCFilterStates, type CodeCFilter, type CodeCState } from "./code-c.ts";
import { bilingualText, type BilingualText } from "./company.ts";
import { moduleKeySchema, type ModuleKey } from "./module.ts";
import { dashboardBarOutcomes, offersRevision, outcomeKinds, type Outcome, type OutcomeKind } from "./outcome.ts";

/**
 * The Dashboard (spec RP-344, design §5): one card per Work Item Type, grouped
 * by Module, counting Revision chains by the latest Revision the viewer sees
 * (`chainBucket`). A chain in no bucket counts nowhere, as the List shows it
 * nowhere. Every number carries the work item query (its Module and filter)
 * that reproduces it, so it opens the List of exactly the chains it counts.
 * Nothing here is measured against time.
 *
 * A card reads its Type's outcome set (RP-429): its bars, their names and
 * colours, the Approved % and the Code C line come from the outcomes, their
 * polarity and follow-up actions, never from fixed codes.
 */

/**
 * A bar's colour: Pending; an outcome offering a Revision (back with the
 * raiser); a positive one, or Approved; a negative one, or Rejected.
 */
export const dashboardBarTones = ["pending", "revision", "positive", "negative"] as const;
export type DashboardBarTone = (typeof dashboardBarTones)[number];

/** The List behind a number: the Module and Type, the buckets (none: every chain of the Type), and on the Code C line its sub-states. */
const figureQuery = z.object({
  module: moduleKeySchema,
  type: z.array(z.string()),
  bucket: z.array(chainBucketSchema),
  codeC: z.array(codeCFilterSchema).optional(),
});
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

const bar = figure.extend({
  bucket: chainBucketSchema,
  /** An outcome's name, in English and Arabic; null for Pending, Approved and Rejected, which the app names. */
  name: bilingualText.nullable(),
  tone: z.enum(dashboardBarTones),
});
export type DashboardBar = z.infer<typeof bar>;

export const dashboardCardSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("outcomes"),
    type: cardType,
    outcomeKind: z.enum(outcomeKinds),
    /** Every chain the viewer sees. */
    total: figure,
    bars: z.array(bar),
    /** The viewer's own Participant's chains not yet Submitted; null when it has none. */
    inPreparation: figure.nullable(),
    /** Its percent is of the Submitted chains only (In preparation left out), so it is the same for every Company that sees them. */
    approved: figure.extend({ percent: z.number().int().min(0).max(100) }),
    /** Null on a Type with no outcome offering a Revision, or when no chain the viewer sees has had one. */
    codeC: codeCLine.nullable(),
  }),
  z.object({
    kind: z.literal("open_closed"),
    type: cardType,
    outcomeKind: z.enum(outcomeKinds),
    /** Every chain the viewer sees: open + closed. */
    total: figure,
    open: figure,
    closed: figure,
  }),
]);
export type DashboardCard = z.infer<typeof dashboardCardSchema>;

export const dashboard = z.object({
  modules: z.array(z.object({ key: moduleKeySchema, cards: z.array(dashboardCardSchema) })),
});
export type Dashboard = z.infer<typeof dashboard>;

export type DashboardCardInput = {
  type: { code: string; name: BilingualText };
  moduleKey: ModuleKey;
  outcomeKind: OutcomeKind;
  /** The Type's outcome set on the Project, in its order. */
  outcomes: readonly Outcome[];
  /** How many of the Type's chains the viewer sees in each bucket; `null` for those in none, which count nowhere. */
  counts: ReadonlyMap<ChainBucket | null, number>;
  /** How many of the Type's chains the viewer sees in each Code C state (codeCState); `null` for those on no line. */
  codeCCounts?: ReadonlyMap<CodeCState | null, number>;
};

const percentOf = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

/** A bar of the card, in order: Pending, then the Type's bar outcomes, or Approved and Rejected by Stage when it has none. */
type BarOf = { bucket: ChainBucket; name: BilingualText | null; tone: DashboardBarTone };

function barsOf(outcomes: readonly Outcome[]): BarOf[] {
  const fromOutcomes = dashboardBarOutcomes(outcomes);
  const closed: BarOf[] =
    fromOutcomes.length > 0
      ? fromOutcomes.map((o) => ({ bucket: o.code, name: o.name, tone: offersRevision(o) ? "revision" : o.polarity }))
      : [
          { bucket: "approved", name: null, tone: "positive" },
          { bucket: "rejected", name: null, tone: "negative" },
        ];
  return [{ bucket: "pending", name: null, tone: "pending" }, ...closed];
}

/** The Code C line from its state counts, or null when it has no chain. */
function codeCLineOf(module: ModuleKey, typeCode: string, counts: ReadonlyMap<CodeCState | null, number>): DashboardCodeCLine | null {
  const of = (filter: CodeCFilter[]): DashboardFigure => ({
    count: codeCFilterStates(filter).reduce((sum, s) => sum + (counts.get(s) ?? 0), 0),
    query: { module, type: [typeCode], bucket: [], codeC: filter },
  });
  const total = of(["approvedOnRevision", "awaitingRevision", "rejectedAfterC"]);
  if (total.count === 0) return null;
  const approved = of(["approvedOnRevision"]);
  const noRevisionYet = of(["noRevisionYet"]);
  const revisionInProgress = of(["revisionInProgress"]);
  const rejected = of(["rejectedAfterC"]);
  return {
    total,
    approvedOnRevision: { ...approved, percent: percentOf(approved.count, total.count) },
    awaitingRevision: of(["awaitingRevision"]),
    split: noRevisionYet.count + revisionInProgress.count > 0 ? { noRevisionYet, revisionInProgress } : null,
    rejectedAfterC: rejected.count > 0 ? rejected : null,
  };
}

/** A Type's card from its bucket counts. */
export function dashboardCard({ type, moduleKey, outcomeKind, outcomes, counts, codeCCounts = new Map() }: DashboardCardInput): DashboardCard {
  const countOf = (buckets: readonly ChainBucket[]) => buckets.reduce((sum, b) => sum + (counts.get(b) ?? 0), 0);
  const of = (buckets: readonly ChainBucket[]): DashboardFigure => ({ count: countOf(buckets), query: { module: moduleKey, type: [type.code], bucket: [...buckets] } });
  // Every bucket a chain of this Type can count in: the fixed ones and its closing outcomes.
  const closedBuckets = [
    ...new Set([...outcomes.filter((o) => o.closing).map((o) => o.code), ...fixedChainBuckets.filter((b) => !openBuckets.includes(b))]),
  ];
  const everyBucket = [...openBuckets, ...closedBuckets];
  // Every chain in a bucket: the List of the Type lists no other (work item query).
  const total: DashboardFigure = { count: countOf(everyBucket), query: { module: moduleKey, type: [type.code], bucket: [] } };
  const card = { type: { code: type.code, name: type.name }, outcomeKind, total };
  if (moduleKey === "snag_list") return { ...card, kind: "open_closed", open: of(openBuckets), closed: of(closedBuckets) };
  const inPreparation = of(["in_preparation"]);
  const bars = barsOf(outcomes);
  const approved = of(bars.filter((b) => b.tone === "positive").map((b) => b.bucket));
  const submitted = countOf(everyBucket.filter((b) => b !== "in_preparation"));
  return {
    ...card,
    kind: "outcomes",
    bars: bars.map((b) => ({ ...b, ...of([b.bucket]) })),
    inPreparation: inPreparation.count > 0 ? inPreparation : null,
    approved: { ...approved, percent: percentOf(approved.count, submitted) },
    codeC: outcomes.some(offersRevision) ? codeCLineOf(moduleKey, type.code, codeCCounts) : null,
  };
}
