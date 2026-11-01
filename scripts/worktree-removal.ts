import { protectedLaneReason } from "./lanes.ts";
import { isAppWorktree } from "./worktrees-pruning.ts";
import { samePath } from "./paths.ts";
import { listedChanges } from "./prune-guards.ts";
import { folderDeletionRefusal, worktreeRemovalRefusal, type Refused } from "./removal-guard.ts";
import { parseWorktrees, rdLongPath, type Worktree } from "./worktrees.ts";

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
 * worktree, one a Claude session works in, or lane 7's (Main 7's harness data), even with force; a
 * folder git does not list only under .claude/worktrees/; uncommitted or untracked files (listed)
 * and unpushed commits only with force.
 */
export function removalRefusal(t: RemoveTarget, { force, platform }: { force: boolean; platform?: NodeJS.Platform }): string | undefined {
  const refuse = (why: string) => `Not removed: ${t.path} is ${why}.`;
  if (!t.exists && t.registered === undefined) return refuse("no such worktree or folder");
  if (samePath(t.path, t.mainRoot, platform)) return refuse("the main checkout");
  if (samePath(t.path, t.currentRoot, platform)) return refuse("the current worktree");
  if (t.held !== undefined) return refuse(`held: ${t.held}`);
  const harness = protectedLaneReason(t.project);
  if (harness !== undefined) return refuse(`kept: ${harness}`);
  if (t.registered === undefined && !isAppWorktree(t.path, t.mainRoot, platform)) return refuse("not a worktree of this clone (and not under .claude/worktrees/)");
  if (force) return undefined;
  const again = `; \`pnpm worktree:remove "${t.path}" --force\` removes it anyway`;
  // A worktree git should read but whose state it could not tell is kept, as the prunes keep it.
  if (t.readable && (t.changes === undefined || (t.registered !== undefined && t.unpushed === undefined))) return refuse(`kept: git could not read its changes or commits${again}`);
  if (t.changes !== undefined && t.changes.length > 0) return refuse(`kept for its uncommitted changes${listedChanges(t.changes)}${again}`);
  if (t.unpushed !== undefined && t.unpushed > 0) return refuse(`kept for its ${plural(t.unpushed, "commit")} on no origin branch${again}`);
  return undefined;
}

type Steps = {
  /** Runs a command from the main checkout; throws (with stderr) when it fails. */
  run: (command: string, args: string[]) => string;
  /** Deletes a folder on Windows (worktrees.ts rdLongPath); throws, or returns its refusal, when it does not. */
  rd?: (path: string) => Refused | void;
  exists: (path: string) => boolean;
  platform?: NodeJS.Platform;
};

const stderrOf = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error);

/**
 * Removes the worktree: unlock, `git worktree remove --force` with core.longpaths, then whatever
 * folder is left with `rd /s /q \\?\…` (rm -rf off Windows), then `git worktree prune` for git's
 * record. removed: the folder is gone. steps: what each step said.
 *
 * RP-1198: it refuses on its own first, whatever the caller checked: removalRefusal's refusals that
 * --force does not lift, then the disk's own facts (removal-guard.ts): never the main checkout, lane 7's
 * worktree or the folder this runs in. Outside .claude/worktrees/ it deletes no folder: only
 * `git worktree remove` without --force, of a worktree git lists, so git keeps one with changes.
 */
export function removeWorktreeFolder(t: RemoveTarget, { run, rd = rdLongPath, exists, platform = process.platform }: Steps): Refused | { removed: boolean; steps: string[] } {
  const refused = removalRefusal(t, { force: true, platform }) ?? worktreeRemovalRefusal(t.path, platform);
  if (refused !== undefined) return { refused };
  const inside = folderDeletionRefusal(t.path, platform) === undefined;
  const listed = inside ? t.registered : listedWorktree(run, t.path, platform);
  if (!inside && listed === undefined) return { refused: `Not removed: ${t.path} is not under .claude/worktrees/, and git does not list it as a worktree.` };
  const steps: string[] = [];
  const step = (label: string, action: () => void) => {
    try {
      action();
      steps.push(`${label}: done`);
    } catch (error) {
      steps.push(`${label}: ${stderrOf(error)}`);
    }
  };
  if (listed?.locked !== undefined) {
    try {
      run("git", ["worktree", "unlock", t.path]);
    } catch {
      // Unlocked already, or git cannot read it: the remove below says what is wrong.
    }
  }
  if (!inside) step("git worktree remove", () => run("git", ["-c", "core.longpaths=true", "worktree", "remove", t.path]));
  else {
    if (t.registered !== undefined) step("git worktree remove", () => run("git", ["-c", "core.longpaths=true", "worktree", "remove", "--force", t.path]));
    if (exists(t.path)) {
      if (platform === "win32")
        step("rd /s /q", () => {
          const no = rd(t.path);
          if (no) throw Object.assign(new Error(no.refused), { stderr: no.refused });
        });
      else step("rm -rf", () => run("rm", ["-rf", t.path]));
    }
  }
  try {
    run("git", ["worktree", "prune"]);
  } catch (error) {
    steps.push(`git worktree prune: ${stderrOf(error)}`);
  }
  return { removed: !exists(t.path), steps };
}

/** The path's entry in `git worktree list`, read through run; undefined when git does not list it or cannot tell. */
function listedWorktree(run: Steps["run"], path: string, platform: NodeJS.Platform): Worktree | undefined {
  try {
    return parseWorktrees(run("git", ["worktree", "list", "--porcelain"])).find((w) => samePath(w.path, path, platform));
  } catch {
    return undefined;
  }
}
