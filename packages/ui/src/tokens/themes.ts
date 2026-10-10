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
 * Four themes (owner decision 2026-10-11, the kit's background comparison): Theme 1 Grey
 * (light canvas #f6f7f9, dark navy) and Theme 2 Warm (light #fdf9f5, dark espresso), each
 * with a Light and a Dark mode, every role taken from the kit (theme.css, forms.css,
 * shell.css and the warm override in shell/shell.js). Both keep the dark sidebar in Light.
 * Where the kit's text/fill pairs fall below WCAG AA contrast, the role points at a
 * darker step of the same hue (e.g. primary fill is tomato-750, not the brand tomato-600,
 * so white button text reads at 4.5:1); tokens.test.ts checks every pair in every theme.
 * Fills (primary, danger) carry white text; text in a hue reads its `-fg` role.
 *
 * Grey Light, the launch theme (canvas #f6f7f9), per design change requests §7.
 */
export const greyLight = {
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
  // The scrim behind a dialog or drawer, with its own opacity.
  overlay: "overlay-grey",

  // The sidebar: dark in every theme and mode (owner decision 2026-10-11), navy in Grey.
  sidebar: "navy-sidebar",
  "sidebar-border": "navy-ghost-hover",
  "sidebar-divider": "navy-sidebar-divider",
  "sidebar-card": "navy-sidebar-card",
  "sidebar-text": "navy-text-2",
  // The kit's section labels (#6b7488) read below 4.5:1 on the sidebar: they take the icon colour.
  "sidebar-label": "navy-muted",
  "sidebar-icon": "navy-muted",
  "sidebar-hover": "white-6",
  "sidebar-press": "white-10",
  "sidebar-current": "tomato-16",
  "sidebar-current-text": "white",

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

  // Solid fills for a person's initials in the Members list (Avatar `solidFrom`, RP-413), white text on them.
  "member-avatar-1": "person-violet",
  "member-avatar-2": "person-blue",
  "member-avatar-3": "person-brown",
  "member-avatar-4": "person-orange",
  "member-avatar-5": "person-rose",
  "member-avatar-6": "person-green",
  "member-avatar-7": "person-plum",
  // A Project's letter tile (the design kit's Projects page): one of five colours, tomato, blue, green,
  // purple, orange, picked from the Project's id so it never changes. The letter is large text: 3:1.
  "project-tile-1": "tile-tomato",
  "project-tile-2": "tile-blue",
  "project-tile-3": "tile-green",
  "project-tile-4": "tile-purple",
  "project-tile-5": "tile-orange",

  // Step Age: whole weeks at the current step, grey turning red. age-0 is an empty dot.
  // Filled dots carry meaning, so they keep 3:1 against surfaces (WCAG 1.4.11).
  "age-0": "slate-350",
  "age-1": "slate-600",
  "age-2": "amber-700",
  "age-3": "orange-700",
  "age-4": "red-700",
} as const satisfies Record<string, PaletteColour>;

export type SemanticRole = keyof typeof greyLight;
export type Theme = Record<SemanticRole, PaletteColour>;

/** What every dark mode shares: the kit's tones on a dark page (`.theme-dark` --tone-*); solid fills keep white text, as in Light. */
const darkTones = {
  "shadow-colour": "black",
  "brand-tint": "dark-tomato-tint",
  "brand-fg": "dark-tomato-fg",
  success: "dark-green-fg",
  "success-tint": "dark-green-tint",
  "success-fg": "dark-green-fg",
  "danger-tint": "dark-red-tint",
  "danger-fg": "dark-red-fg",
  "neutral-tint": "dark-gray-tint",
  "neutral-fg": "dark-gray-fg",
  "info-tint": "dark-blue-tint",
  "info-fg": "dark-blue-fg",
  "warning-tint": "dark-amber-tint",
  "warning-fg": "dark-amber-fg",
  "trade-cv-bg": "dark-amber-tint",
  "trade-cv-fg": "dark-amber-fg",
  "trade-ar-bg": "dark-violet-tint",
  "trade-ar-fg": "dark-violet-fg",
  "trade-el-bg": "dark-cyan-tint",
  "trade-el-fg": "dark-cyan-fg",
  "trade-me-bg": "dark-green-tint",
  "trade-me-fg": "dark-green-fg",
  "trade-su-bg": "dark-orange-tint",
  "trade-su-fg": "dark-orange-fg",
  "trade-other-bg": "dark-blue-tint",
  "trade-other-fg": "dark-blue-fg",
  "revision-bg": "dark-tomato-tint",
  "revision-fg": "dark-tomato-fg",
  "card-aged-border": "dark-tomato-line",
  "card-approved-border": "dark-green-line",
  "stage-draft-bg": "dark-gray-tint",
  "stage-draft-fg": "dark-gray-fg",
  "stage-internal-bg": "dark-blue-tint",
  "stage-internal-fg": "dark-blue-fg",
  "stage-resubmitted-bg": "dark-amber-tint",
  "stage-resubmitted-fg": "dark-amber-fg",
  "stage-pending-bg": "dark-violet-tint",
  "stage-pending-fg": "dark-violet-fg",
  "stage-approved-bg": "dark-green-tint",
  "stage-approved-fg": "dark-green-fg",
  "stage-rejected-bg": "dark-red-tint",
  "stage-rejected-fg": "dark-red-fg",
  "stage-cancelled-bg": "dark-gray-tint",
  "stage-cancelled-fg": "dark-gray-fg",
  "code-b-bg": "dark-green-tint",
  "code-b-fg": "dark-green-fg",
  "code-c-bg": "dark-amber-tint",
  "code-c-fg": "dark-amber-fg",
  "segment-project-tint": "dark-gray-tint",
  "segment-project-fg": "dark-gray-fg",
  "segment-participant-tint": "dark-tomato-tint",
  "segment-participant-fg": "dark-tomato-fg",
  "segment-trade-tint": "dark-cyan-tint",
  "segment-trade-fg": "dark-cyan-fg",
  "segment-type-tint": "dark-violet-tint",
  "segment-type-fg": "dark-violet-fg",
  "segment-location-tint": "dark-amber-tint",
  "segment-location-fg": "dark-amber-fg",
  "segment-text-tint": "dark-blue-tint",
  "segment-text-fg": "dark-blue-fg",
  "segment-sequence-tint": "dark-gray-tint",
  "age-2": "dark-amber-fg",
  "age-3": "dark-orange-fg",
  "age-4": "dark-red-fg",
} as const satisfies Partial<Theme>;

/** Theme 1, Grey, Dark: navy (the kit's theme.css and forms.css `.theme-dark`), the same navy sidebar. */
export const greyDark = {
  ...greyLight,
  ...darkTones,
  canvas: "navy-canvas",
  surface: "navy-surface",
  "surface-subtle": "navy-surface-2",
  hover: "navy-hover",
  press: "navy-press",
  border: "navy-border",
  "border-subtle": "navy-border-subtle",
  "border-strong": "navy-border-strong",
  "control-border": "navy-control",
  "control-border-hover": "navy-muted",
  overlay: "navy-overlay",
  text: "navy-text",
  "text-secondary": "navy-text-2",
  muted: "navy-muted",
  faint: "navy-faint",
  "brand-ink": "navy-text-2",
  secondary: "navy-press",
  "secondary-hover": "navy-secondary-hover",
  "secondary-press": "navy-secondary-press",
  "on-secondary": "navy-text",
  "ghost-hover": "navy-ghost-hover",
  "ghost-press": "navy-ghost-press",
  "on-ghost": "navy-text-2",
  disabled: "navy-hover",
  "on-disabled": "navy-disabled-fg",
  focus: "navy-focus",
  "focus-offset": "navy-surface",
  // Tooltips and short confirmations: light on the dark page, as the kit's chosen chips.
  inverse: "navy-text",
  "on-inverse": "navy-canvas",
  "segment-sequence-fg": "navy-text",
  "segment-sequence-solid": "navy-text",
  "age-0": "navy-border-strong",
  "age-1": "navy-muted",
} as const satisfies Theme;

/** Theme 2, Warm, Light (the kit's `?bg=warm` override): warm neutrals, white surfaces, the espresso sidebar. */
export const warmLight = {
  ...greyLight,
  canvas: "warm-canvas",
  "surface-subtle": "warm-surface-2",
  hover: "warm-hover",
  press: "warm-press",
  border: "warm-border",
  "border-subtle": "warm-border-subtle",
  "border-strong": "warm-border-strong",
  "control-border": "warm-control",
  "control-border-hover": "warm-muted",
  "shadow-colour": "warm-text",
  text: "warm-text",
  "text-secondary": "warm-text-2",
  muted: "warm-muted",
  faint: "warm-faint",
  secondary: "warm-secondary",
  "secondary-hover": "warm-secondary-hover",
  "secondary-press": "warm-border-strong",
  "on-secondary": "warm-text",
  "ghost-hover": "warm-secondary",
  "ghost-press": "warm-secondary-hover",
  "on-ghost": "warm-text-2",
  disabled: "warm-secondary",
  "on-disabled": "warm-disabled-fg",
  inverse: "warm-text",
  "neutral-tint": "warm-gray-tint",
  "neutral-fg": "warm-gray-fg",
  "stage-draft-bg": "warm-gray-tint",
  "stage-draft-fg": "warm-gray-fg",
  "stage-draft-dot": "warm-gray-solid",
  "stage-cancelled-bg": "warm-gray-tint",
  "stage-cancelled-fg": "warm-gray-fg",
  "stage-cancelled-dot": "warm-muted",
  "segment-project-tint": "warm-gray-tint",
  "segment-project-fg": "warm-gray-fg",
  "segment-project-solid": "warm-muted",
  "segment-sequence-tint": "warm-gray-tint",
  "segment-sequence-fg": "warm-text",
  "segment-sequence-solid": "warm-text",
  "avatar-company": "warm-muted",
  "age-0": "warm-border-strong",
  "age-1": "warm-muted",
  sidebar: "espresso-sidebar",
  "sidebar-border": "espresso-sidebar-border",
  "sidebar-divider": "espresso-sidebar-divider",
  "sidebar-card": "espresso-sidebar-card",
  "sidebar-text": "espresso-sidebar-text",
  "sidebar-label": "espresso-sidebar-icon",
  "sidebar-icon": "espresso-sidebar-icon",
  "sidebar-hover": "cream-6",
  "sidebar-press": "cream-10",
  "sidebar-current": "tomato-18",
} as const satisfies Theme;

/** Theme 2, Warm, Dark: espresso (`html .theme-dark` and `html .rs.theme-dark` of the same override). */
export const warmDark = {
  ...greyDark,
  canvas: "espresso-canvas",
  surface: "espresso-surface",
  "surface-subtle": "espresso-surface-2",
  hover: "espresso-hover",
  press: "espresso-press",
  border: "espresso-border",
  "border-subtle": "espresso-border-subtle",
  "border-strong": "espresso-border-strong",
  "control-border": "espresso-control",
  "control-border-hover": "espresso-muted",
  overlay: "espresso-overlay",
  text: "espresso-text",
  "text-secondary": "espresso-text-2",
  muted: "espresso-muted",
  faint: "espresso-faint",
  "brand-ink": "espresso-text-2",
  secondary: "espresso-secondary",
  "secondary-hover": "espresso-secondary-hover",
  "secondary-press": "espresso-secondary-press",
  "on-secondary": "espresso-text",
  "ghost-hover": "espresso-ghost-hover",
  "ghost-press": "espresso-ghost-press",
  "on-ghost": "espresso-text-2",
  disabled: "espresso-hover",
  "on-disabled": "espresso-disabled-fg",
  "focus-offset": "espresso-surface",
  inverse: "espresso-text",
  "on-inverse": "espresso-canvas",
  "neutral-tint": "espresso-gray-tint",
  "neutral-fg": "espresso-gray-fg",
  "stage-draft-bg": "espresso-gray-tint",
  "stage-draft-fg": "espresso-gray-fg",
  "stage-draft-dot": "espresso-gray-solid",
  "stage-cancelled-bg": "espresso-gray-tint",
  "stage-cancelled-fg": "espresso-gray-fg",
  "stage-cancelled-dot": "espresso-gray-solid",
  "segment-project-tint": "espresso-gray-tint",
  "segment-project-fg": "espresso-gray-fg",
  "segment-project-solid": "espresso-gray-solid",
  "segment-sequence-tint": "espresso-gray-tint",
  "segment-sequence-fg": "espresso-text",
  "segment-sequence-solid": "espresso-text",
  "avatar-company": "warm-muted",
  "age-0": "espresso-border-strong",
  "age-1": "espresso-muted",
  sidebar: "espresso-sidebar-dark",
  "sidebar-border": "espresso-ghost-hover",
  "sidebar-divider": "espresso-ghost-hover",
  "sidebar-card": "espresso-surface",
  "sidebar-text": "espresso-sidebar-text",
  "sidebar-label": "espresso-muted",
  "sidebar-icon": "espresso-muted",
  "sidebar-hover": "cream-6",
  "sidebar-press": "cream-10",
  "sidebar-current": "tomato-20",
} as const satisfies Theme;

/** The four themes, by Theme and Mode (`<html data-theme data-mode>`). */
export const themes = {
  "grey-light": greyLight,
  "grey-dark": greyDark,
  "warm-light": warmLight,
  "warm-dark": warmDark,
} as const satisfies Record<string, Theme>;
export type ThemeName = keyof typeof themes;
/** A page with no Theme on it (the stories, unless they choose one): Grey, Light. */
export const defaultTheme: ThemeName = "grey-light";

/**
 * A role's colour as #rrggbb. A translucent one (#rrggbbaa: a dark tint, the sidebar's hover) is
 * laid on `under`, the colour it sits on, as the browser shows it.
 */
export function resolveRole(theme: Theme, role: SemanticRole, under?: SemanticRole): string {
  const colour: string = palette[theme[role]];
  if (colour.length === 7) return colour;
  if (under === undefined) throw new Error(`${role} is translucent: say what it sits on`);
  return composite(colour, resolveRole(theme, under));
}

/** A #rrggbbaa colour laid on an opaque #rrggbb one. */
export function composite(top: string, bottom: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const alpha = channel(top, 3) / 255;
  const mixed = [0, 1, 2].map((i) => Math.round(channel(top, i) * alpha + channel(bottom, i) * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
