/* eslint-disable rabaed/no-avoid-terms -- git's and the test runner's words (file, the UAT plan), not the domain's */
// RP-1181: when `pnpm verify` may leave out the three test suites. A PR that changes only files under planning/ or
// docs/ (or Markdown) that no test reads cannot change what test:unit, test:seam1 or test:seam2 judge: the suites run
// the code, and the code is the same. UAT PRs that changed only planning/uat/** ran 4 to 5 hours of seam tests for it
// (retro 2026-10-31). Lint, typecheck and check:migrations still run, and test:stories keeps its own rule
// (scripts/verify-steps.ts).
//
// The same rule decides on both sides, so it lives here: `pnpm verify` skips the suites with it
// (scripts/verify-steps.ts) and prints `TESTS_SKIPPED_LABEL` on its stamped line; the verify gate and `pnpm queue` accept a
// stamped line with that label only for a diff this rule passes (scripts/verify-gate.ts `verifyGate`). A line with the
// label on a PR that changes any other file fails, because the stamp covers the line, not the diff.

/** The suites a docs-only diff leaves out, as `pnpm verify` names them. */
export const SKIPPED_TESTS = ["test:unit", "test:seam1", "test:seam2"] as const;

/** Why `pnpm verify` prints it skipped them. */
export const SKIP_REASON = "every changed file is under planning/ or docs/ (or Markdown) and no test reads it";

/**
 * The step label on a stamped verify line that left the suites out. It holds no `, ` and no `.`: the gate's line
 * pattern ends a step list at a full stop, and scripts/verify-reuse.ts splits it at `, ` (its bare name,
 * `tests skipped`, is no step, so a reuse run never takes the suites as run).
 */
export const TESTS_SKIPPED_LABEL = `tests skipped (docs only: ${SKIPPED_TESTS.join("+")})`;

/** True when a verify line's step text carries the label. */
export const skippedTests = (steps: string): boolean => steps.includes(TESTS_SKIPPED_LABEL);

/** A file as git lists it, with `/`. */
const normal = (file: string) => file.replaceAll("\\", "/");

/** Where the ticket looks for a change that is only documents: planning/, docs/ or any Markdown file. */
const inScope = (file: string) => file.startsWith("planning/") || file.startsWith("docs/") || file.endsWith(".md");

/**
 * The files a test reads, each with the tests that read it (found by reading the tests, not guessed; the census in
 * scripts/verify-docs-only.test.ts names every path a test file spells out and fails when one is missing here).
 * When in doubt a file is listed: a listed file only means the suites run, as they always did.
 */
const READ_BY_TESTS: { files: (file: string) => boolean; readers: string }[] = [
  {
    // doc-placeholders reads CLAUDE.md and every .md under planning/ and docs/; check-doc-skills the README, CLAUDE.md,
    // planning/ and docs/agents; ui-route-maps the READMEs of packages/ui and apps/web; check-gap-table design/*.md,
    // GLOSSARY.md and CLAUDE.md; docs-unique GLOSSARY.md and the ADRs; check-leak-channels the PR template.
    files: (file) => file.endsWith(".md"),
    readers: "doc-placeholders, check-doc-skills, ui-route-maps, check-gap-table, docs-unique, check-leak-channels",
  },
  {
    // visibility-scenarios and check-scenario-ids read docs/visibility.md and docs/visibility/scenarios/; check-hidden-asserts
    // and check-scenario-seams the lists under docs/visibility/; doc-index the four engine docs; check-claims and pre-push
    // docs/agents/issue-tracker.md.
    files: (file) => file.startsWith("docs/"),
    readers: "visibility-scenarios, check-scenario-ids, check-hidden-asserts, check-scenario-seams, doc-index, check-claims, pre-push",
  },
  {
    // uat-sheet.test.ts and uat-projects-plan.test.ts read planning/uat/<round>/test-cases.json; every other JSON under
    // planning/ may be a source of the same kind (results.json, a sheet).
    files: (file) => file.startsWith("planning/") && file.endsWith(".json"),
    readers: "uat-sheet, uat-projects-plan",
  },
  {
    // pdf-pages.test.ts reads planning/uat/round-0/fixtures-data/register.pdf, a fixture: all of the folder counts.
    files: (file) => /^planning\/uat\/[^/]+\/fixtures-data\//.test(file),
    readers: "pdf-pages",
  },
];

/** Whether a test reads `file` (a path relative to the repo root). */
export const readByTests = (file: string): boolean => READ_BY_TESTS.some(({ files }) => files(normal(file)));

/** The suites run unless `skipTests` says otherwise. */
export type Skip = { skip: true } | { skip: false; why: string };

/**
 * Whether a diff leaves out the unit and seam suites: it has at least one file, and every file is under planning/,
 * under docs/ or Markdown, and read by no test. A deleted file counts like any other, and so does the old path of a
 * rename (the callers list paths without rename detection). `why` names the file that decides it.
 */
export function skipTests(changed: readonly string[]): Skip {
  const files = changed.map(normal);
  if (files.length === 0) return { skip: false, why: "no file changed against origin/main" };
  const outside = files.find((file) => !inScope(file));
  if (outside !== undefined) return { skip: false, why: `${outside} is not under planning/ or docs/ and not Markdown` };
  const read = files.find(readByTests);
  if (read !== undefined) return { skip: false, why: `${read} is read by a test` };
  return { skip: true };
}

/**
 * Why a stamped verify line that left the suites out does not count for this diff; undefined when it does, or when its
 * steps do not carry the label. `changed` undefined means the caller could not list the diff: the line then fails.
 */
export function skipRefusal(steps: string, changed: readonly string[] | undefined): string | undefined {
  if (!skippedTests(steps)) return undefined;
  if (changed === undefined) return "it left out the unit and seam tests as for a docs-only change, and the PR's changed files could not be listed to confirm that";
  const decision = skipTests(changed);
  return decision.skip ? undefined : `it left out the unit and seam tests as for a docs-only change, but the PR is not one: ${decision.why}`;
}
