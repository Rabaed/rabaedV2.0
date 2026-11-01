// The window widths the List lays itself out by (RP-1177, UX-04, the owner's answers of 2026-11-02). The CSS side is
// the `list-narrow` variant in styles/index.css; keep the two in step.

/** Under 1600 wide: the List's columns fit 1366 (Code and "With" after the Status, tighter cells, capped Subject and "With"). */
export const LIST_NARROW = "(max-width: 1599.98px)";

/** Under 1440 wide: the view switch shows its icons only, as the Group button shortens there too. */
export const VIEW_ICONS_ONLY = "(max-width: 1439.98px)";
