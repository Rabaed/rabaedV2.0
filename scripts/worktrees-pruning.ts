import { holdReason, type Holders } from "./claude-sessions.ts";
import { openSessionReason } from "./desktop-sessions.ts";
import {
  chooseMerged,
  claimOf,
  keptByClaims,
  projectInUseNow,
  staleProjects,
  type Container,
  type EnvClaim,
  type KeptProject,
  type ProjectNow,
  type StaleProject,
  type Volume,
  type WorktreeLane,
} from "./lanes.ts";
import { normalPath, samePath } from "./paths.ts";
import { guardCandidates, listedChanges, protectedLaneReason } from "./prune-guards.ts";
import { CURRENT_WORKTREE, isFinished, lockedByApp, stillStarting, type LocalBranch, type Skipped, type Worktree, type WorktreeFacts } from "./worktrees.ts";

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
  /**
   * The running Claude sessions (claude-sessions.ts, RP-956: a session that moved in with
   * EnterWorktree leaves no lock) and the desktop sessions, found in the app's own records
   * (desktop-sessions.ts, RP-608): the app does not lock its worktrees with git.
   */
  holders: Holders;
  platform?: NodeJS.Platform;
};

export type PruneChoice = {
  remove: Worktree[];
  skipped: Skipped[];
  /** Other local branches to delete, merged into origin/main and checked out nowhere. */
  branches: string[];
  /** Compose projects to remove: those of removed worktrees, and the orphans lanes:prune finds. */
  projects: PruneProject[];
  /** Compose projects that would go but a kept worktree's .env names (RP-1007), with that worktree and why (RP-1073). */
  kept: KeptProject[];
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
 * finished (worktrees.ts isFinished: all its commits are in origin/main, and its branch
 * has had one of its own or nothing holds it), or its upstream is gone (desktop-app
 * worktrees need the former). Never the main checkout,
 * the current worktree, one on `main`, one locked by hand, or one with uncommitted
 * changes or commits on no origin branch (so a squash-merged worktree whose remote
 * branch was deleted stays); those are skipped with their reason.
 */
export function choosePrune({ worktrees, branches, mainRoot, currentPath, docker, exists, holders, platform }: PruneInput): PruneChoice {
  const remove: Worktree[] = [];
  const skipped: Skipped[] = [];
  for (const facts of worktrees) {
    const w: Worktree = { path: facts.path, head: facts.head, branch: facts.branch, locked: facts.locked };
    const reason = skipReason(facts, holders, mainRoot, currentPath, platform);
    if (reason) skipped.push({ worktree: w, reason });
    else remove.push(w);
  }

  const removed = (path: string) => remove.some((w) => samePath(w.path, path, platform));
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b) => b !== undefined));
  const branchesToDelete = branches
    .filter((b) => b.branch !== "main" && !checkedOut.has(b.branch) && b.inTarget &&(b.ownCommit || b.upstreamGone))
    .map((b) => b.branch);

  const projectChoice = docker ? projectsToRemove({ worktrees, removed, folderExists: exists, cwd: currentPath, docker, holders, platform }) : { chosen: [], kept: [] };
  return { remove, skipped, branches: branchesToDelete, projects: projectChoice.chosen, kept: projectChoice.kept };
}

/** The listed worktrees' .env claims on rabaed-* projects, as envClaims reads them (RP-1007), for projectInUseNow. */
export const listedClaims = (worktrees: PruneWorktree[]): EnvClaim[] => worktrees.flatMap((w) => claimOf(w, w.project));

type RemoveProjectsInput = {
  /** choosePrune's projects, in its order. */
  projects: PruneProject[];
  /** The worktrees this run has removed. */
  removedPaths: string[];
  /** The worktrees and containers as listed before the prompt. */
  listed: { worktrees: PruneWorktree[]; containers: Container[] };
  /** Reads a project's state now (lanes.ts readProjectNow): called for each project just before it goes. */
  readNow: (project: string) => ProjectNow;
  /** Whether a folder exists now. */
  exists: (dir: string) => boolean;
  /** Removes one project; it may throw, which the caller counts. */
  remove: (project: PruneProject) => void;
  log: (line: string) => void;
  platform?: NodeJS.Platform;
};

/**
 * worktrees:prune's last step for its compose projects, one at a time. A worktree's project goes
 * only once that worktree is removed (orphans go regardless). Then each is judged again just
 * before it goes (RP-1073: removing the worktrees can take minutes, and a session may run
 * lane:env or start the lane meanwhile): projectInUseNow on what readNow reads now keeps it.
 */
export function removeProjectsNow({ projects, removedPaths, listed, readNow, exists, remove, log, platform }: RemoveProjectsInput): void {
  const removed = (path: string) => removedPaths.some((r) => samePath(r, path, platform));
  for (const p of projects) {
    const waiting = p.waitsFor.filter((path) => !removed(path));
    if (waiting.length > 0) {
      log(`Kept compose project ${p.project}: ${waiting.join(", ")} was not removed.`);
      continue;
    }
    const inUse = projectInUseNow(p.project, {
      listedClaims: listedClaims(listed.worktrees),
      listedContainers: listed.containers,
      now: readNow(p.project),
      exists: (dir) => exists(dir) && !removed(dir),
      platform,
    });
    if (inUse !== undefined) {
      log(`Kept compose project ${p.project}: ${inUse}.`);
      continue;
    }
    remove(p);
  }
}

/**
 * Why a worktree chosen for removal stays after all, judged on its facts gathered
 * again just before removing it (undefined when no longer listed by git) with the
 * running and desktop sessions read again too (holders, fresh), or undefined when it still goes.
 */
export function changedSinceListed(now: PruneWorktree | undefined, holders: Holders): string | undefined {
  if (!now) return "no longer a worktree";
  const held = holdReason(now.path, holders, { sinceListed: true });
  if (held !== undefined) return held;
  if (now.dirty) return `uncommitted changes since it was listed${listedChanges(now.changes)}`;
  if (now.unpushed > 0) return `${plural(now.unpushed, "commit")} on no origin branch since it was listed`;
  return undefined;
}

/** Why a worktree stays, or undefined when it goes. */
function skipReason(w: PruneWorktree, holders: Holders, mainRoot: string, currentPath: string, platform: NodeJS.Platform | undefined): string | undefined {
  if (samePath(w.path, mainRoot, platform)) return "the main checkout";
  if (samePath(w.path, currentPath, platform)) return CURRENT_WORKTREE;
  // RP-1101: the worktree whose .env names lane 7 serves the live UAT stack.
  const uat = protectedLaneReason(w.project);
  if (uat !== undefined) return uat;
  if (w.branch === "main") return "on main";
  if (w.locked !== undefined && /^claude session\b/i.test(w.locked)) return openSessionReason({ kind: "open", session: w.locked });
  const held = holdReason(w.path, holders);
  if (held !== undefined) return held;
  if (w.locked !== undefined && !lockedByApp(w.locked)) return `locked by hand (${w.locked || "no reason"})`;
  if (w.dirty) return `uncommitted changes${listedChanges(w.changes)}`;
  if (w.unpushed > 0) return `${plural(w.unpushed, "commit")} on no origin branch`;
  const merged = isFinished(w) || (w.upstreamGone && !isAppWorktree(w.path, mainRoot, platform));
  if (merged) return undefined;
  return w.ahead > 0 ? `${plural(w.ahead, "commit")} not in origin/main` : `no commits yet, may still be running (${stillStarting(w)})`;
}

type ProjectsInput = {
  worktrees: PruneWorktree[];
  /** Whether the worktree at the path is chosen for removal. */
  removed: (path: string) => boolean;
  folderExists: (dir: string) => boolean;
  cwd: string;
  docker: DockerState;
  holders: Holders;
  platform: NodeJS.Platform | undefined;
};

/**
 * lanes:prune's two rules (chooseMerged, staleProjects) with the removed worktrees
 * counted as merged and gone. A project a kept worktree names in its .env always stays:
 * it may share that lane's database (lane:env --db) without containers of its own.
 * A project lanes:prune alone would not remove waits for the removed worktrees it
 * belongs to (by their .env or its containers' folder). Kept lists the projects a kept
 * worktree's .env saved, naming it.
 */
function projectsToRemove(input: ProjectsInput): { chosen: PruneProject[]; kept: KeptProject[] } {
  const { worktrees, removed, docker, platform } = input;
  const orphans = new Set(chosenProjects({ ...input, removed: () => false }).prune.map((p) => p.project));
  const { prune, kept } = chosenProjects(input);
  const chosen = prune.map((p) => {
    const dirs = docker.containers.filter((c) => c.project === p.project).map((c) => c.workingDir);
    const waitsFor = orphans.has(p.project)
      ? []
      : worktrees.filter((w) => removed(w.path) && (w.project === p.project || dirs.some((d) => samePath(d, w.path, platform)))).map((w) => w.path);
    return { ...p, waitsFor };
  });
  return { chosen, kept };
}

function chosenProjects({ worktrees, removed, folderExists, cwd, docker: { containers, volumes, currentProject }, holders, platform }: ProjectsInput): { prune: StaleProject[]; kept: KeptProject[] } {
  const lanes: WorktreeLane[] = worktrees.map((w) => ({ path: w.path, branch: w.branch, merged: removed(w.path), project: w.project }));
  const exists = (dir: string) => !removed(dir) && folderExists(dir);
  const all = [
    ...chooseMerged({ containers, volumes, worktrees: lanes, cwd, currentProject, holders, platform }).merged,
    ...staleProjects({ containers, volumes, cwd, currentProject, exists, platform }),
  ];
  const unique = all.filter((p, i) => all.findIndex((q) => q.project === p.project) === i).sort((a, b) => a.project.localeCompare(b.project));
  // RP-1101: never lane 7, nor a stale project whose existing folder a Claude session works in.
  const guarded = guardCandidates(unique, containers, holders, exists);
  const claimed = keptByClaims(guarded.prune, listedClaims(worktrees.filter((w) => !removed(w.path))));
  return { prune: claimed.prune, kept: [...guarded.kept, ...claimed.kept] };
}
