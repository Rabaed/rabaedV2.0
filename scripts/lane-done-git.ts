import { execFileSync } from "node:child_process";

// The git questions `pnpm lane:done` (RP-1170) asks about a worktree's commit, against a target
// (origin/main), with git run in `cwd` (the main checkout). Here so they are tested on a temporary
// repository (lane-done-git.test.ts); lane-done-plan.ts judges the answers.

const git = (cwd: string, args: string[]) => execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lines = (out: string) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");

/**
 * Rule 3: the paths the commit's branch changed since it left the target whose content is not as
 * in the target. Empty when every change is in it, so a result cherry-picked onto main counts though
 * its commits are not there. Throws when git cannot tell (the worktree is then kept).
 */
export function filesNotInTarget(head: string, target: string, cwd: string): string[] {
  const base = git(cwd, ["merge-base", target, head]).trim();
  const changed = lines(git(cwd, ["diff", "--name-only", "--no-renames", base, head]));
  if (changed.length === 0) return [];
  const differs = new Set(lines(git(cwd, ["diff", "--name-only", "--no-renames", target, head])));
  return changed.filter((path) => differs.has(path));
}

/** Commits of head that the target does not have; throws when git cannot tell. */
export const aheadOf = (head: string, target: string, cwd: string): number => Number(git(cwd, ["rev-list", "--count", `${target}..${head}`]).trim());
