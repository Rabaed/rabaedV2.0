import type { Appearance, AppearanceTheme } from "@rabaed/domain";
import { resolveRole, themes } from "@rabaed/ui";

/** A Theme's surface token in one colour scheme, as #rrggbb. */
const surface = (theme: AppearanceTheme, scheme: "light" | "dark") => resolveRole(themes[`${theme}-${scheme}`], "surface");

/**
 * The `theme-color` that tints the browser's bar like the top bar (RP-1272): the surface token of the
 * Member's Theme and Mode. Always one per colour scheme, so the page can repaint them in place when the
 * Member changes their Theme or Mode; a fixed Mode gives both the same colour.
 */
export function themeColorOf({ theme, mode }: Appearance): { media: string; color: string }[] {
  return [
    { media: "(prefers-color-scheme: light)", color: surface(theme, mode === "dark" ? "dark" : "light") },
    { media: "(prefers-color-scheme: dark)", color: surface(theme, mode === "light" ? "light" : "dark") },
  ];
}

/** Repaints the page's `theme-color` tags, as the layout rendered them, for a new Theme or Mode. */
export function paintThemeColor(value: Appearance) {
  const colors = themeColorOf(value);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const color = colors.find((c) => c.media === meta.media)?.color;
    if (color !== undefined) meta.content = color;
  }
}
