import { cardNumber, sortedByName, type Locale, type WorkItemDetail } from "@rabaed/domain";

/**
 * Who the item is with, as the panel shows it (V14, spec RP-1054 gap A3). It reads only what the
 * item read gives: another Company comes with no member and no pool, so it is named by its
 * Company name alone, and the panel draws no avatar for it. "Owner review" (ADR 0022) is given
 * in the Company name's place, so it reads the same way.
 */
export type SubmittalPanelWith =
  /** One of the viewer's own Company's people. */
  | { kind: "person"; name: string; companyName: string }
  /** A Step Pool of the viewer's own Company: up to 3 names in the reader's order, then how many more. */
  | { kind: "pool"; names: string[]; more: number; companyName: string }
  /** Another Company (or "Owner review"), by name only. */
  | { kind: "company"; name: string };

const poolNamesShown = 3;

export function submittalPanelWith(heldBy: WorkItemDetail["heldBy"], locale: Locale): SubmittalPanelWith | null {
  if (!heldBy) return null;
  const companyName = heldBy.companyName[locale];
  if (heldBy.memberName) return { kind: "person", name: heldBy.memberName[locale], companyName };
  if (heldBy.pool && heldBy.pool.names.length > 0) {
    const names = sortedByName(heldBy.pool.names, (n) => n[locale], locale).map((n) => n[locale]);
    return { kind: "pool", names: names.slice(0, poolNamesShown), more: Math.max(names.length - poolNamesShown, 0), companyName };
  }
  return { kind: "company", name: companyName };
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
 * What a key does to the panel (README §1, gap C6): Esc closes it, innermost layer first; ↑ / ↓
 * move to the previous or next loaded row while focus isn't in a field or a widget that uses them.
 */
export function submittalPanelKey(press: SubmittalPanelKeyPress): "close" | "previous" | "next" | null {
  if (press.defaultPrevented || press.layerOpen) return null;
  if (press.key === "Escape") return "close";
  if (press.modifier || press.typing || press.inWidget) return null;
  if (press.key === "ArrowUp") return "previous";
  if (press.key === "ArrowDown") return "next";
  return null;
}

/**
 * The panel's big number (gap A16): a Revision's stored " Rev n" split off, so it shows inline
 * after the number in brand orange; Rev 0 shows nothing. Null for a Draft, which has no number.
 */
export function submittalPanelNumber(documentNumber: string | null, revisionNo: number): { number: string; revision: string | null } | null {
  const number = cardNumber(documentNumber, revisionNo);
  if (number === null || documentNumber === null) return null;
  return { number, revision: number === documentNumber ? null : documentNumber.slice(number.length).trim() };
}
