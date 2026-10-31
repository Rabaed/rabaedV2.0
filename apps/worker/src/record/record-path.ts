import type { TransitionFact } from "@rabaed/db";

/** The Transitions that give an item back, never on the record (V7): a Return, and a Send Back (a Code the Owner sent back is one). */
const GIVES_BACK = new Set(["return", "send_back"]);

/**
 * The Transitions on the item's path to its outcome (V7). A Return or a Send
 * Back is never on it, whatever follows. It also makes a loop that comes back
 * to a Step the item left before; the work around it, up to the Step it left
 * again, is left out too, so each Step appears once, as the item last left it.
 * A loop also closes when the item comes back to the Step a Return or Send Back
 * left, wherever that one led: the Rabaed Default MAR Returns to the Contractor
 * Engineer's Step, and the engineer sends it again from there (RP-1053). So the
 * first entry, "Prepared", is the raiser's last send, never a Returned one.
 */
export function recordPath(transitions: readonly TransitionFact[]): TransitionFact[] {
  const path: TransitionFact[] = [];
  for (const t of transitions) {
    const givenBack = GIVES_BACK.has(t.kind) ? -1 : path.findLastIndex((p) => GIVES_BACK.has(p.kind) && p.fromStepId === t.toStepId);
    const returnedSend = path.findLastIndex((p, i) => i < givenBack && p.toStepId === t.toStepId);
    if (returnedSend >= 0) path.length = returnedSend;
    const leftBefore = path.findIndex((p) => p.fromStepId === t.fromStepId);
    if (leftBefore >= 0) path.length = leftBefore;
    path.push(t);
  }
  return path.filter((t) => !GIVES_BACK.has(t.kind));
}
