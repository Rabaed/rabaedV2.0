/**
 * Non-colour tokens: type, radii and shadows, from the Claude Design export
 * (typography.css, spacing.css). Spacing uses Tailwind's 4px grid as is.
 */

// Licensed or self-hosted families are wired up in RP-200 (fonts); until then
// the stacks fall back to system fonts, so every build renders without them.
export const fonts = {
  ui: "'IBM Plex Sans', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Montserrat', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif",
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

export const shadows = {
  xs: "0 1px 2px rgba(31, 36, 48, 0.05)",
  sm: "0 1px 3px rgba(61, 64, 91, 0.08), 0 1px 2px rgba(61, 64, 91, 0.04)",
  md: "0 4px 12px rgba(61, 64, 91, 0.08)",
  lg: "0 14px 34px rgba(15, 20, 35, 0.16)",
} as const;
