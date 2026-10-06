import { z } from "zod";
import { bilingualText } from "./company.ts";
import { workItemList, workItemRow, type WorkItemRow } from "./work-item.ts";

/**
 * The Kanban (spec RP-344, RP-349): the work item query's items as a board.
 * Stages are its columns. Inside a column, the items are grouped into
 * swimlanes as V14 has it: each Step of the viewer's own Company is a lane;
 * another Company is one lane with its name only, never its Steps or people;
 * a closed item, which nobody holds, sits in the column's `closed` lane.
 */

/** A closed column (Approved, Rejected, Cancelled…) shows the items closed in the last this many days. */
export const closedColumnDays = 30;

/** The Views of a Module tab's Work Items, kept in the URL as `view`; the List when left out. */
export const workItemViews = ["list", "kanban"] as const;
export type WorkItemView = (typeof workItemViews)[number];

/** The View a URL holds: `view=kanban`, or the List for anything else. */
export function workItemViewFromSearchParams(params: URLSearchParams | Record<string, string | string[] | undefined>): WorkItemView {
  const raw = params instanceof URLSearchParams ? params.get("view") : [params.view].flat()[0];
  return raw === "kanban" ? "kanban" : "list";
}

/** A card: the item as a List row, so it reads the same on both Views. */
export const workItemCard = workItemRow;

const laneCards = { count: z.number().int().nonnegative(), cards: z.array(workItemCard) };

/** One swimlane of a column (V14). */
export const workItemBoardLane = z.discriminatedUnion("kind", [
  /** A Step of the viewer's own Company. */
  z.object({ kind: z.literal("step"), step: z.object({ key: z.string(), name: bilingualText }), ...laneCards }),
  /** Another Company, as one lane: its name only. */
  z.object({ kind: z.literal("company"), participantId: z.uuid(), companyName: bilingualText, ...laneCards }),
  /** Closed items: nobody holds them. */
  z.object({ kind: z.literal("closed"), ...laneCards }),
]);
export type WorkItemBoardLane = z.infer<typeof workItemBoardLane>;

/**
 * The board of a Module's Work Items the viewer can see that match the work
 * item query. `stages` and `filters` are the List's: each Stage's count is of
 * every matching item in it, so a closed column's count is its "Show all"
 * total. `columns` follow `stages`, one per Stage: its lanes, and how many
 * cards it shows (a closed column only those closed in the last
 * `closedColumnDays` days; an open one all of them). The cursor is not used.
 */
export const workItemBoard = workItemList.pick({ stages: true, filters: true }).extend({
  columns: z.array(z.object({ stageKey: z.string(), shown: z.number().int().nonnegative(), lanes: z.array(workItemBoardLane) })),
});
export type WorkItemBoard = z.infer<typeof workItemBoard>;

/** A card with the Participant holding it, which only the API knows: another Company's lane is keyed by it. */
export type BoardCardInput = { card: WorkItemRow; holderParticipantId: string | null };

/**
 * A column's swimlanes (V14): its cards grouped by who holds them, each lane's
 * cards in the order given. The viewer's own Steps come first, then the other
 * Companies, each by name, then the closed lane. A card nobody may be named
 * for (closed, or its holder unknown) goes in the closed lane.
 */
export function boardLanes(cards: readonly BoardCardInput[]): WorkItemBoardLane[] {
  type Lane<K> = Extract<WorkItemBoardLane, { kind: K }>;
  const steps = new Map<string, Lane<"step">>();
  const companies = new Map<string, Lane<"company">>();
  const closed: Lane<"closed"> = { kind: "closed", count: 0, cards: [] };
  for (const { card, holderParticipantId } of cards) {
    const w = card.with;
    let lane: WorkItemBoardLane = closed;
    if (w?.kind === "own") {
      lane = steps.get(w.step.key) ?? { kind: "step", step: w.step, count: 0, cards: [] };
      steps.set(w.step.key, lane);
    } else if (w?.kind === "company" && holderParticipantId !== null) {
      lane = companies.get(holderParticipantId) ?? { kind: "company", participantId: holderParticipantId, companyName: w.companyName, count: 0, cards: [] };
      companies.set(holderParticipantId, lane);
    }
    lane.cards.push(card);
    lane.count += 1;
  }
  const byName = (a: { en: string }, b: { en: string }) => a.en.localeCompare(b.en, "en");
  return [
    ...[...steps.values()].sort((a, b) => byName(a.step.name, b.step.name)),
    ...[...companies.values()].sort((a, b) => byName(a.companyName, b.companyName)),
    ...(closed.count > 0 ? [closed] : []),
  ];
}
