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
  // Not in the design export: muted text a step darker than slate-600, so it keeps 4.5:1 on a pressed row too.
  "slate-625": "#666a76",
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

  // Menus and filled fields (the kit's forms.css --menu-bd, --fld-fill), in each theme.
  "menu-border-grey": "#e2e3e7",
  "field-fill-grey": "#f1f2f4",
  "navy-menu-border": "#2f3a55",
  "warm-menu-border": "#ece2d8",
  "warm-field-fill": "#f8f2ec",

  // The page's scrim behind a dialog (the kit's --ui-overlay), with its opacity: #rrggbbaa.
  "overlay-grey": "#0f142361",

  // The navy sidebar (the kit's shell.css `.rs` --sb-*): Theme 1, Grey, in Light and Dark. Its hover,
  // press and current item are the kit's translucent overlays (#rrggbbaa), laid on the sidebar.
  "navy-sidebar": "#131b2e",
  "navy-sidebar-card": "#1b2438",
  "navy-sidebar-divider": "#232d44",
  "white-6": "#ffffff0f",
  "white-10": "#ffffff1a",
  "tomato-16": "#f8552f29",

  // Theme 1, Grey, Dark: navy (the kit's theme.css `.theme-dark`, forms.css `.theme-dark`).
  "navy-canvas": "#0f1524",
  "navy-surface": "#161e31",
  "navy-surface-2": "#1a2336",
  "navy-hover": "#1c2539",
  "navy-ghost-hover": "#1f2940",
  "navy-press": "#232e47",
  "navy-ghost-press": "#273250",
  "navy-secondary-hover": "#2b3753",
  "navy-secondary-press": "#33405f",
  "navy-border-subtle": "#222c43",
  "navy-border": "#26314a",
  "navy-border-strong": "#34405c",
  "navy-disabled-fg": "#4f5870",
  "navy-faint": "#6b7488",
  "navy-muted": "#8c94a8",
  // Not in the kit: muted text a step lighter, 4.5:1 on a pressed row too.
  "navy-muted-text": "#9098ac",
  "navy-text-2": "#c5cad6",
  "navy-text": "#eef0f5",
  "navy-focus": "#6f97f0",
  "navy-overlay": "#04070f99",
  // Not in the kit: the lightest navy grey with 3:1 on the navy canvas, surface and subtle surface (WCAG 1.4.11).
  "navy-control": "#66718a",
  "black": "#000000",

  // Tonal hues on a dark page (the kit's `.theme-dark` --tone-*): a translucent tint and the lifted text on it.
  "dark-gray-tint": "#aab1bf24",
  "dark-gray-fg": "#aab1bf",
  "dark-green-tint": "#27b86e29",
  "dark-green-fg": "#5ad594",
  "dark-amber-tint": "#e9a23b29",
  "dark-amber-fg": "#f2c26b",
  "dark-red-tint": "#e5484d2e",
  "dark-red-fg": "#ff8a8d",
  "dark-blue-tint": "#3b6fd833",
  "dark-blue-fg": "#8fb2f6",
  "dark-violet-tint": "#7a5af033",
  "dark-violet-fg": "#b7a6fb",
  "dark-cyan-tint": "#1aa3b82e",
  "dark-cyan-fg": "#62d0e1",
  "dark-orange-tint": "#ee964b2e",
  "dark-orange-fg": "#f6b681",
  "dark-tomato-tint": "#f957382e",
  "dark-tomato-fg": "#ff9580",
  // Not in the kit: Code A's card line and an aged card's line on a dark page.
  "dark-green-line": "#27b86e66",
  "dark-green-card": "#27b86e1a",
  "dark-tomato-line": "#f9573880",

  // Theme 2, Warm, Light (the kit's shell.js `?bg=warm` :root override): warm neutrals, white surfaces.
  "warm-canvas": "#fdf9f5",
  "warm-surface-2": "#fcf7f2",
  "warm-hover": "#f9f2eb",
  "warm-press": "#f3eae1",
  "warm-secondary": "#f4ede6",
  "warm-secondary-hover": "#ece3da",
  "warm-border-subtle": "#f3ece5",
  "warm-border": "#efe6dd",
  "warm-border-strong": "#e3d8cd",
  "warm-gray-tint": "#f2eae2",
  "warm-disabled-fg": "#b8aa9d",
  "warm-faint": "#a8998c",
  "warm-gray-solid": "#a3958a",
  "warm-muted": "#7a6d62",
  // Not in the kit: muted text a step darker, 4.5:1 on a pressed row too.
  "warm-muted-text": "#74675c",
  "warm-gray-fg": "#6f6258",
  "warm-text-2": "#4a403a",
  "warm-text": "#2a221d",
  // Not in the kit: the lightest warm grey with 3:1 on the warm canvas, surface and subtle surface (WCAG 1.4.11).
  "warm-control": "#968779",

  // The espresso sidebar of Theme 2 in Light (`html .rs:not(.light):not(.theme-dark)` --sb-*).
  "espresso-sidebar": "#231b16",
  "espresso-sidebar-border": "#30261f",
  "espresso-sidebar-card": "#2e241e",
  "espresso-sidebar-divider": "#372c24",
  "espresso-sidebar-icon": "#ab9c8f",
  "espresso-sidebar-text": "#e6dcd2",
  "cream-6": "#ffecdc0f",
  "cream-10": "#ffecdc1a",
  "tomato-18": "#f8552f2e",
  "tomato-20": "#f8552f33",

  // Theme 2, Warm, Dark: espresso (`html .theme-dark` and `html .rs.theme-dark` of the same override).
  "espresso-sidebar-dark": "#110d0a",
  "espresso-canvas": "#16110e",
  "espresso-surface": "#1f1814",
  "espresso-surface-2": "#241c17",
  "espresso-hover": "#281f1a",
  "espresso-ghost-hover": "#2a211b",
  "espresso-press": "#312720",
  "espresso-ghost-press": "#342920",
  "espresso-secondary": "#2e241e",
  "espresso-secondary-hover": "#382c24",
  "espresso-secondary-press": "#42342a",
  "espresso-border-subtle": "#2f251f",
  "espresso-border": "#3a2e26",
  "espresso-border-strong": "#4a3c32",
  "espresso-disabled-fg": "#66584d",
  "espresso-faint": "#7f7166",
  "espresso-gray-solid": "#8f8074",
  "espresso-muted": "#a5978b",
  "espresso-gray-fg": "#c4b6aa",
  "espresso-text-2": "#d8ccc1",
  "espresso-text": "#f4ede6",
  "espresso-gray-tint": "#d6c4b421",
  "espresso-overlay": "#0a06049e",
  // Not in the kit: the lightest espresso grey with 3:1 on the espresso canvas, surface and subtle surface.
  "espresso-control": "#7c6e62",
} as const;

export type PaletteColour = keyof typeof palette;
