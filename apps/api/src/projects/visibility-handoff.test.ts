import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// RP-1262: app.set_participant_visibility saves one dimension, and never hands a Vacancy on itself: a
// half-saved change may cover an item the whole change doesn't. So every caller that changes a
// Participant's Visibility also calls app.pass_vacancies_after_visibility, once, after the whole change
// is saved (scenario RP-1262-5). This fails when a source file calls the first without the second.

const repo = join(import.meta.dirname, "..", "..", "..", "..");
// Tests and their fixtures (test-support builds a Project's Visibility before any withdrawal) aren't callers.
const skippedFolders = new Set(["node_modules", "dist", ".next", ".turbo", "test", "test-support", "migrations", "storybook-static"]);

/** The source files under `folder` (repo-relative): every .ts and .tsx but tests, never inside a skipped folder. */
function sourceFiles(folder: string): string[] {
  return readdirSync(join(repo, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return skippedFolders.has(entry.name) ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the Vacancy hand-off after a Participant's Visibility changes (RP-1262)", () => {
  it("is called by every source file that sets a Participant's Visibility", () => {
    const callers = ["apps", "packages"].flatMap(sourceFiles).filter((file) => readFileSync(join(repo, file), "utf8").includes("app.set_participant_visibility("));
    // Positive control: the api's own caller is found.
    expect(callers.map((file) => file.replaceAll("\\", "/"))).toContain("apps/api/src/projects/visibility.ts");
    const missing = callers.filter((file) => !readFileSync(join(repo, file), "utf8").includes("app.pass_vacancies_after_visibility("));
    expect(missing, "call app.pass_vacancies_after_visibility once, after the whole change is saved").toEqual([]);
  });
});
