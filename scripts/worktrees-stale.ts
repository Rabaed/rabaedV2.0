import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Skipped, Worktree } from "./worktrees.ts";

// The "Stale" section of `pnpm worktrees:prune` and `pnpm worktrees:clean` (RP-506):
// of the worktrees they skip, those whose last commit and newest changed file are both
// older than --stale-days (default 7), with age, branch and, when locked, whether the
// lock's pid still runs. It only lists; removal stays a person's call. The decision
// (findStale) is pure; the git, disk and process lookups are injected and below.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STALE_DAYS = 7;

/** Epoch milliseconds of the last commit on HEAD and of the newest changed file; undefined when there is none. */
export type Activity = { lastCommit: number | undefined; newestChange: number | undefined };

export type StaleEntry = {
  worktree: Worktree;
  reason: string;
  /** Whole days since the newer of the last commit and the newest changed file. */
  ageDays: number;
  /** The pid named in the lock reason, if any. */
  pid: number | undefined;
  /** Whether that pid is running; undefined without a pid. */
  pidRunning: boolean | undefined;
};

type StaleInput = {
  skipped: Skipped[];
  now: number;
  staleDays: number;
  /** undefined when the worktree's activity cannot be read. */
  activityOf: (path: string) => Activity | undefined;
  pidRunning: (pid: number) => boolean;
};

/** The pid in the app's lock reasons ("claude agent … (pid 1234)"). */
export function lockPid(locked: string | undefined): number | undefined {
  const m = locked ? /\bpid (\d+)/i.exec(locked) : null;
  return m ? Number(m[1]) : undefined;
}

/** The --stale-days value, or undefined when it is not a positive number. */
export function parseStaleDays(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_STALE_DAYS;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The valid --stale-days value when args[i] is that flag, else undefined (the flag's value is args[i + 1]). */
export function staleDaysAt(args: string[], i: number): number | undefined {
  const value = args[i + 1];
  return args[i] === "--stale-days" && value !== undefined ? parseStaleDays(value) : undefined;
}

/** The skipped worktrees untouched for at least staleDays, oldest first. */
export function findStale({ skipped, now, staleDays, activityOf, pidRunning }: StaleInput): StaleEntry[] {
  const entries: StaleEntry[] = [];
  for (const { worktree, reason } of skipped) {
    const activity = activityOf(worktree.path);
    const times = [activity?.lastCommit, activity?.newestChange].filter((t): t is number => t !== undefined);
    if (times.length === 0) continue;
    const age = (now - Math.max(...times)) / DAY_MS;
    if (age < staleDays) continue;
    const pid = lockPid(worktree.locked);
    entries.push({ worktree, reason, ageDays: Math.floor(age), pid, pidRunning: pid === undefined ? undefined : pidRunning(pid) });
  }
  return entries.sort((a, b) => b.ageDays - a.ageDays);
}

/** One line per stale worktree. */
export function formatStale(entries: StaleEntry[]): string[] {
  return entries.map((e) => {
    const lock = e.pid !== undefined ? `; locked, pid ${e.pid} ${e.pidRunning ? "is still running" : "is not running"}` : e.worktree.locked !== undefined ? "; locked" : "";
    return `  ${e.worktree.path} (${e.worktree.branch ?? "detached HEAD"}), ${e.ageDays} ${e.ageDays === 1 ? "day" : "days"}: ${e.reason}${lock}`;
  });
}

/** Prints the Stale section for the skipped worktrees (nothing when none is stale). Read-only. */
export function printStale(skipped: Skipped[], staleDays: number): void {
  const entries = findStale({ skipped, now: Date.now(), staleDays, activityOf: readActivity, pidRunning: isRunning });
  if (entries.length === 0) return;
  console.log(`Stale (nothing committed or changed for ${staleDays}+ days; listed only, remove by hand if you decide to):`);
  for (const line of formatStale(entries)) console.log(line);
}

/** Whether a process with the pid exists (signal 0 sends nothing). */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The worktree's last commit time and the newest modification time among its uncommitted files. */
export function readActivity(path: string): Activity | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const commit = git(["log", "-1", "--format=%ct"], path).trim();
    const lastCommit = commit === "" ? undefined : Number(commit) * 1000;
    // -z output: "XY path\0", with a second "\0from" entry after a rename.
    const files = git(["--no-optional-locks", "status", "--porcelain", "-z", "--untracked-files=all"], path)
      .split("\0")
      .filter((e) => e.length > 3 && e[2] === " ")
      .map((e) => e.slice(3));
    let newestChange: number | undefined;
    for (const file of files) {
      try {
        const t = statSync(join(path, file)).mtimeMs;
        if (newestChange === undefined || t > newestChange) newestChange = t;
      } catch {
        // A deleted file has no time.
      }
    }
    return { lastCommit, newestChange };
  } catch {
    return undefined;
  }
}
