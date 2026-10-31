import type { TransitionKind } from "@rabaed/domain";

/**
 * Where a Transition takes the item, as the Work Item page's pop-up says after the number (RP-1188,
 * gap table row 34): "back" to the raiser's Company for a code whose outcome offers a Revision (Code C)
 * and for a Send Back; "closes" it for them for any other close; null for a move that says nothing more.
 */
export function transitionGoesTo({ kind, offersRevision }: { kind: TransitionKind; offersRevision: boolean }): "back" | "closes" | null {
  if (kind === "send_back" || (kind === "close" && offersRevision)) return "back";
  return kind === "close" ? "closes" : null;
}
