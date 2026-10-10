import { mergedProjects, staleProjects, type Container, type StaleProject, type Volume, type WorktreeLane } from "./lanes.ts";
import { normalPath, samePath } from "./paths.ts";
import { CURRENT_WORKTREE, lockedByApp, type LocalBranch, type Skipped, type Worktree, type WorktreeFacts } from "./worktrees.ts";

// What `pnpm worktrees:prune` removes once PRs have merged (RP-308): every worktree
// merged into origin/main, with its rabaed-* compose project and branch, then the
// other local branches merged into origin/main, then the orphaned compose projects
// lanes:prune would remove. The decision (choosePrune) is pure; worktrees-prune.ts
// gathers the facts and acts on them.

/** What git and the disk say about one worktree; `ahead` counts commits origin/main lacks. */
export type PruneWorktree = WorktreeFacts & {
  /** Its branch had an upstream that `git fetch --prune` found deleted on origin. */
  upstreamGone: boolean;
  /** Commits on HEAD that no origin branch has. */
  unpushed: number;
  /** COMPOSE_PROJECT_NAME from its .env, if any. */
  project: string | undefined;
};

export type DockerState = {
  containers: Container[];
  volumes: Volume[];
  /** COMPOSE_PROJECT_NAME of the current worktree's .env. */
  currentProject: string | undefined;
};

type PruneInput = {
  /** Every worktree of the clone (`git worktree list`). */
  worktrees: PruneWorktree[];
  branches: LocalBranch[];
  mainRoot: string;
  /** The worktree this runs from. */
  currentPath: string;
  /** Whether a folder exists (existsSync); for compose projects whose worktree is gone. */
  exists: (dir: string) => boolean;
  /** Undefined when Docker is not running: no compose project is chosen. */
  docker: DockerState | undefined;
  platform?: NodeJS.Platform;
};

export type PruneChoice = {
  remove: Worktree[];
  skipped: Skipped[];
  /** Other local branches to delete, merged into origin/main and checked out nowhere. */
  branches: string[];
  /** Compose projects to remove: those of removed worktrees, and the orphans lanes:prune finds. */
  projects: PruneProject[];
};

export type PruneProject = StaleProject & {
  /**
   * The worktrees chosen for removal it belongs to: it goes only once they are all
   * removed. Empty for an orphan lanes:prune removes anyway.
   */
  waitsFor: string[];
};

/** Whether the path is under `<mainRoot>/.claude/worktrees/`, where the desktop app makes its worktrees. */
export function isAppWorktree(path: string, mainRoot: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalPath(path, platform).startsWith(`${normalPath(mainRoot, platform)}/.claude/worktrees/`);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Which worktrees, branches and compose projects to remove. A worktree goes when it is
 * merged: all its commits are in origin/main and its branch has had one of its own, or
 * its upstream is gone (desktop-app worktrees need the former). Never the main checkout,
 * the current worktree, one on `main`, one locked by hand, or one with uncommitted
 * changes or commits on no origin branch (so a squash-merged worktree whose remote
 * branch was deleted stays); those are skipped with their reason.
 */
export function choosePrune({ worktrees, branches, mainRoot, currentPath, docker, exists, platform }: PruneInput): PruneChoice {
  const remove: Worktree[] = [];
  const skipped: Skipped[] = [];
  for (const facts of worktrees) {
    const w: Worktree = { path: facts.path, head: facts.head, branch: facts.branch, locked: facts.locked };
    const reason = skipReason(facts, mainRoot, currentPath, platform);
    if (reason) skipped.push({ worktree: w, reason });
    else remove.push(w);
  }

  const removed = (path: string) => remove.some((w) => samePath(w.path, path, platform));
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b) => b !== undefined));
  const branchesToDelete = branches
    .filter((b) => b.branch !== "main" && !checkedOut.has(b.branch) && b.inTarget &&(b.ownCommit || b.upstreamGone))
    .map((b) => b.branch);

  return { remove, skipped, branches: branchesToDelete, projects: docker ? projectsToRemove({ worktrees, removed, folderExists: exists, cwd: currentPath, docker, platform }) : [] };
}

/**
 * Why a worktree chosen for removal stays after all, judged on its facts gathered
 * again just before removing it (undefined when no longer listed by git), or
 * undefined when it still goes.
 */
export function changedSinceListed(now: PruneWorktree | undefined): string | undefined {
  if (!now) return "no longer a worktree";
  if (now.dirty) return "uncommitted changes since it was listed";
  if (now.unpushed > 0) return `${plural(now.unpushed, "commit")} on no origin branch since it was listed`;
  return undefined;
}

/** Why a worktree stays, or undefined when it goes. */
function skipReason(w: PruneWorktree, mainRoot: string, currentPath: string, platform: NodeJS.Platform | undefined): string | undefined {
  if (samePath(w.path, mainRoot, platform)) return "the main checkout";
  if (samePath(w.path, currentPath, platform)) return CURRENT_WORKTREE;
  if (w.branch === "main") return "on main";
  if (w.locked !== undefined && /^claude session\b/i.test(w.locked)) return `its Claude desktop session is open (${w.locked}); archive it first`;
  if (w.locked !== undefined && !lockedByApp(w.locked)) return `locked by hand (${w.locked || "no reason"})`;
  if (w.dirty) return "uncommitted changes";
  if (w.unpushed > 0) return `${plural(w.unpushed, "commit")} on no origin branch`;
  const merged = (w.ahead === 0 && !w.noCommitsYet) || (w.upstreamGone && !isAppWorktree(w.path, mainRoot, platform));
  if (merged) return undefined;
  return w.ahead > 0 ? `${plural(w.ahead, "commit")} not in origin/main` : "no commits yet, may still be running";
}

type ProjectsInput = {
  worktrees: PruneWorktree[];
  /** Whether the worktree at the path is chosen for removal. */
  removed: (path: string) => boolean;
  folderExists: (dir: string) => boolean;
  cwd: string;
  docker: DockerState;
  platform: NodeJS.Platform | undefined;
};

/**
 * lanes:prune's two rules (mergedProjects, staleProjects) with the removed worktrees
 * counted as merged and gone. A project a kept worktree names in its .env always stays:
 * it may share that lane's database (lane:env --db) without containers of its own.
 * A project lanes:prune alone would not remove waits for the removed worktrees it
 * belongs to (by their .env or its containers' folder).
 */
function projectsToRemove({ worktrees, removed, folderExists, cwd, docker, platform }: ProjectsInput): PruneProject[] {
  const orphans = new Set(chosenProjects({ worktrees, removed: () => false, folderExists, cwd, docker, platform }).map((p) => p.project));
  return chosenProjects({ worktrees, removed, folderExists, cwd, docker, platform }).map((p) => {
    const dirs = docker.containers.filter((c) => c.project === p.project).map((c) => c.workingDir);
    const waitsFor = orphans.has(p.project)
      ? []
      : worktrees.filter((w) => removed(w.path) && (w.project === p.project || dirs.some((d) => samePath(d, w.path, platform)))).map((w) => w.path);
    return { ...p, waitsFor };
  });
}

function chosenProjects({ worktrees, removed, folderExists, cwd, docker: { containers, volumes, currentProject }, platform }: ProjectsInput): StaleProject[] {
  const lanes: WorktreeLane[] = worktrees.map((w) => ({ path: w.path, branch: w.branch, merged: removed(w.path), project: w.project }));
  const kept = new Set(worktrees.filter((w) => !removed(w.path)).map((w) => w.project));
  const exists = (dir: string) => !removed(dir) && folderExists(dir);
  const all = [
    ...mergedProjects({ containers, volumes, worktrees: lanes, cwd, currentProject, platform }),
    ...staleProjects({ containers, volumes, cwd, currentProject, exists, platform }),
  ];
  return all.filter((p, i) => !kept.has(p.project) && all.findIndex((q) => q.project === p.project) === i).sort((a, b) => a.project.localeCompare(b.project));
}
