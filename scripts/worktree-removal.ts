import { isAppWorktree } from "./worktrees-pruning.ts";
import { samePath } from "./paths.ts";
import { listedChanges, protectedLaneReason } from "./prune-guards.ts";
import { rdLongPath, type Worktree } from "./worktrees.ts";

// `pnpm worktree:remove <path>` (RP-1101). On 2026-10-29 Main 4 three times had to finish by hand a
// `git worktree remove` that failed with "Filename too long" or "Function not implemented" after it
// had already deleted the worktree's .git: core.longpaths, then `rd /s /q \\?\<path>` for what was
// left, then `git worktree prune`. This does those steps, after the same refusals as the prunes.
// The decision (removalRefusal) and the steps (removeWorktreeFolder, through an injected runner)
// are here; worktree-remove.ts gathers the facts.

/** What git and the disk say about the folder to remove. */
export type RemoveTarget = {
  path: string;
  mainRoot: string;
  /** The worktree the command runs from. */
  currentRoot: string;
  /** Its entry in `git worktree list`, or undefined when git no longer lists it. */
  registered: Worktree | undefined;
  exists: boolean;
  /** Its .git is still there, so git should read its changes and commits. */
  readable: boolean;
  /** `git status --porcelain` lines; undefined when git cannot read it (its .git is gone). */
  changes: string[] | undefined;
  /** Commits on HEAD no origin branch has; undefined when git cannot tell. */
  unpushed: number | undefined;
  /** COMPOSE_PROJECT_NAME from its .env. */
  project: string | undefined;
  /** Why a running or desktop Claude session holds it (claude-sessions.ts holdReason), or undefined. */
  held: string | undefined;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Why the folder is not removed, or undefined when it goes. Never the main checkout, the current
 * worktree, one a Claude session works in, or lane 7's (the live UAT stack), even with force; a
 * folder git does not list only under .claude/worktrees/; uncommitted or untracked files (listed)
 * and unpushed commits only with force.
 */
export function removalRefusal(t: RemoveTarget, { force, platform }: { force: boolean; platform?: NodeJS.Platform }): string | undefined {
  const refuse = (why: string) => `Not removed: ${t.path} is ${why}.`;
  if (!t.exists && t.registered === undefined) return refuse("no such worktree or folder");
  if (samePath(t.path, t.mainRoot, platform)) return refuse("the main checkout");
  if (samePath(t.path, t.currentRoot, platform)) return refuse("the current worktree");
  if (t.held !== undefined) return refuse(`held: ${t.held}`);
  const uat = protectedLaneReason(t.project);
  if (uat !== undefined) return refuse(`lane 7's: ${uat}`);
  if (t.registered === undefined && !isAppWorktree(t.path, t.mainRoot, platform)) return refuse("not a worktree of this clone (and not under .claude/worktrees/)");
  if (force) return undefined;
  const again = "; `--force` removes it anyway";
  // A worktree git should read but whose state it could not tell is kept, as the prunes keep it.
  if (t.readable && (t.changes === undefined || (t.registered !== undefined && t.unpushed === undefined))) return refuse(`kept: git could not read its changes or commits${again}`);
  if (t.changes !== undefined && t.changes.length > 0) return refuse(`kept for its uncommitted changes${listedChanges(t.changes)}${again}`);
  if (t.unpushed !== undefined && t.unpushed > 0) return refuse(`kept for its ${plural(t.unpushed, "commit")} on no origin branch${again}`);
  return undefined;
}

type Steps = {
  /** Runs a command; throws (with stderr) when it fails. */
  run: (command: string, args: string[]) => string;
  /** Deletes a folder on Windows (worktrees.ts rdLongPath); throws when it fails. */
  rd?: (path: string) => void;
  exists: (path: string) => boolean;
  platform?: NodeJS.Platform;
};

const stderrOf = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error);

/**
 * Removes the worktree: unlock, `git worktree remove --force` with core.longpaths, then whatever
 * folder is left with `rd /s /q \\?\…` (rm -rf off Windows), then `git worktree prune` for git's
 * record. removed: the folder is gone. steps: what each step said.
 */
export function removeWorktreeFolder(t: RemoveTarget, { run, rd = rdLongPath, exists, platform = process.platform }: Steps): { removed: boolean; steps: string[] } {
  const steps: string[] = [];
  const step = (label: string, action: () => void) => {
    try {
      action();
      steps.push(`${label}: done`);
    } catch (error) {
      steps.push(`${label}: ${stderrOf(error)}`);
    }
  };
  if (t.registered?.locked !== undefined) {
    try {
      run("git", ["worktree", "unlock", t.path]);
    } catch {
      // Unlocked already, or git cannot read it: the remove below says what is wrong.
    }
  }
  if (t.registered !== undefined) step("git worktree remove", () => run("git", ["-c", "core.longpaths=true", "worktree", "remove", "--force", t.path]));
  if (exists(t.path)) {
    if (platform === "win32") step("rd /s /q", () => rd(t.path));
    else step("rm -rf", () => run("rm", ["-rf", t.path]));
  }
  try {
    run("git", ["worktree", "prune"]);
  } catch (error) {
    steps.push(`git worktree prune: ${stderrOf(error)}`);
  }
  return { removed: !exists(t.path), steps };
}
