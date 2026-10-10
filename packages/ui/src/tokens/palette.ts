/**
 * Layer 1: the base palette. Raw colour values, named by hue and step.
 * Values come from the Claude Design export (design/reference/claude-design/tokens/colors.css
 * and theme.css). Components never read these; only themes (layer 2) do.
 */
export const palette = {
  white: "#ffffff",

  // Tomato: the brand primary (#f95738).
  "tomato-50": "#fff4f1",
  "tomato-100": "#feddd7",
  "tomato-200": "#fdc3b7",
  "tomato-300": "#fca898",
  "tomato-400": "#fb8d78",
  "tomato-500": "#fa7258",
  "tomato-600": "#f95738",
  "tomato-700": "#d1492f",
  "tomato-750": "#c9432a",
  "tomato-800": "#a93b26",
  "tomato-900": "#7e2c1d",

  // Delft Blue: the brand secondary / ink (#3d405b).
  "delft-50": "#eff0f3",
  "delft-100": "#dcdee4",
  "delft-200": "#a8abbe",
  "delft-300": "#80849d",
  "delft-400": "#696f8c",
  "delft-500": "#525677",
  "delft-600": "#3d405b",
  "delft-700": "#33364c",
  "delft-800": "#2a2d40",
  "delft-900": "#20212f",

  // Slate: the cool neutrals of the launch theme (canvas #f6f7f9).
  "slate-25": "#fafbfc",
  "slate-50": "#f6f7f9",
  "slate-100": "#eff0f2",
  "slate-150": "#ececef",
  "slate-200": "#e7e9ed",
  "slate-250": "#e4e6ea",
  "slate-300": "#d8dbe0",
  "slate-350": "#d5d8de",
  "slate-400": "#a8adb8",
  // Not in the design export: the lightest slate with 3:1 on white and canvas, for form control borders (WCAG 1.4.11).
  "slate-450": "#868c98",
  "slate-500": "#9aa0ad",
  "slate-600": "#6a6e7a",
  "slate-700": "#555a66",
  "slate-800": "#3a3f4b",
  "slate-900": "#1f2430",

  // Tonal hues: 50 = tint, 500 = solid, 700+ = text on tint.
  "green-50": "#e6f7ee",
  // Not in the design export: a light green line for Code A's card (RP-410).
  "green-200": "#bde9d1",
  "green-500": "#27b86e",
  "green-700": "#16874f",
  "green-800": "#127043",
  "amber-50": "#fdf3dc",
  "amber-500": "#e9a23b",
  "amber-700": "#9a6206",
  "orange-50": "#fdeee2",
  "orange-500": "#ee964b",
  "orange-700": "#b8560f",
  "orange-800": "#a24b0c",
  "red-50": "#fdebea",
  "red-500": "#e5484d",
  "red-700": "#c8322b",
  "red-800": "#bf3136",
  "red-900": "#9f282c",
  "blue-50": "#e8f0fd",
  "blue-500": "#3b6fd8",
  "blue-700": "#2f62c9",
  "violet-50": "#f0ecfe",
  "violet-500": "#7a5af0",
  "violet-700": "#6547d6",
  // A Project's letter tile (RP-408): the design kit's own tomato, blue and purple; its green and orange
  // darkened just enough for the white letter (19px / 800 is large text) to reach 3:1.
  "tile-tomato": "#f8552f",
  "tile-blue": "#3d6db5",
  "tile-green": "#1ea762",
  "tile-purple": "#6b5ad8",
  "tile-orange": "#d27d3e",
  "cyan-50":"#e2f5f8",
  "cyan-500": "#1aa3b8",
  "cyan-700": "#0f7688",

  // Mid tones behind a person's initials (the kit's Members list, RP-413): bright enough to tell people apart.
  // Orange and green are the kit's hues in the shade that keeps white initials at 4.5:1 (axe).
  "person-violet": "#6b5ad8",
  "person-blue": "#3d6db5",
  "person-brown": "#7a5c3a",
  "person-orange": "#b8560f",
  "person-rose": "#b5455a",
  "person-green": "#16874f",
  "person-plum": "#9a4f9e",
} as const;

export type PaletteColour = keyof typeof palette;
