/**
 * Type, spacing, radii and shadows, from the Claude Design export
 * (typography.css, spacing.css). Colours live in themes.ts; shadows take
 * theirs from the shadow-colour role.
 */

/**
 * Spacing uses Tailwind's 4px grid as is (`p-3` is 12px). These are the
 * padding, margin and gap steps the components use, shown in the token
 * specimen; a unit test keeps the list complete. Add a step here when a
 * component starts using it.
 */
export const spacing = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 12] as const;

// All self-hosted (src/styles/index.css), no font CDN. Latin text uses the first
// family; Arabic glyphs fall through to --font-arabic, which prepareArabicFont
// (src/fonts/arabic-font.ts) sets to Thmanyah Sans when its private files are
// present at build time and to IBM Plex Sans Arabic otherwise.
const arabic = "var(--font-arabic, 'IBM Plex Sans Arabic')";
const system = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const fonts = {
  ui: `'IBM Plex Sans Variable', ${arabic}, ${system}`,
  display: `'Montserrat Variable', ${arabic}, ${system}`,
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/** [size, line height] */
export const typeScale = {
  display: ["64px", "1.05"],
  h1: ["48px", "1.1"],
  h2: ["40px", "1.1"],
  h3: ["32px", "1.3"],
  h4: ["24px", "1.3"],
  h5: ["20px", "1.3"],
  h6: ["18px", "1.3"],
  lg: ["16px", "1.45"],
  body: ["14px", "1.45"],
  sm: ["13px", "1.45"],
  caption: ["12px", "1.3"],
  notes: ["11px", "1.3"],
  micro: ["10px", "1.3"],
} as const;

export const radii = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
} as const;

/** The `shadow-colour` role (themes.ts) at the given opacity, so a theme can change the tint. */
const shadowTint = (percent: number) => `color-mix(in srgb, var(--shadow-colour) ${percent}%, transparent)`;

export const shadows = {
  xs: `0 1px 2px ${shadowTint(5)}`,
  sm: `0 1px 3px ${shadowTint(8)}, 0 1px 2px ${shadowTint(4)}`,
  md: `0 4px 12px ${shadowTint(8)}`,
  lg: `0 14px 34px ${shadowTint(16)}`,
} as const;
