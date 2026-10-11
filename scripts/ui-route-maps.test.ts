import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// RP-546: the directory map in packages/ui/README.md and the route map in
// apps/web/README.md must match the disk, so they can't go stale.
const root = resolve(import.meta.dirname, "..");
const uiRoot = join(root, "packages/ui");
const localeRoot = join(root, "apps/web/src/app/[locale]");

/** The first backticked cell of every table row, in the section that starts at `heading` and runs to the next `## `/`### `. */
function firstCells(file: string, heading: string, from = 0): string[] {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(heading, from);
  if (start < 0) throw new Error(`${file} has no "${heading}"`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]!);
}

function pagesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) return name.startsWith("@") ? [] : pagesUnder(full, rel);
    return name === "page.tsx" ? [rel] : [];
  });
}

describe("packages/ui/README.md directory map", () => {
  const readme = join(uiRoot, "README.md");
  const componentsDir = join(uiRoot, "src/components");

  it("lists exactly the folders under src/components", () => {
    const listed = firstCells(readme, "## Where things are")
      .filter((cell) => cell.endsWith("/") && !cell.includes("src/") && cell !== "test/")
      .map((cell) => cell.replace(/\/$/, ""));
    const onDisk = readdirSync(componentsDir).filter((name) => statSync(join(componentsDir, name)).isDirectory());
    expect(listed.toSorted()).toEqual(onDisk.toSorted());
  });

  it("lists only other paths that exist", () => {
    const paths = firstCells(readme, "## Where things are").filter((cell) => cell.startsWith("src/") || cell === "test/");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(existsSync(join(uiRoot, path)), path).toBe(true);
  });
});

describe("apps/web/README.md route map", () => {
  const routes = firstCells(join(root, "apps/web/README.md"), "## Route map").filter((cell) => cell.endsWith("page.tsx"));

  it("lists only pages that exist", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(existsSync(join(localeRoot, route)), route).toBe(true);
  });

  it("lists every page.tsx under [locale] (parallel slots aside)", () => {
    expect(routes.toSorted()).toEqual(pagesUnder(localeRoot).toSorted());
  });
});
