import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast.ts";
import { generateTokensCss } from "./generate.ts";
import { palette } from "./palette.ts";
import { shadows, spacing } from "./scales.ts";
import { coolLight, resolveRole, reviewCodes, segmentToneKeys, stageKeys, toneKeys, type SemanticRole } from "./themes.ts";

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#f95738", "#f95738")).toBeCloseTo(1, 5);
  });

  it("does not depend on the order of the colours", () => {
    expect(contrastRatio("#3d405b", "#f6f7f9")).toBeCloseTo(contrastRatio("#f6f7f9", "#3d405b"), 10);
  });
});

describe("cool light launch theme", () => {
  it("uses the approved canvas, brand Tomato and Delft", () => {
    expect(resolveRole(coolLight, "canvas")).toBe("#f6f7f9");
    expect(resolveRole(coolLight, "brand")).toBe("#f95738");
    expect(resolveRole(coolLight, "brand-ink")).toBe("#3d405b");
  });

  it("maps every role to a colour in the base palette", () => {
    for (const ref of Object.values(coolLight)) expect(Object.keys(palette)).toContain(ref);
  });

  it("has a role for every Stage, Review Code and Step Age", () => {
    const roles = Object.keys(coolLight);
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

  // WCAG 2.2 AA: 4.5:1 for text (1.4.3), 3:1 for focus indicators (1.4.11).
  const textPairs: [fg: SemanticRole, bg: SemanticRole][] = [
    ["text", "canvas"],
    ["text", "surface"],
    ["text-secondary", "surface"],
    ["muted", "surface"],
    ["muted", "canvas"],
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
    ["danger", "surface"],
    ["success", "surface"],
    ["primary", "surface"],
    ["on-inverse", "inverse"],
    // Badge tones (and Avatar initials): text on its tint.
    ...toneKeys.map((tone) => [`${tone}-fg`, `${tone}-tint`] as [SemanticRole, SemanticRole]),
    ...stageKeys.map(
      (s) => [`stage-${s}-fg`, `stage-${s}-bg`] as [SemanticRole, SemanticRole],
    ),
    ...reviewCodes.map((c) => [`code-${c}-fg`, `code-${c}-bg`] as [SemanticRole, SemanticRole]),
    // Kanban card chips (RP-410).
    ...["cv", "ar", "el", "me", "su", "other"].map((t) => [`trade-${t}-fg`, `trade-${t}-bg`] as [SemanticRole, SemanticRole]),
    ["revision-fg", "revision-bg"],
    ...segmentToneKeys.map((s) => [`segment-${s}-fg`, `segment-${s}-tint`] as [SemanticRole, SemanticRole]),
    // Solid avatars' initials (RP-407).
    ...["1", "2", "3", "4", "5", "6", "company"].map((a) => ["on-avatar", `avatar-${a}`] as [SemanticRole, SemanticRole]),
  ];

  it.each(textPairs)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(contrastRatio(resolveRole(coolLight, fg), resolveRole(coolLight, bg))).toBeGreaterThanOrEqual(4.5);
  });

  // Form control boundaries must be visible too (1.4.11), unlike decorative borders.
  const graphicPairs: [fg: SemanticRole, bg: SemanticRole][] = [
    ["focus", "surface"],
    ["focus", "canvas"],
    ["control-border", "surface"],
    ["control-border", "canvas"],
    ["control-border", "surface-subtle"],
    ["control-border-hover", "surface"],
    ["primary", "surface"],
    ...([1, 2, 3, 4] as const).flatMap((age) => [
      [`age-${age}`, "surface"] as [SemanticRole, SemanticRole],
      [`age-${age}`, "canvas"] as [SemanticRole, SemanticRole],
    ]),
  ];

  it.each(graphicPairs)("%s on %s meets 3:1", (fg, bg) => {
    expect(contrastRatio(resolveRole(coolLight, fg), resolveRole(coolLight, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("generated tokens.css", () => {
  const css = generateTokensCss();

  it("declares the base palette once, on :root", () => {
    expect(css).toContain("--palette-tomato-600: #f95738;");
  });

  it("declares semantic roles that point at the palette, not at raw colours", () => {
    expect(css).toMatch(/\[data-theme="cool-light"\][^{]*\{[^}]*--canvas: var\(--palette-slate-50\);/);
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
    expect(css).toMatch(/:root,\n\[data-theme="cool-light"\] \{[^}]*--shadow-colour: var\(--palette-slate-900\);/);
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
