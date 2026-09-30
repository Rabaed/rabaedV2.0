import { palette, type PaletteColour } from "./palette.ts";

/**
 * Colour keys for the Rabaed Default Stages (CONTEXT.md): Drafts, Internal Review,
 * Revised & Resubmitted, Pending Approval, Approved, Rejected, Cancelled.
 */
export const stageKeys = ["draft", "internal", "resubmitted", "pending", "approved", "rejected", "cancelled"] as const;
export type StageKey = (typeof stageKeys)[number];

/** Review Codes: A Approved, B Approved with Comments, C Revise and Resubmit, D Rejected. */
export const reviewCodes = ["a", "b", "c", "d"] as const;
export type ReviewCode = (typeof reviewCodes)[number];

/** Tones for Badge and Avatar: neutral, the brand, and the semantic feedback hues. Each has a `-tint` and a `-fg` role. */
export const toneKeys = ["neutral", "brand", "info", "success", "warning", "danger"] as const;
export type Tone = (typeof toneKeys)[number];

/**
 * Layer 2: semantic roles. A theme maps every role to a base palette colour.
 * This is the only layer that changes per theme; components (layer 3) read
 * roles only, so a new theme is a new map here and nothing else.
 *
 * Launch theme: cool light (canvas #f6f7f9), per design change requests §7.
 * Where the Claude Design export's text/fill pairs fall below WCAG AA contrast,
 * the role points at a darker step of the same hue (e.g. primary fill is
 * tomato-750, not the brand tomato-600, so white button text reads at 4.5:1).
 */
export const coolLight = {
  // Surfaces and lines
  canvas: "slate-50",
  surface: "white",
  "surface-subtle": "slate-25",
  hover: "slate-50",
  press: "slate-100",
  border: "slate-200",
  "border-subtle": "slate-150",
  "border-strong": "slate-350",
  // Form controls: their boundary must show at 3:1 (WCAG 1.4.11); decorative borders need not.
  "control-border": "slate-450",
  "control-border-hover": "slate-600",
  // The tint of every shadow; scales.ts sets each shadow's opacity.
  "shadow-colour": "slate-900",

  // Text
  text: "slate-900",
  "text-secondary": "slate-800",
  muted: "slate-600",
  faint: "slate-500",

  // Brand (non-text accents: logo, highlights)
  brand: "tomato-600",
  "brand-ink": "delft-600",
  "brand-tint": "tomato-50",

  // Actions
  primary: "tomato-750",
  "primary-hover": "tomato-800",
  "primary-press": "tomato-900",
  "on-primary": "white",
  secondary: "slate-100",
  "secondary-hover": "slate-250",
  "secondary-press": "slate-300",
  "on-secondary": "slate-900",
  "ghost-hover": "slate-100",
  "ghost-press": "slate-250",
  "on-ghost": "slate-800",
  danger: "red-700",
  "danger-hover": "red-800",
  "danger-press": "red-900",
  "on-danger": "white",
  disabled: "slate-100",
  "on-disabled": "slate-400",
  focus: "blue-500",
  "focus-offset": "white",

  // Inverse: dark surfaces on the light page (tooltips; the dimmed backdrop behind a dialog, at reduced opacity).
  inverse: "slate-900",
  "on-inverse": "white",

  // Feedback
  success: "green-700",
  "success-tint": "green-50",
  "danger-tint": "red-50",

  // Tones: a tint and the text on it, for Badge and Avatar initials. Not Stages or Review Codes, which have their own.
  "neutral-tint": "slate-100",
  "neutral-fg": "slate-700",
  "brand-fg": "tomato-750",
  "info-tint": "blue-50",
  "info-fg": "blue-700",
  "success-fg": "green-800",
  "warning-tint": "amber-50",
  "warning-fg": "amber-700",
  "danger-fg": "red-700",

  // Stage: one colour set per default Stage, shared by every Module.
  "stage-draft-bg": "slate-100",
  "stage-draft-fg": "slate-700",
  "stage-draft-dot": "slate-500",
  "stage-internal-bg": "blue-50",
  "stage-internal-fg": "blue-700",
  "stage-internal-dot": "blue-500",
  "stage-resubmitted-bg": "amber-50",
  "stage-resubmitted-fg": "amber-700",
  "stage-resubmitted-dot": "amber-500",
  "stage-pending-bg": "violet-50",
  "stage-pending-fg": "violet-700",
  "stage-pending-dot": "violet-500",
  "stage-approved-bg": "green-50",
  "stage-approved-fg": "green-800",
  "stage-approved-dot": "green-500",
  "stage-rejected-bg": "red-50",
  "stage-rejected-fg": "red-700",
  "stage-rejected-dot": "red-500",
  "stage-cancelled-bg": "slate-100",
  "stage-cancelled-fg": "slate-700",
  "stage-cancelled-dot": "slate-600",

  // Review Code: A green, B green (with comment icon), C orange, D red.
  "code-a-bg": "green-700",
  "code-a-fg": "white",
  "code-b-bg": "green-50",
  "code-b-fg": "green-800",
  "code-c-bg": "orange-50",
  "code-c-fg": "orange-800",
  "code-d-bg": "red-700",
  "code-d-fg": "white",

  // Step Age: whole weeks at the current step, grey turning red. age-0 is an empty dot.
  // Filled dots carry meaning, so they keep 3:1 against surfaces (WCAG 1.4.11).
  "age-0": "slate-350",
  "age-1": "slate-600",
  "age-2": "amber-700",
  "age-3": "orange-700",
  "age-4": "red-700",
} as const satisfies Record<string, PaletteColour>;

export type SemanticRole = keyof typeof coolLight;
export type Theme = Record<SemanticRole, PaletteColour>;

export const themes = { "cool-light": coolLight } as const satisfies Record<string, Theme>;
export type ThemeName = keyof typeof themes;
export const defaultTheme: ThemeName = "cool-light";

export function resolveRole(theme: Theme, role: SemanticRole): string {
  return palette[theme[role]];
}
