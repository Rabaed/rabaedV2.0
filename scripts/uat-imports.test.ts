import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The UAT tool's boundary (RP-922, test 7): it is dev and UAT only, so no code the apps run imports it.
// Nothing under apps/*/src or packages/*/src may import packages/db/dev-tools or scripts/uat-*.

/** An import or export ... from, or a dynamic import(), of the tool. */
const TOOL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'][^"']*(?:dev-tools|scripts\/uat-)[^"']*["']/;

// The tracked source files of every app and package (their src folders).
function sourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--", "apps/*/src/**", "packages/*/src/**"], { encoding: "utf8" });
  return out.split("\n").filter((f) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(f));
}

describe("the UAT tool's import boundary", () => {
  it("recognises an import of the tool", () => {
    expect(TOOL_IMPORT.test('import { ageItems } from "../../db/dev-tools/index.ts";')).toBe(true);
    expect(TOOL_IMPORT.test('export * from "../../../scripts/uat-age.ts";')).toBe(true);
    expect(TOOL_IMPORT.test('await import("../dev-tools/age.ts")')).toBe(true);
    expect(TOOL_IMPORT.test('import "../../scripts/uat-guard.ts";')).toBe(true);
    expect(TOOL_IMPORT.test('import { stepAgeWeeks } from "@rabaed/domain";')).toBe(false);
  });

  it("no file under apps/*/src or packages/*/src imports packages/db/dev-tools or scripts/uat-*", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => TOOL_IMPORT.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});
