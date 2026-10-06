import { z } from "zod";
import { chainBucketSchema, chainBuckets, outcomeKinds, type ChainBucket, type OutcomeKind } from "./chain-bucket.ts";
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

/** The List filter behind a number: the Type, and the buckets (none: every chain of the Type). */
const figureQuery = z.object({ type: z.array(z.string()), bucket: z.array(chainBucketSchema) });
export type DashboardFigureQuery = z.infer<typeof figureQuery>;

const figure = z.object({ count: z.number().int().nonnegative(), query: figureQuery });
export type DashboardFigure = z.infer<typeof figure>;

const cardType = z.object({ code: z.string(), name: bilingualText });

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
};

/** A Type's card from its bucket counts. */
export function dashboardCard({ type, moduleKey, outcomeKind, counts }: DashboardCardInput): DashboardCard {
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
    approved: { ...approved, percent: total.count === 0 ? 0 : Math.round((approved.count / total.count) * 100) },
  };
}
