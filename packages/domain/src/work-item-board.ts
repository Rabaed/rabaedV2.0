import { z } from "zod";
import { bilingualText } from "./company.ts";
import type { Locale } from "./locale.ts";
import { formSchema } from "./form.ts";
import { transitionKinds, workItemList, workItemRow, type WorkItemRow } from "./work-item.ts";

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

/** A Transition the viewer may take on a card now, with the Stage it leads to and its Action Form. */
export const workItemMove = z.object({
  transition: z.string(),
  label: bilingualText,
  kind: z.enum(transitionKinds),
  /** The Stage of the Step it leads to. */
  stageKey: z.string(),
  actionForm: formSchema.nullable(),
});
export type WorkItemMove = z.infer<typeof workItemMove>;

/**
 * Where a card may be dropped (RP-350): a Stage reached by exactly one of the
 * Transitions the viewer may take on it now, other than the Stage it is in.
 * A Stage two Transitions lead to is no target, as dropping there would not say
 * which one to take; those are taken from the item's page.
 */
export function dropTargets(moves: readonly WorkItemMove[], currentStageKey: string): Map<string, WorkItemMove> {
  const byStage = new Map<string, WorkItemMove[]>();
  for (const m of moves) byStage.set(m.stageKey, [...(byStage.get(m.stageKey) ?? []), m]);
  const targets = new Map<string, WorkItemMove>();
  for (const [stageKey, reaching] of byStage) if (reaching.length === 1 && stageKey !== currentStageKey) targets.set(stageKey, reaching[0]!);
  return targets;
}

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
  /**
   * What the viewer may do with a card now (RP-350), by item id: only the
   * Transitions they may take on it at this moment, as the item page's buttons
   * are, so a card they may not act on has no entry. Nothing says why another
   * Transition is not here (the "Refusals of a Transition" channel).
   */
  moves: z.record(z.uuid(), z.array(workItemMove)),
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
  return lanesInLocale([...steps.values(), ...companies.values(), ...(closed.count > 0 ? [closed] : [])], "en");
}

/**
 * A column's lanes in the order a viewer reads them: the viewer's own Steps,
 * then the other Companies, each by name in the viewer's language, then the
 * closed lane. The API sends them in English order; the board reorders them.
 */
export function lanesInLocale(lanes: readonly WorkItemBoardLane[], locale: Locale): WorkItemBoardLane[] {
  const rank = { step: 0, company: 1, closed: 2 } as const;
  const name = (l: WorkItemBoardLane) => (l.kind === "step" ? l.step.name[locale] : l.kind === "company" ? l.companyName[locale] : "");
  return [...lanes].sort((a, b) => rank[a.kind] - rank[b.kind] || name(a).localeCompare(name(b), locale));
}
