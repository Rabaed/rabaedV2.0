import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The working tree `pnpm verify` started on (RP-1169): a hash of every tracked file that differs from HEAD and of
// every untracked file that git does not ignore. HEAD moving is RP-1103's check (headMoved); this one catches what
// leaves HEAD alone: the Claude desktop's base-branch sync, a pull, a merge --no-commit or an edit mid-run, which tested
// half-merged files twice on #529. Both run after every step and, through verify.ts's poll, during one.
// Git and the file reads are passed in, so it is unit-tested without a repository.

/** A path of the working tree and the hash of what it holds ("gone" for a deleted file, "dir" for a folder). */
export type TreeSnapshot = Map<string, string>;

/** Runs git with `args` in the worktree: its stdout, or undefined when git failed. */
export type Git = (args: string[]) => string | undefined;

/** The hash of the file at `path`, relative to the worktree. */
export type FileHash = (path: string) => string;

/** Paths in `git status --porcelain=v1 -z` output (a rename or copy names two; both count). */
export function changedPaths(status: string): string[] {
  const fields = status.split("\0").filter((field) => field !== "");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // A rename or copy is followed by the path it came from, with no status code of its own.
    if (/[RC]/.test(code) && fields[i + 1] !== undefined) paths.push(fields[++i]!);
  }
  return paths;
}

/** The tree as it is now; undefined when git can't say (a run then does not check the tree rather than stop on a hiccup). */
export function treeSnapshot(git: Git, fileHash: FileHash): TreeSnapshot | undefined {
  const status = git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === undefined) return undefined;
  return new Map(changedPaths(status).map((path) => [path, fileHash(path)]));
}

/** One 16-hex hash of the whole snapshot, for the log line that says what the run started on. */
export function snapshotHash(snapshot: TreeSnapshot): string {
  const hash = createHash("sha256");
  for (const [path, content] of [...snapshot].sort(([a], [b]) => (a < b ? -1 : 1))) hash.update(`${path}\0${content}\0`);
  return hash.digest("hex").slice(0, 16);
}

const shown = 5;

/**
 * Why `pnpm verify` stops when the working tree is no longer `started`: the paths that differ, up to five. Undefined
 * while the tree is the same, or when either snapshot could not be read. A file reverted to HEAD's content counts too:
 * the steps before it saw the other content. The caller puts it after `<command> stopped after <step>: `.
 */
export function treeChanged(started: TreeSnapshot | undefined, now: TreeSnapshot | undefined): string | undefined {
  if (started === undefined || now === undefined) return undefined;
  const different = [...new Set([...started.keys(), ...now.keys()])].filter((path) => started.get(path) !== now.get(path)).sort();
  if (different.length === 0) return undefined;
  const named = different.slice(0, shown).join(", ");
  const more = different.length > shown ? ` and ${different.length - shown} more` : "";
  return `the working tree changed during the run (${named}${more}), so its steps did not all run on the same paths and no verify line is printed. A pull, a merge of main (Claude desktop's base-branch sync) or an edit did it: wait for the branch to settle, then run pnpm verify again.`;
}

/** Git in `root`, for real. */
export const systemGit =
  (root: string): Git =>
  (args) => {
    const done = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return done.status === 0 ? done.stdout : undefined;
  };

/** The sha256 of a file under `root`, read from disk. */
export const systemFileHash =
  (root: string): FileHash =>
  (path) => {
    try {
      const file = join(root, path);
      if (statSync(file).isDirectory()) return "dir";
      return createHash("sha256").update(readFileSync(file)).digest("hex");
    } catch {
      return "gone";
    }
  };

/** What the poll needs, passed in so it is unit-tested with a fake clock. */
export type WatchDeps = {
  /** The reason to stop, or undefined while nothing changed. */
  check: () => string | undefined;
  onChange: (message: string) => void;
  everyMs: number;
  setTimer: (tick: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

/**
 * Polls `check` every `everyMs` while a long step runs, so a merge in the middle of it stops the run at once and not
 * after the step (RP-1169). It calls `onChange` once, with the first reason, then stops. Returns the stop function.
 */
export function watchTree({ check, onChange, everyMs, setTimer, clearTimer }: WatchDeps): () => void {
  const timer: unknown = setTimer(() => {
    const message = check();
    if (message === undefined) return;
    clearTimer(timer);
    onChange(message);
  }, everyMs);
  return () => clearTimer(timer);
}
