import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// RP-1101: Auto-fix twice left a half-done merge of main in a lane worktree, with
// docs/visibility.md still conflicted, and the next `pnpm verify` ran on it. `pnpm verify` and
// the pre-push hook now refuse while MERGE_HEAD exists, naming the conflicted files.

/** Whether a merge is in progress in a worktree (MERGE_HEAD exists), and its files still conflicted. */
export type MergeState = { inProgress: false } | { inProgress: true; conflicted: string[] };

const git = (dir: string, ...args: string[]) => spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: dir, encoding: "utf8" });

/** Reads the worktree's merge state: MERGE_HEAD in its own git dir (each worktree has one), then `git diff --diff-filter=U`. */
export function readMergeState(dir: string): MergeState {
  const path = git(dir, "rev-parse", "--git-path", "MERGE_HEAD").stdout.trim();
  if (path === "" || !existsSync(resolve(dir, path))) return { inProgress: false };
  const conflicted = git(dir, "diff", "--name-only", "--diff-filter=U").stdout.split(/\r?\n/).filter(Boolean);
  return { inProgress: true, conflicted };
}

/** Why `what` ("pnpm verify", "Push") is refused while a merge is in progress, or undefined when none is. */
export function mergeRefusal(state: MergeState, what: string): string | undefined {
  if (!state.inProgress) return undefined;
  /* eslint-disable rabaed/no-avoid-terms -- git's own words for the paths of a merge, not Rabaed Files. */
  const files =
    state.conflicted.length > 0
      ? ["Conflicted files:", ...state.conflicted.map((f) => `  ${f}`)]
      : ["No conflicted file is left, but the merge is not committed."];
  /* eslint-enable rabaed/no-avoid-terms */
  return [
    `${what} refused: a merge is in progress (MERGE_HEAD exists).`,
    ...files,
    "Resolve them and `git commit` to finish the merge, or `git merge --abort` to undo it, then run it again.",
  ].join("\n");
}
