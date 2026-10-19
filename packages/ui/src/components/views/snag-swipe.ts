import type { BilingualText, TransitionKind, WorkItemActions } from "@rabaed/domain";

// A Snag List card's swipe actions on a phone (RP-630; kit `snag/mobile.js`): only the
// Transitions the item's own `actions` offer the viewer, the same list its page shows, so no
// button is ever shown that the API would refuse. Pick up, Return to pool and a cancel stay on
// the item's page.

/** How a swipe button looks: a forward step (Resolve, Close), a move inside the Company (Start work, Put on hold), or a step back. */
export type SwipeTone = "forward" | "move" | "back";

export type SwipeAction = { key: string; label: BilingualText; kind: TransitionKind; tone: SwipeTone };

/** At most this many behind a card: the item's page has every one. */
export const maxSwipeActions = 3;
/** Each button's width, as in the kit. */
const buttonWidth = 75;

const toneOf: Record<TransitionKind, SwipeTone | null> = {
  submit: "forward",
  close: "forward",
  send: "move",
  return: "back",
  send_back: "back",
  cancel: null,
};
const order: Record<SwipeTone, number> = { forward: 0, move: 1, back: 2 };

/** The buttons behind a card: the Transitions the viewer may take on it, forward ones first, without a cancel. */
export function swipeActionsOf(actions: Pick<WorkItemActions, "transitions">): SwipeAction[] {
  return actions.transitions
    .flatMap((t) => {
      const tone = toneOf[t.kind];
      return tone ? [{ key: t.key, label: t.label, kind: t.kind, tone }] : [];
    })
    .sort((a, b) => order[a.tone] - order[b.tone])
    .slice(0, maxSwipeActions);
}

/** How wide the buttons behind a card are. */
export const swipeWidth = (count: number) => count * buttonWidth;

/**
 * Where a card comes to rest when let go after a drag of `dx` pixels: open when it was dragged
 * towards the start (left in English, right in Arabic) past half its buttons' width.
 */
export function swipeSettles(dx: number, dir: "ltr" | "rtl", width: number): "open" | "closed" {
  if (width === 0) return "closed";
  const towardsStart = dir === "rtl" ? dx : -dx;
  return towardsStart > width / 2 ? "open" : "closed";
}
