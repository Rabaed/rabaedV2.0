import type { ThemeName } from "../tokens/themes.ts";

/**
 * A story painted in one of the four themes (owner decision 2026-10-11): `parameters: themed("warm-dark")`.
 * The preview puts its Theme and Mode on <html>, as the app's server does, so portals (menus,
 * dialogs) are painted in it too. A story without one is Grey, Light (no Theme on the page).
 */
export const themed = (theme: ThemeName) => ({ theme });

/** The four, in the order the theme stories show them. */
export const storyThemes: readonly ThemeName[] = ["grey-light", "grey-dark", "warm-light", "warm-dark"];

/** Puts a theme on <html> (`data-theme`, `data-mode`), or takes it off. */
export function paintTheme(theme: ThemeName | undefined): void {
  const root = document.documentElement;
  if (theme === undefined) {
    delete root.dataset.theme;
    delete root.dataset.mode;
    return;
  }
  const [family, mode] = theme.split("-") as [string, string];
  root.dataset.theme = family;
  root.dataset.mode = mode;
}
