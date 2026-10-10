import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast.ts";
import { generateTokensCss } from "./generate.ts";
import { palette } from "./palette.ts";
import { shadows, spacing } from "./scales.ts";
import { composite, greyDark, greyLight, resolveRole, reviewCodes, segmentToneKeys, stageKeys, themes, toneKeys, warmDark, warmLight, type SemanticRole, type Theme } from "./themes.ts";

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#f95738", "#f95738")).toBeCloseTo(1, 5);
  });

  it("does not depend on the order of the colours", () => {
    expect(contrastRatio("#3d405b", "#f6f7f9")).toBeCloseTo(contrastRatio("#f6f7f9", "#3d405b"), 10);
  });
});

describe("the four themes (owner decision 2026-10-11)", () => {
  it("use the kit's canvas, surface and sidebar of each Theme and Mode", () => {
    const of = (theme: Theme) => [resolveRole(theme, "canvas"), resolveRole(theme, "surface"), resolveRole(theme, "sidebar")];
    expect(of(greyLight)).toEqual(["#f6f7f9", "#ffffff", "#131b2e"]);
    expect(of(greyDark)).toEqual(["#0f1524", "#161e31", "#131b2e"]);
    expect(of(warmLight)).toEqual(["#fdf9f5", "#ffffff", "#231b16"]);
    expect(of(warmDark)).toEqual(["#16110e", "#1f1814", "#110d0a"]);
  });

  it("keep the brand Tomato and Delft", () => {
    for (const theme of Object.values(themes)) expect(resolveRole(theme, "brand")).toBe("#f95738");
    expect(resolveRole(greyLight, "brand-ink")).toBe("#3d405b");
  });

  it("map every role to a colour in the base palette, in all four", () => {
    for (const theme of Object.values(themes)) {
      expect(Object.keys(theme).sort()).toEqual(Object.keys(greyLight).sort());
      for (const ref of Object.values(theme)) expect(Object.keys(palette)).toContain(ref);
    }
  });

  it("have a role for every Stage, Review Code and Step Age", () => {
    const roles = Object.keys(greyLight);
    for (const stage of stageKeys) {
      for (const part of ["bg", "fg", "dot"]) expect(roles).toContain(`stage-${stage}-${part}`);
    }
    for (const code of reviewCodes) {
      expect(roles).toContain(`code-${code}-bg`);
      expect(roles).toContain(`code-${code}-fg`);
    }
    for (const age of [0, 1, 2, 3, 4]) expect(roles).toContain(`age-${age}`);
    for (const tone of toneKeys) {
      expect(roles).toContain(`${tone}-tint`);
      expect(roles).toContain(`${tone}-fg`);
    }
  });

  it("lay a translucent colour on the one under it", () => {
    expect(composite("#ffffff80", "#000000")).toBe("#808080");
    expect(resolveRole(greyDark, "success-tint", "surface")).toBe(composite("#27b86e29", "#161e31"));
    expect(() => resolveRole(greyDark, "success-tint")).toThrow();
  });

  // WCAG 2.2 AA: 4.5:1 for text (1.4.3), 3:1 for focus indicators and controls (1.4.11). A fill
  // (primary, danger) carries white text; text in a hue is its `-fg` role.
  const textPairs: [fg: SemanticRole, bg: SemanticRole][] = [
    ["text", "canvas"],
    ["text", "surface"],
    ["text", "surface-subtle"],
    ["text-secondary", "surface"],
    ["muted", "surface"],
    ["muted", "canvas"],
    ["muted", "surface-subtle"],
    ["on-primary", "primary"],
    ["on-primary", "primary-hover"],
    ["on-primary", "primary-press"],
    ["on-secondary", "secondary"],
    ["on-secondary", "secondary-hover"],
    ["on-secondary", "secondary-press"],
    ["on-ghost", "surface"],
    ["on-ghost", "ghost-hover"],
    ["on-ghost", "ghost-press"],
    ["on-danger", "danger"],
    ["on-danger", "danger-hover"],
    ["on-danger", "danger-press"],
    ["danger-fg", "surface"],
    ["danger-fg", "canvas"],
    ["success", "surface"],
    ["brand-fg", "surface"],
    ["brand-fg", "canvas"],
    ["on-inverse", "inverse"],
    // Badge tones (and Avatar initials): text on its tint.
    ...toneKeys.map((tone) => [`${tone}-fg`, `${tone}-tint`] as [SemanticRole, SemanticRole]),
    ...stageKeys.map((s) => [`stage-${s}-fg`, `stage-${s}-bg`] as [SemanticRole, SemanticRole]),
    ...reviewCodes.map((c) => [`code-${c}-fg`, `code-${c}-bg`] as [SemanticRole, SemanticRole]),
    // Kanban card chips (RP-410).
    ...["cv", "ar", "el", "me", "su", "other"].map((t) => [`trade-${t}-fg`, `trade-${t}-bg`] as [SemanticRole, SemanticRole]),
    ["revision-fg", "revision-bg"],
    ...segmentToneKeys.map((s) => [`segment-${s}-fg`, `segment-${s}-tint`] as [SemanticRole, SemanticRole]),
    // Solid avatars' initials (RP-407).
    ...["1", "2", "3", "4", "5", "6", "company"].map((a) => ["on-avatar", `avatar-${a}`] as [SemanticRole, SemanticRole]),
    // The dark sidebar, in every theme and mode.
    ["sidebar-text", "sidebar"],
    ["sidebar-label", "sidebar"],
    ["sidebar-text", "sidebar-hover"],
    ["sidebar-text", "sidebar-card"],
    ["sidebar-current-text", "sidebar-current"],
  ];

  // Form control boundaries must be visible too (1.4.11), unlike decorative borders.
  const graphicPairs: [fg: SemanticRole, bg: SemanticRole][] = [
    ["focus", "surface"],
    ["focus", "canvas"],
    ["control-border", "surface"],
    ["control-border", "canvas"],
    ["control-border", "surface-subtle"],
    ["control-border-hover", "surface"],
    ["primary", "surface"],
    ["primary", "canvas"],
    ["danger-fg", "surface"],
    ["sidebar-icon", "sidebar"],
    ["brand", "sidebar"],
    // A Project's letter tile: a 19px / 800 letter is large text, so 3:1.
    ...(["1", "2", "3", "4", "5"] as const).map((n) => ["on-avatar", `project-tile-${n}`] as [SemanticRole, SemanticRole]),
    ...([1, 2, 3, 4] as const).flatMap((age) => [
      [`age-${age}`, "surface"] as [SemanticRole, SemanticRole],
      [`age-${age}`, "canvas"] as [SemanticRole, SemanticRole],
    ]),
  ];

  /** A pair as the page shows it: a translucent background on the surface (or the sidebar), a translucent text on that background. */
  const contrastOf = (theme: Theme, fg: SemanticRole, bg: SemanticRole) => {
    const under: SemanticRole = bg.startsWith("sidebar-") ? "sidebar" : "surface";
    const back = resolveRole(theme, bg, under);
    const front: string = palette[theme[fg]];
    return contrastRatio(front.length === 9 ? composite(front, back) : front, back);
  };

  const cases = (pairs: [SemanticRole, SemanticRole][]) =>
    Object.entries(themes).flatMap(([name, theme]) => pairs.map(([fg, bg]) => [name, fg, bg, theme] as const));

  it.each(cases(textPairs))("%s: %s on %s meets 4.5:1", (_name, fg, bg, theme) => {
    expect(contrastOf(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases(graphicPairs))("%s: %s on %s meets 3:1", (_name, fg, bg, theme) => {
    expect(contrastOf(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("generated tokens.css", () => {
  const css = generateTokensCss();

  it("declares the base palette once, on :root", () => {
    expect(css).toContain("--palette-tomato-600: #f95738;");
  });

  it("declares semantic roles that point at the palette, not at raw colours", () => {
    expect(css).toMatch(/\[data-theme="grey"\]\[data-mode="light"\][^{]*\{[^}]*--canvas: var\(--palette-slate-50\);/);
    expect(css).toMatch(/\[data-theme="warm"\]\[data-mode="dark"\] \{[^}]*--canvas: var\(--palette-espresso-canvas\);/);
  });

  it("gives a page with no Theme Grey Light, and Mode System the device's light or dark", () => {
    expect(css).toMatch(/:root,\n\[data-theme="grey"\]\[data-mode="light"\],\n\[data-theme="grey"\]\[data-mode="system"\] \{\n {2}color-scheme: light;/);
    expect(css).toMatch(/\[data-theme="warm"\]\[data-mode="light"\],\n\[data-theme="warm"\]\[data-mode="system"\] \{[^}]*--canvas: var\(--palette-warm-canvas\);/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\n {2}\[data-theme="warm"\]\[data-mode="system"\] \{\n {4}color-scheme: dark;[^}]*--canvas: var\(--palette-espresso-canvas\);/,
    );
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}\[data-theme="grey"\]\[data-mode="system"\] \{[^}]*--canvas: var\(--palette-navy-canvas\);/);
  });

  it("exposes only semantic roles as Tailwind colours", () => {
    const theme = css.slice(css.indexOf("@theme"));
    expect(theme).toContain("--color-*: initial;");
    expect(theme).toContain("--color-canvas: var(--canvas);");
    expect(theme).toContain("--color-code-b-bg: var(--code-b-bg);");
    expect(theme).not.toContain("--color-palette");
    expect(theme).not.toMatch(/--color-[\w-]+: #/);
  });

  it("sends Arabic glyphs to the build-time Arabic font, with IBM Plex Sans Arabic as the fallback", () => {
    for (const name of ["ui", "display"]) {
      expect(css).toMatch(new RegExp(`--font-${name}: '[^']+ Variable', var\\(--font-arabic, 'IBM Plex Sans Arabic'\\),`));
    }
    expect(css).not.toContain("Thmanyah");
  });

  it("tints every shadow with the shadow-colour role, so a theme can change it", () => {
    expect(css).toMatch(/:root,\n\[data-theme="grey"\]\[data-mode="light"\],[^{]*\{[^}]*--shadow-colour: var\(--palette-slate-900\);/);
    const shadowLines = css.split("\n").filter((line) => /^\s*--shadow-(xs|sm|md|lg):/.test(line));
    expect(shadowLines).toHaveLength(Object.keys(shadows).length);
    for (const line of shadowLines) {
      expect(line).toContain("var(--shadow-colour)");
      expect(line).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
    }
  });

  it("is up to date with src/tokens (run `pnpm --filter @rabaed/ui tokens`)", () => {
    const committed = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    expect(committed).toBe(css);
  });
});

describe("spacing", () => {
  // Padding, margin and gap classes such as `px-2.5`, `-mt-1`, `gap-x-3`, `space-y-4`.
  const spacingClass = /(?<![\w-])-?(?:p|px|py|ps|pe|pt|pb|m|mx|my|ms|me|mt|mb|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.5)?)(?![\w.-])/g;
  const componentsDir = new URL("../components/", import.meta.url);
  const sources = readdirSync(componentsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(stories|test)\./.test(file))
    .map((file) => readFileSync(new URL(file.replaceAll("\\", "/"), componentsDir), "utf8"));

  it("lists, in order, every step the components use (the specimen shows this list)", () => {
    const used = new Set(
      sources.flatMap((source) => [...source.matchAll(spacingClass)].map((match) => Number(match[1])).filter((step) => step > 0)),
    );
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((step) => !(spacing as readonly number[]).includes(step))).toEqual([]);
    expect([...spacing]).toEqual([...spacing].sort((a, b) => a - b));
  });
});
