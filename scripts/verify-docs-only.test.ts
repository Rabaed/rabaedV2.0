import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readByTests, skipRefusal, skippedTests, skipTests, TESTS_SKIPPED_LABEL } from "./verify-docs-only.ts";

describe("readByTests", () => {
  it("counts the files the tests are known to read", () => {
    for (const file of [
      "planning/uat/round-0/test-cases.json", // uat-sheet.test.ts, uat-projects-plan.test.ts
      "planning/uat/round-0/fixtures-data/register.pdf", // pdf-pages.test.ts
      "planning/migration-days.md", // doc-placeholders, check-migrations-days
      "planning/parallel-sessions.md", // check-doc-skills, doc-placeholders
      "docs/visibility.md", // visibility-scenarios, check-scenario-ids, check-leak-channels
      "docs/visibility/scenarios/RP-412.md", // visibility-scenarios
      "docs/agents/issue-tracker.md", // check-claims.test.ts, pre-push.test.ts
      "docs/adr/0023-review-duration.md", // docs-unique
      "GLOSSARY.md", // docs-unique
      "CLAUDE.md", // doc-placeholders
      "README.md", // check-doc-skills
      "apps/web/README.md", // ui-route-maps
      "design/owner-reference-process.md", // check-gap-table.test.ts
    ]) {
      expect(readByTests(file), file).toBe(true);
    }
  });

  it("does not count the UAT cases, harness and generated sheets, which no unit or seam test reads", () => {
    for (const file of ["planning/uat/round-0/cases/UX-1.ts", "planning/uat/round-0/harness/run.ts", "planning/uat/sheet/round-9.html", "planning/backlog.py", "planning/rabaed-jira-import.csv"]) {
      expect(readByTests(file), file).toBe(false);
    }
  });

  it("reads a Windows path as git's", () => {
    expect(readByTests("planning\\uat\\round-0\\test-cases.json")).toBe(true);
    expect(readByTests("planning\\uat\\round-0\\harness\\run.ts")).toBe(false);
  });
});

describe("skipTests", () => {
  const cases = ["planning/uat/round-0/cases/UX-1.ts"];

  it("skips for a diff of only files under planning/ that no test reads", () => {
    expect(skipTests(cases)).toEqual({ skip: true });
    expect(skipTests([...cases, "planning/uat/round-0/harness/run.ts", "planning/uat/sheet/round-9.html"])).toEqual({ skip: true });
  });

  it("runs the tests for an empty diff", () => {
    expect(skipTests([])).toEqual({ skip: false, why: "no file changed against origin/main" });
  });

  it("runs the tests when one file is code or any file outside planning/ and docs/ that is not Markdown, naming it", () => {
    expect(skipTests([...cases, "scripts/verify.ts"])).toEqual({ skip: false, why: "scripts/verify.ts is not under planning/ or docs/ and not Markdown" });
    expect(skipTests([...cases, "package.json"]).skip).toBe(false);
    expect(skipTests([...cases, "apps/api/src/a.ts"]).skip).toBe(false);
    expect(skipTests([...cases, ".github/workflows/ci.yml"]).skip).toBe(false);
  });

  it("runs the tests when one file is read by a test, naming it", () => {
    expect(skipTests([...cases, "planning/uat/round-0/test-cases.json"])).toEqual({ skip: false, why: "planning/uat/round-0/test-cases.json is read by a test" });
    expect(skipTests([...cases, "docs/visibility.md"]).skip).toBe(false);
    expect(skipTests([...cases, "planning/migration-days.md"]).skip).toBe(false);
    expect(skipTests([...cases, "GLOSSARY.md"]).skip).toBe(false);
  });

  it("counts a deleted or renamed-from path like any other: code moved into planning/ is a code change", () => {
    // The callers list files without rename detection, so a rename lists the old path too.
    expect(skipTests([...cases, "apps/api/src/old-name.ts"]).skip).toBe(false);
  });

  it("is not fooled by a lookalike prefix or a Markdown name inside code", () => {
    expect(skipTests(["planning-extra/a.ts"]).skip).toBe(false);
    expect(skipTests(["apps/api/src/docs/a.ts"]).skip).toBe(false);
    expect(skipTests(["scripts/readme.md.ts"]).skip).toBe(false);
  });
});

describe("the label on a verify line", () => {
  it("holds no full stop, no `, ` and no step name, so the gate's pattern and the reuse split read it as one label", () => {
    expect(TESTS_SKIPPED_LABEL).not.toContain(".");
    expect(TESTS_SKIPPED_LABEL).not.toContain(", ");
    expect(TESTS_SKIPPED_LABEL.replace(/ \(.*$/, "")).toBe("tests skipped");
  });

  it("is found in a step list", () => {
    expect(skippedTests(`lint, typecheck, ${TESTS_SKIPPED_LABEL}.`)).toBe(true);
    expect(skippedTests("lint, typecheck, test:unit.")).toBe(false);
  });
});

describe("skipRefusal", () => {
  const skipped = `lint, typecheck, ${TESTS_SKIPPED_LABEL}.`;
  const full = "lint, typecheck, test:unit, test:seam1, test:seam2.";

  it("never refuses a line that ran the suites, whatever the diff", () => {
    expect(skipRefusal(full, ["apps/api/src/a.ts"])).toBeUndefined();
    expect(skipRefusal(full, undefined)).toBeUndefined();
  });

  it("accepts a line that left them out for a diff the rule passes", () => {
    expect(skipRefusal(skipped, ["planning/uat/round-0/cases/UX-1.ts"])).toBeUndefined();
  });

  it("refuses it for any other diff, naming the file that decides", () => {
    expect(skipRefusal(skipped, ["planning/uat/round-0/cases/UX-1.ts", "apps/api/src/a.ts"])).toContain("apps/api/src/a.ts is not under planning/ or docs/");
    expect(skipRefusal(skipped, ["planning/uat/round-0/test-cases.json"])).toContain("planning/uat/round-0/test-cases.json is read by a test");
    expect(skipRefusal(skipped, [])).toContain("no file changed");
  });

  it("refuses it when the changed files could not be listed", () => {
    expect(skipRefusal(skipped, undefined)).toContain("could not be listed");
  });
});

// The list of files the tests read was made by reading the tests. This keeps it from going stale: every file a test
// file names, by a path spelled out in its source, must be one `readByTests` counts. A test that reads a new file under
// planning/ then fails here until the file is listed, instead of a UAT PR skipping the test that reads it.
describe("the census of paths the test files name", () => {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const tracked = new Set(git("ls-files"));
  const testFiles = git("ls-files", "--", "*.test.ts", "*.test.tsx");
  // A path under planning/ or docs/, or a Markdown file at the root, as a test spells it.
  const spelled = /(?<![\w./-])(?:(?:planning|docs)\/[\w.[\]-]+(?:\/[\w.[\]-]+)*|[A-Z][A-Z_]*\.md)/g;

  // Test files whose planning/ paths are fixtures for a temporary repo or strings under test (this file's own are the rule's
  // examples), never read from this checkout. The second test below checks that each one reads no file by a path built from the checkout.
  const FIXTURE_PATHS_ONLY = new Set(["scripts/check-uat-touch.test.ts", "scripts/verify-docs-only.test.ts"]);

  it("finds the tracked files the tests spell out, and each one is counted as read", () => {
    const missing: string[] = [];
    let named = 0;
    for (const testFile of testFiles) {
      if (FIXTURE_PATHS_ONLY.has(testFile)) continue;
      for (const path of new Set(readFileSync(testFile, "utf8").match(spelled) ?? [])) {
        if (!tracked.has(path)) continue;
        named++;
        if (!readByTests(path)) missing.push(`${testFile} names ${path}`);
      }
    }
    expect(named).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  it("the fixture-only test files read no planning/ path from this checkout", () => {
    for (const testFile of FIXTURE_PATHS_ONLY) {
      const source = readFileSync(testFile, "utf8");
      expect(source, testFile).not.toMatch(/readFileSync\(\s*(?:resolve|join)\([^)]*import\.meta\.dirname/);
      expect(source, testFile).not.toMatch(/process\.cwd\(\)/);
    }
  });
});
