import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// RP-1256: `Icon` already mirrors a directional icon in Arabic (`directionalIconNames`), so an
// app component must not mirror it again (`rtl:rotate-180`, `rtl:-scale-x-100`) or pick a
// left/right icon by locale: either points it against the reading direction (RP-1114).
// The web app's server components have no stories, so this reads their source.

const root = join(import.meta.dirname, "..", "..");
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.(test|stories)\.tsx$/.test(entry.name) ? [path] : [];
  });

describe("directional icons are mirrored once, by Icon", () => {
  const icons = sources(join(root, "src")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/<Icon\b[^>]*>/g)].map((m) => ({ file: file.slice(root.length + 1), tag: m[0] })),
  );

  it("finds the Icons", () => {
    expect(icons.length).toBeGreaterThan(0);
  });

  it("no Icon carries its own RTL mirror", () => {
    expect(icons.filter(({ tag }) => /rtl:(rotate-180|-scale-x-100)/.test(tag)).map(({ file }) => file)).toEqual([]);
  });

  it("no Icon picks left or right by locale", () => {
    expect(icons.filter(({ tag }) => /locale\s*===\s*"ar"\s*\?\s*"(chevron|arrow)-/.test(tag)).map(({ file }) => file)).toEqual([]);
  });
});
