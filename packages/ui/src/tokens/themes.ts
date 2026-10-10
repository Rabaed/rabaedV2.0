import { palette, type PaletteColour } from "./palette.ts";

/**
 * Colour keys for the Rabaed Default Stages (GLOSSARY.md): Drafts, Internal Review,
 * Revised & Resubmitted, Pending Approval, Approved, Rejected, Cancelled.
 */
export const stageKeys = ["draft", "internal", "resubmitted", "pending", "approved", "rejected", "cancelled"] as const;
export type StageKey = (typeof stageKeys)[number];

/** Review Codes: A Approved, B Approved with Comments, C Revise and Resubmit, D Rejected. */
export const reviewCodes = ["a", "b", "c", "d"] as const;
export type ReviewCode = (typeof reviewCodes)[number];

/** Numbering Pattern segment kinds with a colour of their own, and the sequence (RP-412). */
export const segmentToneKeys = ["project", "participant", "trade", "type", "location", "text", "sequence"] as const;
export type SegmentTone = (typeof segmentToneKeys)[number];

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

  // Trade chips (the Kanban card, RP-410): a Trade in its own hue, by its code; any other Trade in blue.
  "trade-cv-bg": "amber-50",
  "trade-cv-fg": "amber-700",
  "trade-ar-bg": "violet-50",
  "trade-ar-fg": "violet-700",
  "trade-el-bg": "cyan-50",
  "trade-el-fg": "cyan-700",
  "trade-me-bg": "green-50",
  "trade-me-fg": "green-800",
  "trade-su-bg": "orange-50",
  "trade-su-fg": "orange-800",
  "trade-other-bg": "blue-50",
  "trade-other-fg": "blue-700",
  // The Revision badge (R1, R2…) while no outcome is issued.
  "revision-bg": "tomato-50",
  "revision-fg": "tomato-750",
  // Kanban card borders: an item 4+ weeks at its step (no wording, only this look and the red dots), and Code A's green card.
  "card-aged-border": "tomato-300",
  "card-approved-border": "green-200",

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

  // Numbering Pattern segments (RP-412): a tint, the text on it and a solid mark per segment kind,
  // so a Document Number's parts read apart in the preview, chips and legend.
  "segment-project-tint": "slate-100",
  "segment-project-fg": "slate-700",
  "segment-project-solid": "slate-600",
  "segment-participant-tint": "tomato-50",
  "segment-participant-fg": "tomato-750",
  "segment-participant-solid": "tomato-600",
  "segment-trade-tint": "cyan-50",
  "segment-trade-fg": "cyan-700",
  "segment-trade-solid": "cyan-500",
  "segment-type-tint": "violet-50",
  "segment-type-fg": "violet-700",
  "segment-type-solid": "violet-500",
  "segment-location-tint": "amber-50",
  "segment-location-fg": "amber-700",
  "segment-location-solid": "amber-500",
  "segment-text-tint": "blue-50",
  "segment-text-fg": "blue-700",
  "segment-text-solid": "blue-500",
  "segment-sequence-tint": "slate-100",
  "segment-sequence-fg": "slate-900",
  "segment-sequence-solid": "slate-900",

  // Solid avatars (the design kit's Home, RP-407): a person's colour picked from their name, a
  // Company's slate, white initials on each at 4.5:1.
  "avatar-1": "blue-700",
  "avatar-2": "green-700",
  "avatar-3": "violet-700",
  "avatar-4": "orange-700",
  "avatar-5": "cyan-700",
  "avatar-6": "red-700",
  "avatar-company": "slate-600",
  "on-avatar": "white",

  // A Project's letter tile (the design kit's Projects page): one of five colours, tomato, blue, green,
  // purple, orange, picked from the Project's id so it never changes; white letter at 4.5:1.
  "project-tile-1": "tomato-750",
  "project-tile-2": "blue-700",
  "project-tile-3": "green-700",
  "project-tile-4": "violet-700",
  "project-tile-5": "orange-700",

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
