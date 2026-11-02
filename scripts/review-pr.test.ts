import { describe, expect, it } from "vitest";
import { exportedNames, formatReview, reviewPr, reviewPrMain, type GitResult, type ReviewPrSeam } from "./review-pr.ts";
import type { PrReport } from "./pr-status.ts";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE = "c".repeat(40);
const MAIN_TIP = "d".repeat(40);
const REVIEWED = "e".repeat(40);

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });

/** git answering by the longest matching start of `args.join(" ")`; an unknown call throws. */
const fakeGit = (answers: Record<string, GitResult>, calls: string[] = []) => (args: string[]): GitResult => {
  const joined = args.join(" ");
  calls.push(joined);
  const key = Object.keys(answers)
    .filter((k) => joined.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (key === undefined) throw new Error(`unexpected git ${joined}`);
  return answers[key]!;
};

const report = (over: Partial<PrReport> = {}): PrReport => ({ pr: 7, head: HEAD, implement: "RP-1", markers: [], timeline: [], warnings: [], ...over });

const baseGit = (over: Record<string, GitResult> = {}): Record<string, GitResult> => ({
  "fetch --no-tags origin main": ok(),
  "fetch --no-tags origin refs/pull/7/head": ok(),
  "rev-parse FETCH_HEAD": ok(`${HEAD}\n`),
  [`merge-base origin/main ${HEAD}`]: ok(`${BASE}\n`),
  [`diff --stat origin/main...${HEAD}`]: ok(" scripts/x.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n"),
  [`diff --name-status --no-renames origin/main...${HEAD}`]: ok("M\tscripts/x.ts\n"),
  [`rev-list --merges ${BASE}..${HEAD}`]: ok(""),
  [`diff -U0 --no-renames origin/main...${HEAD}`]: ok(""),
  ...over,
});

const seam = (git: Record<string, GitResult>, pr: PrReport = report(), calls: string[] = []): ReviewPrSeam => ({ git: fakeGit(git, calls), report: () => pr });

const marker = (sha: string, at: string, bot = false) => ({ sha, login: bot ? "x[bot]" : "mmhaleess90", bot, at, counts: !bot });

/** The git answers for one merge commit `MERGE` with second parent `MAIN_TIP`. */
const mergeGit = (from: string, remerge: string, ofMain = true): Record<string, GitResult> => ({
  [`rev-list --merges ${from}..${HEAD}`]: ok(`${MERGE}\n`),
  [`show -s --format=%s ${MERGE}`]: ok("Merge remote-tracking branch 'origin/main' into RP-1-x\n"),
  [`rev-parse ${MERGE}^2`]: ok(`${MAIN_TIP}\n`),
  [`merge-base --is-ancestor ${MAIN_TIP} origin/main`]: { status: ofMain ? 0 : 1, stdout: "", stderr: "" },
  [`show --remerge-diff --format= ${MERGE}`]: ok(remerge),
});

describe("reviewPr: merges", () => {
  it("without a review marker, takes every merge since the merge base and calls an empty remerge-diff clean", () => {
    const review = reviewPr(seam(baseGit(mergeGit(BASE, ""))), 7);
    expect(review.ok && review.merges).toEqual({
      since: { sha: BASE, why: "no review marker" },
      merges: [{ sha: MERGE, subject: "Merge remote-tracking branch 'origin/main' into RP-1-x", ofMain: true, diff: [] }],
    });
  });

  it("takes the merges since the newest person's review marker, and keeps a non-empty remerge-diff", () => {
    const git = baseGit({ [`merge-base --is-ancestor ${REVIEWED} ${HEAD}`]: ok(), ...mergeGit(REVIEWED, "diff --git a/x.ts b/x.ts\n+fixed\n", false) });
    const pr = report({ markers: [marker(BASE, "2026-11-01T00:00:00Z"), marker(REVIEWED, "2026-11-02T00:00:00Z"), marker(MAIN_TIP, "2026-11-03T00:00:00Z", true)] });
    const review = reviewPr(seam(git, pr), 7);
    expect(review.ok && review.merges).toEqual({
      since: { sha: REVIEWED, why: "the last review marker" },
      merges: [{ sha: MERGE, subject: "Merge remote-tracking branch 'origin/main' into RP-1-x", ofMain: false, diff: ["diff --git a/x.ts b/x.ts", "+fixed"] }],
    });
  });

  it("falls back to the merge base when the marker's sha is not in the head's history (a force-push)", () => {
    const git = baseGit({ [`merge-base --is-ancestor ${REVIEWED} ${HEAD}`]: { status: 1, stdout: "", stderr: "" } });
    const review = reviewPr(seam(git, report({ markers: [marker(REVIEWED, "2026-11-02T00:00:00Z")] })), 7);
    expect(review.ok && review.merges).toEqual({ since: { sha: BASE, why: `the last review marker's ${REVIEWED.slice(0, 7)} is not in the head's history` }, merges: [] });
  });
});

describe("reviewPr: timeline", () => {
  it("takes pr-status's timeline, its implement marker and its warnings", () => {
    const pr = report({
      implement: undefined,
      timeline: [{ at: "2026-11-02T10:00:00Z", actor: "github-actions[bot]", bot: true, event: "added `reviewed`" }],
      warnings: ["the merge queue could not be read (boom)."],
    });
    const review = reviewPr(seam(baseGit(), pr), 7);
    expect(review.ok && review.timeline).toEqual({ lines: ["2026-11-02T10:00:00Z  github-actions[bot] (bot)  added `reviewed`"], implement: undefined, warnings: ["the merge queue could not be read (boom)."] });
  });
});

// A recorded `git diff -U0 --no-renames`: an added export, a body-only edit (git names the export in the hunk header),
// a changed non-.ts line is not asked for, a deleted file's export, and an edit inside a private function.
const DIFF = [
  "diff --git a/scripts/a.ts b/scripts/a.ts",
  "index 1..2 100644",
  "--- a/scripts/a.ts",
  "+++ b/scripts/a.ts",
  "@@ -10,0 +11,2 @@ import x from \"y\";",
  "+export async function fresh(n: number) {",
  "+export const LIMIT = 3;",
  "@@ -20 +22 @@ export function edited(a: string): string {",
  "-  return a;",
  "+  return a.trim();",
  "@@ -30 +32 @@ function helper() {",
  "-  return 1;",
  "+  return 2;",
  "diff --git a/scripts/gone.ts b/scripts/gone.ts",
  "deleted file mode 100644",
  "--- a/scripts/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-export function oldName() {}",
  "",
].join("\n");

describe("exportedNames", () => {
  it("names the exports the diff adds, removes or edits the body of, with their file", () => {
    expect(exportedNames(DIFF)).toEqual([
      { name: "fresh", file: "scripts/a.ts" },
      { name: "LIMIT", file: "scripts/a.ts" },
      { name: "edited", file: "scripts/a.ts" },
      { name: "oldName", file: "scripts/gone.ts" },
    ]);
  });
});

describe("reviewPr: callers", () => {
  it("greps each name at the head outside its own file, drops the sha prefix and caps the list", () => {
    const many = Array.from({ length: 23 }, (_, i) => `${HEAD}:scripts/use.ts:${i + 1}:edited(x)`).join("\n");
    const calls: string[] = [];
    const git = baseGit({
      [`diff -U0 --no-renames origin/main...${HEAD}`]: ok(DIFF),
      [`grep -n -w -e fresh ${HEAD}`]: ok(`${HEAD}:apps/web/b.tsx:4:  await fresh(2);\n`),
      [`grep -n -w -e LIMIT ${HEAD}`]: { status: 1, stdout: "", stderr: "" },
      [`grep -n -w -e edited ${HEAD}`]: ok(`${many}\n`),
      [`grep -n -w -e oldName ${HEAD}`]: { status: 1, stdout: "", stderr: "" },
    });
    const review = reviewPr(seam(git, report(), calls), 7);
    expect(calls).toContain(`diff -U0 --no-renames origin/main...${HEAD} -- *.ts *.tsx`);
    expect(calls).toContain(`grep -n -w -e fresh ${HEAD} -- :!scripts/a.ts`);
    expect(review.ok && review.callers).toEqual([
      { name: "fresh", file: "scripts/a.ts", hits: ["apps/web/b.tsx:4:  await fresh(2);"], more: 0 },
      { name: "LIMIT", file: "scripts/a.ts", hits: [], more: 0 },
      { name: "edited", file: "scripts/a.ts", hits: Array.from({ length: 20 }, (_, i) => `scripts/use.ts:${i + 1}:edited(x)`), more: 3 },
      { name: "oldName", file: "scripts/gone.ts", hits: [], more: 0 },
    ]);
  });

  it("fails on a git grep error other than no match", () => {
    const git = baseGit({
      [`diff -U0 --no-renames origin/main...${HEAD}`]: ok(DIFF),
      "grep -n -w -e": { status: 128, stdout: "", stderr: "fatal: bad object" },
    });
    expect(reviewPr(seam(git), 7)).toEqual({ ok: false, message: "git grep -n -w failed: fatal: bad object" });
  });
});

describe("formatReview and reviewPrMain", () => {
  it("prints the four sections", () => {
    const pr = report({ timeline: [{ at: "2026-11-02T10:00:00Z", actor: "mmhaleess90", bot: false, event: "turned auto-merge on" }] });
    const git = baseGit({
      ...mergeGit(BASE, ""),
      [`diff -U0 --no-renames origin/main...${HEAD}`]: ok("diff --git a/s.ts b/s.ts\n--- a/s.ts\n+++ b/s.ts\n@@ -1 +1 @@\n+export const X = 1;\n"),
      [`grep -n -w -e X ${HEAD}`]: ok(`${HEAD}:t.ts:2:X\n`),
    });
    const { code, lines } = reviewPrMain(["7"], seam(git, pr));
    expect(code).toBe(0);
    expect(lines).toEqual([
      `== 1. Head ${HEAD} (merge base with origin/main ${BASE})`,
      " scripts/x.ts | 2 +-",
      " 1 file changed, 1 insertion(+), 1 deletion(-)",
      "  Files:",
      "    M\tscripts/x.ts",
      "",
      `== 2. Merges since ${BASE.slice(0, 7)} (no review marker): 1`,
      `  ${MERGE.slice(0, 7)} Merge remote-tracking branch 'origin/main' into RP-1-x  (merge of main; remerge-diff: clean)`,
      "",
      "== 3. Timeline",
      "  2026-11-02T10:00:00Z  mmhaleess90 (person)  turned auto-merge on",
      "  Implement marker: RP-1 is in the body.",
      "",
      "== 4. Callers of the exports the diff changes",
      "  X (s.ts): 1",
      "    t.ts:2:X",
    ]);
  });

  it("prints a merge's remerge-diff, an empty timeline, a missing marker, no callers and a capped list", () => {
    const review = {
      ok: true as const,
      head: { sha: HEAD, mergeBase: BASE, stat: [], files: [], warnings: ["w"] },
      merges: { since: { sha: REVIEWED, why: "the last review marker" }, merges: [{ sha: MERGE, subject: "Merge x", ofMain: false, diff: ["+a"] }] },
      timeline: { lines: [], implement: undefined, warnings: ["boom"] },
      callers: [{ name: "f", file: "a.ts", hits: ["b.ts:1:f"], more: 4 }],
    };
    expect(formatReview(review)).toEqual([
      `== 1. Head ${HEAD} (merge base with origin/main ${BASE})`,
      "  Warning: w",
      "  Files: none",
      "",
      `== 2. Merges since ${REVIEWED.slice(0, 7)} (the last review marker): 1`,
      `  ${MERGE.slice(0, 7)} Merge x  (not a merge of main; remerge-diff: 1 line)`,
      "    +a",
      "",
      "== 3. Timeline",
      "  Nothing yet.",
      "  Implement marker: missing from the body.",
      "  Warning: boom",
      "",
      "== 4. Callers of the exports the diff changes",
      "  f (a.ts): 5",
      "    b.ts:1:f",
      "    … and 4 more",
    ]);
    expect(formatReview({ ...review, merges: { ...review.merges, merges: [] }, callers: [] }).slice(4, 6)).toEqual([`== 2. Merges since ${REVIEWED.slice(0, 7)} (the last review marker): none`, ""]);
    expect(formatReview({ ...review, callers: [] }).at(-1)).toBe("  No exported function or const changed.");
  });

  it("refuses bad arguments and exits 1 on a failed fetch", () => {
    expect(reviewPrMain([], seam(baseGit()))).toEqual({ code: 1, lines: ["Usage: node scripts/review-pr.ts <pr number>"] });
    expect(reviewPrMain(["x"], seam(baseGit())).code).toBe(1);
    expect(reviewPrMain(["7"], seam(baseGit({ "fetch --no-tags origin main": { status: 1, stdout: "", stderr: "no network" } })))).toEqual({ code: 1, lines: ["git fetch origin main failed: no network"] });
  });
});

describe("reviewPr: head", () => {
  it("fetches main and the PR head, and lists the stat and the files against the merge base", () => {
    const calls: string[] = [];
    const review = reviewPr(seam(baseGit(), report(), calls), 7);
    expect(calls.slice(0, 2)).toEqual(["fetch --no-tags origin main", "fetch --no-tags origin refs/pull/7/head"]);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.head).toEqual({ sha: HEAD, mergeBase: BASE, stat: [" scripts/x.ts | 2 +-", " 1 file changed, 1 insertion(+), 1 deletion(-)"], files: ["M\tscripts/x.ts"], warnings: [] });
  });

  it("warns when GitHub's head differs from the fetched one", () => {
    const review = reviewPr(seam(baseGit(), report({ head: MAIN_TIP })), 7);
    expect(review.ok && review.head.warnings).toEqual([`GitHub says the head is ${MAIN_TIP}, but origin's refs/pull/7/head is ${HEAD}: someone pushed while this ran; run it again.`]);
  });

  it("fails when the PR head cannot be fetched", () => {
    const review = reviewPr(seam(baseGit({ "fetch --no-tags origin refs/pull/7/head": { status: 128, stdout: "", stderr: "fatal: couldn't find remote ref" } })), 7);
    expect(review).toEqual({ ok: false, message: "git fetch origin refs/pull/7/head failed: fatal: couldn't find remote ref" });
  });
});
