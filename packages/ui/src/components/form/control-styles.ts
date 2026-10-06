/** Focus ring shared by every control, Button included. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Shared look of text boxes: Input, Textarea and the Select trigger. */
export const textBox = [
  "w-full rounded-sm border border-control-border bg-surface px-3 text-body text-text",
  "placeholder:text-muted hover:border-control-border-hover",
  focusRing,
  "aria-invalid:border-danger aria-invalid:hover:border-danger",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-muted",
  "read-only:bg-surface-subtle read-only:hover:border-control-border",
  "aria-readonly:bg-surface-subtle aria-readonly:hover:border-control-border",
  // Touch targets of at least 44px on phones (gloved hands on site).
  "pointer-coarse:min-h-11",
];

/**
 * Stretches a small control's hit area to at least 44 × 44px on touch screens
 * without changing its size in the layout.
 */
/**
 * Grows a link or other inline control to at least 44 × 44px on touch screens, its content centred
 * across. For a control whose layout must not grow, use `touchArea`.
 */
export const touchBox = "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center";

// The inset is the same on every side (half of the size gap, negative), so it is centred in both directions.
export const touchArea =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-[calc(50%-1.375rem)] pointer-coarse:after:content-['']";
