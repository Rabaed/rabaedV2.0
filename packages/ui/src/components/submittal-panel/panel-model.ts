import { cardNumber, sortedByName, type Locale, type WorkItemDetail } from "@rabaed/domain";

/**
 * Who the item is with, as the panel shows it (V14, spec RP-1054 gap A3). It reads only what the
 * item read gives: another Company comes with no member and no pool, so it is named by its
 * Company name alone, and the panel draws no avatar for it. "Owner review" (ADR 0022) is given
 * in the Company name's place, so it reads the same way.
 */
export type SubmittalPanelWith =
  /** One of the viewer's own Company's people. */
  | { kind: "person"; name: string }
  /** A Step Pool of the viewer's own Company: up to 3 names in the reader's order, then how many more. */
  | { kind: "pool"; names: string[]; more: number }
  /** Another Company (or "Owner review"), by name only. */
  | { kind: "company"; name: string };

const poolNamesShown = 3;

export function submittalPanelWith(heldBy: WorkItemDetail["heldBy"], locale: Locale): SubmittalPanelWith | null {
  if (!heldBy) return null;
  if (heldBy.memberName) return { kind: "person", name: heldBy.memberName[locale] };
  if (heldBy.pool && heldBy.pool.names.length > 0) {
    const names = sortedByName(heldBy.pool.names, (n) => n[locale], locale).map((n) => n[locale]);
    return { kind: "pool", names: names.slice(0, poolNamesShown), more: Math.max(names.length - poolNamesShown, 0) };
  }
  return { kind: "company", name: heldBy.companyName[locale] };
}

/**
 * The open item's place among the rows the viewer has loaded (gap C6): its index, the count
 * ("n / m"), and its neighbours, null at either edge. An item opened from a shared link that is
 * not on the loaded page has no place (index -1) and no neighbours. No new query.
 */
export function submittalPanelPosition(ids: readonly string[], id: string): { index: number; total: number; previous: string | null; next: string | null } {
  const index = ids.indexOf(id);
  if (index < 0) return { index, total: ids.length, previous: null, next: null };
  return { index, total: ids.length, previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}

/** A key press as the panel judges it: what it is, and where it landed. */
export type SubmittalPanelKeyPress = {
  key: string;
  /** Alt, Ctrl, Meta or Shift held. */
  modifier: boolean;
  /** Something nearer the focus already took it. */
  defaultPrevented: boolean;
  /** Focus is in a field being typed in. */
  typing: boolean;
  /** Focus is in a menu, list box, grid or tab list, which moves by the arrows itself. */
  inWidget: boolean;
  /** An inner layer is open over the panel (an Action Form, a menu, a viewer): it closes first. */
  layerOpen: boolean;
};

/**
 * What a key does to the panel (README §1, gap C6): Esc closes it, innermost layer first, and ↑ / ↓
 * move to the previous or next loaded row; neither while focus is in a field being typed in (as the
 * design's drawer.js), nor the arrows in a widget that moves by them.
 */
export function submittalPanelKey(press: SubmittalPanelKeyPress): "close" | "previous" | "next" | null {
  if (press.defaultPrevented || press.layerOpen || press.typing) return null;
  if (press.key === "Escape") return "close";
  if (press.modifier || press.inWidget) return null;
  if (press.key === "ArrowUp") return "previous";
  if (press.key === "ArrowDown") return "next";
  return null;
}

/**
 * The panel's big number (gap A16): a Revision's stored " Rev n" split off, so `DocNo` words it
 * in the reader's language, inline after the number in brand orange; Rev 0 shows nothing
 * (`revisionNo` null). Null for a Draft, which has no number.
 */
export function submittalPanelNumber(documentNumber: string | null, revisionNo: number): { number: string; revisionNo: number | null } | null {
  const number = cardNumber(documentNumber, revisionNo);
  if (number === null) return null;
  return { number, revisionNo: revisionNo > 0 ? revisionNo : null };
}
