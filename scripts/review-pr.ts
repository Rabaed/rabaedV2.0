/* eslint-disable rabaed/no-avoid-terms -- git's own words (file, merge) and the review marker, by their names */
// RP-1195 item 5: `node scripts/review-pr.ts <n> [--since <sha>]` prints what a reviewer needs before reading PR <n>: the head and its
// files against the merge base, the merges since the merge base or `--since` (their remerge-diffs), the label, auto-merge,
// queue and marker timeline (`prStatus`, item 2) and the callers of every exported name the diff touches. It only
// reads: exit 0, or 1 on bad arguments or a failed fetch. Not a gate script: keep it out of review-post.ts's imports.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { prStatus, realSeam as prStatusSeam, type PrReport } from "./pr-status.ts";
import { timelineLines } from "./pr-status-lines.ts";

export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ReviewPrSeam {
  /** One git call (no shell); a non-zero status is returned, not thrown. */
  git(args: string[]): GitResult;
  /** pr-status's report on PR `n`. */
  report(n: number): PrReport;
}

export interface HeadSection {
  sha: string;
  mergeBase: string;
  stat: string[];
  files: string[];
  warnings: string[];
}

export interface Merge {
  sha: string;
  subject: string;
  /** Its second parent is on origin/main. */
  ofMain: boolean;
  /** `git show --remerge-diff`: empty for a clean merge. */
  diff: string[];
}

export interface MergesSection {
  /** Where the merges are counted from, and why there. */
  since: { sha: string; why: string };
  /** Oldest first. */
  merges: Merge[];
}

export interface TimelineSection {
  /** `timelineLines` of pr-status's timeline. */
  lines: string[];
  /** The Jira key of the body's implement marker; undefined when missing. */
  implement?: string;
  /** pr-status's warnings (reads that failed). */
  warnings: string[];
}

export interface Callers {
  name: string;
  /** The file the diff changes its definition in; the grep leaves it out. */
  file: string;
  /** `path:line:text` at the head, at most `MAX_HITS`. */
  hits: string[];
  /** How many more lines matched. */
  more: number;
}

export type Review = { ok: true; head: HeadSection; merges: MergesSection; timeline: TimelineSection; callers: Callers[] } | { ok: false; message: string };

type Must = (args: string[]) => string;

const EXPORT = /^export (?:default )?(?:async )?(?:function\*?|const|let|class|type|interface) (\w+)/;

/**
 * The exported names a `git diff -U0` adds, removes or edits: from its +/- lines, and from a hunk header naming an
 * export (git's default funcname line is the nearest line before the hunk that starts with a letter, which for
 * top-level TS is the declaration the hunk sits in). Each name once per file, in diff order.
 */
export function exportedNames(diff: string): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = [];
  let before = "";
  let file = "";
  // A removed line "-- x" reads "--- x": file headers only come between `diff --git` and the first hunk.
  let header = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) header = true;
    else if (header && line.startsWith("--- ")) before = line.slice(4).replace(/^a\//, "");
    else if (header && line.startsWith("+++ ")) file = line === "+++ /dev/null" ? before : line.slice(4).replace(/^b\//, "");
    else {
      if (line.startsWith("@@")) header = false;
      const text = line.startsWith("@@") ? (/^@@[^@]*@@ ?(.*)$/.exec(line)?.[1] ?? "") : /^[+-]/.test(line) ? line.slice(1) : undefined;
      const name = text === undefined ? undefined : EXPORT.exec(text)?.[1];
      if (name && !found.some((f) => f.name === name && f.file === file)) found.push({ name, file });
    }
  }
  return found;
}

const MAX_HITS = 20;

/** `git grep -w` of each changed export at the head, outside the file that defines it; exit 1 is no match. */
function callersOf(seam: ReviewPrSeam, must: Must, head: string): Callers[] {
  const names = exportedNames(must(["diff", "-U0", "--no-renames", `origin/main...${head}`, "--", "*.ts", "*.tsx"]));
  return names.map(({ name, file }) => {
    const done = seam.git(["grep", "-n", "-w", "-e", name, head, "--", `:!${file}`]);
    if (done.status !== 0 && done.status !== 1) throw new GitFailed(`git grep -n -w failed: ${(done.stderr || done.stdout).trim()}`);
    const all = lines(done.stdout).map((l) => (l.startsWith(`${head}:`) ? l.slice(head.length + 1) : l));
    return { name, file, hits: all.slice(0, MAX_HITS), more: Math.max(0, all.length - MAX_HITS) };
  });
}

const FROM_BASE = "the merge base with origin/main";

/**
 * The merge commits on the head since the merge base, or since `--since <sha>` when the reviewer asks for only the
 * merges since their own last look. Never since a review marker (RP-1195 review): a lane's own `lane:ready` marker
 * names the head, and anyone can post one, so starting there would hide a bad merge.
 */
function mergesSince(seam: ReviewPrSeam, must: Must, head: string, mergeBase: string, asked: string | undefined): MergesSection {
  let since = { sha: mergeBase, why: FROM_BASE };
  if (asked !== undefined) {
    since = seam.git(["merge-base", "--is-ancestor", asked, head]).status === 0 ? { sha: asked, why: "--since" } : { sha: mergeBase, why: `--since ${asked.slice(0, 7)} is not in the head's history; ${FROM_BASE}` };
  }
  const shas = lines(must(["rev-list", "--merges", `${since.sha}..${head}`])).reverse();
  const merges = shas.map((sha) => {
    const second = must(["rev-parse", `${sha}^2`]).trim();
    return {
      sha,
      subject: must(["show", "-s", "--format=%s", sha]).trim(),
      ofMain: seam.git(["merge-base", "--is-ancestor", second, "origin/main"]).status === 0,
      diff: lines(must(["show", "--remerge-diff", "--format=", sha])),
    };
  });
  return { since, merges };
}

const lines = (text: string) => text.split("\n").filter((l) => l !== "");

class GitFailed extends Error {}

export function reviewPr(seam: ReviewPrSeam, n: number, options: { since?: string } = {}): Review {
  const must = (args: string[], what = args.slice(0, 3).join(" ")) => {
    const done = seam.git(args);
    if (done.status !== 0) throw new GitFailed(`git ${what} failed: ${(done.stderr || done.stdout).trim()}`);
    return done.stdout;
  };
  try {
    must(["fetch", "--no-tags", "origin", "main"], "fetch origin main");
    must(["fetch", "--no-tags", "origin", `refs/pull/${n}/head`], `fetch origin refs/pull/${n}/head`);
    const sha = must(["rev-parse", "FETCH_HEAD"]).trim();
    const pr = seam.report(n);
    const warnings = pr.head !== undefined && pr.head !== sha ? [`GitHub says the head is ${pr.head}, but origin's refs/pull/${n}/head is ${sha}: someone pushed while this ran; run it again.`] : [];
    const mergeBase = must(["merge-base", "origin/main", sha]).trim();
    const stat = lines(must(["diff", "--stat", `origin/main...${sha}`]));
    const files = lines(must(["diff", "--name-status", "--no-renames", `origin/main...${sha}`]));
    const merges = mergesSince(seam, must, sha, mergeBase, options.since);
    const timeline = { lines: timelineLines(pr.timeline), implement: pr.implement, warnings: pr.warnings };
    return { ok: true, head: { sha, mergeBase, stat, files, warnings }, merges, timeline, callers: callersOf(seam, must, sha) };
  } catch (error) {
    if (error instanceof GitFailed) return { ok: false, message: error.message };
    throw error;
  }
}

const warn = (warnings: string[]) => warnings.map((w) => `  Warning: ${w}`);
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The four sections as lines. */
export function formatReview(review: Review): string[] {
  if (!review.ok) return [review.message];
  const { head, merges, timeline, callers } = review;
  return [
    `== 1. Head ${head.sha} (merge base with origin/main ${head.mergeBase})`,
    ...warn(head.warnings),
    ...head.stat,
    ...(head.files.length === 0 ? ["  Files: none"] : ["  Files:", ...head.files.map((f) => `    ${f}`)]),
    "",
    `== 2. Merges since ${merges.since.sha.slice(0, 7)} (${merges.since.why}): ${merges.merges.length === 0 ? "none" : merges.merges.length}`,
    ...merges.merges.flatMap((m) => [
      `  ${m.sha.slice(0, 7)} ${m.subject}  (${m.ofMain ? "merge of main" : "not a merge of main"}; remerge-diff: ${m.diff.length === 0 ? "clean" : count(m.diff.length, "line")})`,
      ...m.diff.map((l) => `    ${l}`),
    ]),
    "",
    "== 3. Timeline",
    ...(timeline.lines.length === 0 ? ["  Nothing yet."] : timeline.lines.map((l) => `  ${l}`)),
    timeline.implement ? `  Implement marker: ${timeline.implement} is in the body.` : "  Implement marker: missing from the body.",
    ...warn(timeline.warnings),
    "",
    "== 4. Callers of the exports the diff changes",
    ...(callers.length === 0
      ? ["  No exported function or const changed."]
      : callers.flatMap((c) => [`  ${c.name} (${c.file}): ${c.hits.length + c.more}`, ...c.hits.map((h) => `    ${h}`), ...(c.more > 0 ? [`    … and ${c.more} more`] : [])])),
  ];
}

const USAGE = "Usage: node scripts/review-pr.ts <pr number> [--since <sha>]";

export function reviewPrMain(args: string[], seam: ReviewPrSeam): { code: number; lines: string[] } {
  const [n = "", flag, since, ...rest] = args;
  const sinceOk = flag === undefined || (flag === "--since" && /^[0-9a-f]{7,40}$/.test(since ?? ""));
  if (!/^[1-9]\d*$/.test(n) || !sinceOk || rest.length > 0) return { code: 1, lines: [USAGE] };
  const review = reviewPr(seam, Number(n), flag === undefined ? {} : { since });
  return { code: review.ok ? 0 : 1, lines: formatReview(review) };
}

export function realSeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): ReviewPrSeam {
  return {
    git: (args) => {
      const done = spawn("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
    },
    report: (n) => prStatus(prStatusSeam(cwd, spawn), n),
  };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const { code, lines: out } = reviewPrMain(process.argv.slice(2), realSeam());
  for (const line of out) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
