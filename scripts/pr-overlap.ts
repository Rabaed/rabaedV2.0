/* eslint-disable rabaed/no-avoid-terms -- git's and GitHub's files and checks, and RP-1172's own warning ("voided"), by their own names */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifiedCommits } from "./verify-gate.ts";

// Open PRs that change the same files as a branch (RP-1172). GitHub and git sit behind `OverlapSeam`, so
// the tests need no network.

/** An open PR: what the overlap needs of it. */
export interface OpenPr {
  number: number;
  /** The PR's branch name (`owner:branch` for a PR from a fork). */
  ref: string;
  /** The PR's head commit. */
  head: string;
  /** The files the PR changes, a rename's old path too. */
  files: string[];
  /** Whether its body has a stamped `pnpm verify passed` line naming its current head. */
  stamped: boolean;
}

/** GitHub and git, as the overlap finder uses them. */
export interface OverlapSeam {
  openPrs(): Promise<OpenPr[]>;
  /** The files that would conflict merging `pr`'s head into this branch's HEAD; [] when the merge is clean. */
  conflictsWith(pr: OpenPr): Promise<string[]>;
}

/** The branch under test: its name and the files it changes. */
export interface BranchFiles {
  branch: string;
  files: string[];
}

/** An open PR that changes some of the branch's files. */
export interface Overlap {
  number: number;
  ref: string;
  /** The files both change. */
  shared: string[];
  /** The files a merge would conflict in; [] when the merge is clean. */
  conflicts: string[];
  /** Why git could not say whether it conflicts, when it could not. */
  unknown?: string;
  stamped: boolean;
}

export interface OverlapReport {
  /** The branch's own open PR, if it has one (never listed in `overlaps`). */
  self: { number: number | undefined; stamped: boolean };
  overlaps: Overlap[];
}

/** The open PRs that change any of the branch's files, each with the shared files and the ones a merge would conflict in. */
export async function findOverlaps(branch: BranchFiles, seam: OverlapSeam): Promise<OverlapReport> {
  const prs = branch.files.length === 0 ? [] : await seam.openPrs();
  const own = new Set(branch.files);
  const self = prs.find((pr) => pr.ref === branch.branch);
  const overlaps: Overlap[] = [];
  for (const pr of prs.filter((other) => other !== self).sort((a, b) => a.number - b.number)) {
    const shared = [...new Set(pr.files.filter((file) => own.has(file)))].sort();
    if (shared.length === 0) continue;
    const overlap: Overlap = { number: pr.number, ref: pr.ref, shared, conflicts: [], stamped: pr.stamped };
    try {
      overlap.conflicts = await seam.conflictsWith(pr);
    } catch (error) {
      // One PR git can't answer for must not hide the others.
      overlap.unknown = error instanceof Error ? error.message : String(error);
    }
    overlaps.push(overlap);
  }
  return { self: { number: self?.number, stamped: self?.stamped ?? false }, overlaps };
}

/** A PR, or the branch itself, in line to merge. */
export interface MergeCandidate {
  /** Undefined for the branch before it has a PR. */
  number: number | undefined;
  stamped: boolean;
  /** The branch under test. */
  self: boolean;
}

/**
 * The order to merge the branch and the PRs that would conflict with it: a PR whose body has a stamped verify
 * line for its head goes first (its verify is already paid for), then the lower number; a branch with no PR yet goes last.
 */
export function mergeOrder(report: OverlapReport): MergeCandidate[] {
  const others = report.overlaps.filter((o) => o.conflicts.length > 0).map((o) => ({ number: o.number, stamped: o.stamped, self: false }));
  const rank = (c: MergeCandidate) => c.number ?? Infinity;
  return [...others, { ...report.self, self: true }].sort((a, b) => Number(b.stamped) - Number(a.stamped) || rank(a) - rank(b));
}

/** What to print: "" with no overlap. */
export function overlapMessage(report: OverlapReport): string {
  if (report.overlaps.length === 0) return "";
  const lines = ["check:claims: other open PRs change files this branch changes:"];
  for (const o of report.overlaps) {
    const what = o.unknown !== undefined ? `shares ${o.shared.join(", ")}: could not tell whether it conflicts (${o.unknown})` : o.conflicts.length > 0 ? `would conflict in: ${o.conflicts.join(", ")}` : `shares ${o.shared.join(", ")}: merges clean`;
    lines.push(`  #${o.number} (${o.ref}) ${what}`);
  }
  const conflicting = report.overlaps.filter((o) => o.conflicts.length > 0);
  if (conflicting.length === 0) return lines.join("\n");
  for (const o of conflicting) lines.push(`Warning: this verify will be voided by #${o.number} if #${o.number} merges first (a conflict needs a fresh verify).`);
  const name = (c: MergeCandidate) => (!c.self ? `#${c.number}` : c.number === undefined ? "this branch" : `#${c.number} (this branch)`);
  lines.push(`Merge order: ${mergeOrder(report).map(name).join(", then ")}.`, "(A PR with a stamped verify line for its head goes first, then the lower number, a branch with no PR yet last. The Orchestrator sets the order when it differs.)");
  return lines.join("\n");
}

const execFileAsync = promisify(execFile);

/** Runs a command in `cwd`; resolves with its exit code instead of rejecting, and rejects only when it can't start. */
export type Exec = (command: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;

const exec: Exec = async (command, args, cwd) => {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120_000 });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; message: string };
    if (typeof failed.code !== "number") throw new Error(`${command} ${args.join(" ")}: ${failed.message}`, { cause: error });
    return { code: failed.code, stdout: failed.stdout ?? "" };
  }
};

/** `git merge-tree --write-tree --name-only`: exit 0 is a clean merge, 1 lists the conflicted files after the tree id. */
export function parseMergeTree(code: number, stdout: string): string[] {
  if (code === 0) return [];
  if (code !== 1) throw new Error(`git merge-tree failed (exit ${code})`);
  const names = stdout.split(/\r?\n/).slice(1);
  const end = names.indexOf("");
  const conflicts = end === -1 ? names : names.slice(0, end);
  // A conflict git reports without a file name must not read as a clean merge.
  if (conflicts.length === 0) throw new Error("git merge-tree reported a conflict but names no file");
  return conflicts;
}

/** git's stdout; throws when it fails. */
async function git(run: Exec, repo: string, ...args: string[]): Promise<string> {
  const done = await run("git", ["-c", "core.quotePath=false", ...args], repo);
  if (done.code !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${done.code})`);
  return done.stdout;
}

/**
 * The checked-out branch and the files HEAD changes since it left origin/main, deletions and a rename's old
 * path too. HEAD, not the working tree: it is the commit `git merge-tree` merges, so an uncommitted file
 * can't look shared and then merge clean. Throws when git fails.
 */
export async function branchFiles(repo: string, run: Exec = exec): Promise<BranchFiles> {
  const branch = (await git(run, repo, "rev-parse", "--abbrev-ref", "HEAD")).trim();
  const base = (await git(run, repo, "merge-base", "origin/main", "HEAD")).trim();
  const files = (await git(run, repo, "diff", "--name-only", "--no-renames", base, "HEAD")).split(/\r?\n/).filter(Boolean);
  return { branch, files: [...new Set(files)].sort() };
}

/** The files that would conflict merging `commit` into HEAD of `repo`. Throws when git can't say. */
export async function gitConflicts(repo: string, commit: string, run: Exec = exec): Promise<string[]> {
  const merge = await run("git", ["-c", "core.quotePath=false", "merge-tree", "--write-tree", "--name-only", "HEAD", commit], repo);
  return parseMergeTree(merge.code, merge.stdout);
}

/**
 * The overlap warning for the branch checked out in `repo` against GitHub's open PRs: "" when there is none,
 * and one line saying it could not look when GitHub or git can't answer. It never throws and never refuses.
 */
export async function overlapWarning(repo: string, seam: OverlapSeam = ghSeam(repo)): Promise<string> {
  try {
    return overlapMessage(await findOverlaps(await branchFiles(repo), seam));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Warning: check:claims could not look for open PRs that change the same files (${reason}); it did not check for overlaps.`;
  }
}

/** Most `gh` processes asked at once: one per open PR would be dozens. */
const GH_AT_ONCE = 5;

/** `items.map(fn)` with at most `limit` calls in flight, results in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

/** One `gh api` JSON line per open PR: a fork's branch is `owner/repo:branch`, so a fork PR named like this branch is not its own PR. */
const PULLS_JQ = '.[] | {number, ref: (if .head.repo.full_name == .base.repo.full_name then .head.ref else ((.head.repo.full_name // "fork") + ":" + .head.ref) end), head: .head.sha, body}';
/** The path of each file a PR changes, a rename's old path too. */
const FILES_JQ = ".[] | (.filename, (.previous_filename // empty))";

/** GitHub through `gh api` (the repo's own `{owner}/{repo}`) and git in `repo`. */
export function ghSeam(repo: string, run: Exec = exec): OverlapSeam {
  const gh = async (path: string, jq: string) => {
    const done = await run("gh", ["api", path, "--paginate", "--jq", jq], repo);
    if (done.code !== 0) throw new Error(`gh api ${path} failed (exit ${done.code})`);
    return done.stdout;
  };
  return {
    async openPrs() {
      const lines = (await gh("repos/{owner}/{repo}/pulls?state=open&per_page=100", PULLS_JQ)).split(/\r?\n/).filter((line) => line.trim() !== "");
      return mapLimit(lines, GH_AT_ONCE, async (line) => {
        const pull = JSON.parse(line) as { number: number; ref: string; head: string; body: string | null };
        const names = await gh(`repos/{owner}/{repo}/pulls/${pull.number}/files?per_page=100`, FILES_JQ);
        // A stamp counts only for the head it names: after a push the old line is stale.
        const stamped = verifiedCommits(pull.body ?? "").some((commit) => pull.head.startsWith(commit));
        return { number: pull.number, ref: pull.ref, head: pull.head, files: names.split(/\r?\n/).filter(Boolean), stamped };
      });
    },
    async conflictsWith(pr) {
      // The PR's head is not in a clone that never fetched it.
      if ((await run("git", ["cat-file", "-e", `${pr.head}^{commit}`], repo)).code !== 0) {
        const fetched = await run("git", ["fetch", "--quiet", "origin", `pull/${pr.number}/head`], repo);
        if (fetched.code !== 0) throw new Error(`git fetch origin pull/${pr.number}/head failed (exit ${fetched.code})`);
      }
      return gitConflicts(repo, pr.head, run);
    },
  };
}
