import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Components read semantic roles only (layer 2), so a new theme never touches them.
const componentsDir = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(componentsDir, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|stories)\.tsx?$/.test(file))
  .map((file) => [file, readFileSync(join(componentsDir, file), "utf8")] as const);

describe("ui components", () => {
  it("exist", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)("%s uses no base palette colours or raw colour values", (_file, source) => {
    expect(source).not.toMatch(/palette-/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\b(rgb|hsl|oklch)a?\(/i);
  });
});
