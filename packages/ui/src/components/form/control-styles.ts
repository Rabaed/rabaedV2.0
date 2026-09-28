/** Shared look of text boxes: Input, Textarea and the Select trigger. */
export const textBox = [
  "w-full rounded-sm border border-control-border bg-surface px-3 text-body text-text",
  "placeholder:text-muted hover:border-control-border-hover",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  "aria-invalid:border-danger aria-invalid:hover:border-danger",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-muted",
  "read-only:bg-surface-subtle read-only:hover:border-control-border",
  "aria-readonly:bg-surface-subtle aria-readonly:hover:border-control-border",
  // Touch targets of at least 44px on phones (gloved hands on site).
  "pointer-coarse:min-h-11",
];

/** Focus ring for Radix controls (buttons) that match Input's. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * Stretches a small control's hit area to at least 44 × 44px on touch screens
 * without changing its size in the layout.
 */
// The inset is the same on every side (half of the size gap, negative), so it is centred in both directions.
export const touchArea =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-[calc(50%-1.375rem)] pointer-coarse:after:content-['']";
