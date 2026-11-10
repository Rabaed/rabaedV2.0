// The window widths the app lays itself out by. The CSS side is the matching `@custom-variant` in styles/index.css
// (`phone`, `tablet`, `list-narrow`); keep the two in step (widths.test.ts checks phone and tablet).

/** A phone: below 768 wide (RP-1158's tiers, the owner's Responsive Anatomy; drawn at 402). */
export const PHONE = "(max-width: 767.98px)";

/** A tablet or anything narrower: up to and including 1024 wide (drawn at 820). The sidebar is a drawer here. */
export const TABLET = "(max-width: 1024px)";

// The List's own widths (RP-1177, UX-04, the owner's answers of 2026-11-02).

/** Under 1600 wide: the List's columns fit 1366 (Code and "With" after the Status, tighter cells, capped Subject and "With"). */
export const LIST_NARROW = "(max-width: 1599.98px)";

/** Under 1440 wide: the view switch shows its icons only, as the Group button shortens there too. */
export const VIEW_ICONS_ONLY = "(max-width: 1439.98px)";
