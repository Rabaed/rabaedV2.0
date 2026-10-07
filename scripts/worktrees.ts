import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { normalPath, samePath } from "./paths.ts";

// Cleaning up the app-made agent worktrees `/implement-spec` leaves under
// .claude/worktrees/agent-* (RP-326, planning/parallel-sessions.md). On Windows
// `git worktree remove` deregisters a worktree but fails with "Directory not empty"
// when node_modules is left behind, so the folder is deleted here as well. Used by
// worktrees-clean.ts, and by worktrees-prune.ts for any worktree (removeLinkedWorktree).
// The decision (chooseWorktrees) is pure; git and fs calls are below.

export type Worktree = {
  path: string;
  head: string;
  /** Short branch name, or undefined when HEAD is detached. */
  branch: string | undefined;
  /** The lock reason ("" when locked without one), or undefined when not locked. */
  locked: string | undefined;
};

/** What git and the disk say about one agent worktree. */
export type WorktreeFacts = Worktree & {
  /** Commits on HEAD that the target branch does not have. */
  ahead: number;
  /** Uncommitted changes, including untracked files that are not ignored. */
  dirty: boolean;
  /**
   * Its branch (or detached HEAD) has never had a commit of its own (see hasOwnCommit),
   * so its subagent may still be running: a new agent worktree has nothing ahead and
   * nothing tracked changed, and the app's lock names the parent session's pid.
   */
  noCommitsYet: boolean;
};

/**
 * Whether a reflog (its entries' subjects, `git reflog --format=%gs`) shows a commit
 * made on that branch: a commit, merge commit, cherry-pick, revert or `git am`.
 * Creating, renaming or resetting the branch, and fast-forwarding it, make none.
 * A subject not recognised counts as no commit, so such a worktree is kept.
 */
export function hasOwnCommit(subjects: string[]): boolean {
  return subjects.some((s) => /^(commit|cherry-pick|revert|am)\b/.test(s) || (/^(merge|pull)\b/.test(s) && !/: Fast-forward$/.test(s)));
}

export type Skipped = { worktree: Worktree; reason: string };

/** Parses `git worktree list --porcelain`. */
export function parseWorktrees(out: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    let current: Worktree | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) current = { path: line.slice("worktree ".length), head: "", branch: undefined, locked: undefined };
      else if (!current) continue;
      else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "locked" || line.startsWith("locked ")) current.locked = line.slice("locked".length).trim();
    }
    if (current) worktrees.push(current);
  }
  return worktrees;
}

/** Whether the path is `<mainRoot>/.claude/worktrees/agent-*`: the folders the app makes for subagents. */
export function isAgentWorktree(path: string, mainRoot: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = normalPath(path, platform);
  const dir = `${normalPath(mainRoot, platform)}/.claude/worktrees/`;
  return p.startsWith(dir) && /^agent-[^/]+$/.test(p.slice(dir.length));
}

/** The app locks the worktrees it makes for subagents with a reason starting "claude agent". */
export const lockedByApp = (reason: string) => /^claude agent\b/i.test(reason);

type ChooseInput = {
  worktrees: WorktreeFacts[];
  /** The worktree this runs from; it is never removed. */
  currentPath: string;
  /** Also remove worktrees with no commits yet (--include-empty). */
  includeEmpty?: boolean;
  platform?: NodeJS.Platform;
};

/**
 * Which agent worktrees to remove: those whose commits are all in the target
 * branch (a merged branch, or a detached HEAD with no unique commits), that
 * have no uncommitted changes, and whose branch has had a commit of its own
 * (unless includeEmpty). Everything else is skipped with its reason.
 * The caller passes agent worktrees only.
 */
export function chooseWorktrees({ worktrees, currentPath, includeEmpty = false, platform }: ChooseInput): { remove: Worktree[]; skipped: Skipped[] } {
  const remove: Worktree[] = [];
  const skipped: Skipped[] = [];
  for (const { ahead, dirty, noCommitsYet, ...w } of worktrees) {
    const reason = samePath(w.path, currentPath, platform)
      ? "this is the current worktree"
      : dirty
        ? "uncommitted changes"
        : ahead > 0
          ? `${ahead} unmerged commit${ahead === 1 ? "" : "s"}${w.branch ? ` on ${w.branch}` : " (detached HEAD)"}`
          : noCommitsYet && !includeEmpty
            ? "no commits yet, may still be running (--include-empty removes it)"
            : w.locked !== undefined && !lockedByApp(w.locked)
              ? `locked by hand (${w.locked || "no reason"})`
              : undefined;
    if (reason) skipped.push({ worktree: w, reason });
    else remove.push(w);
  }
  return { remove, skipped };
}

const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export const gitError = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error);

/** Every worktree; the first is the main working folder. */
export function listWorktrees(cwd?: string): Worktree[] {
  return parseWorktrees(git(["worktree", "list", "--porcelain"], cwd));
}

/** The current worktree's top folder. */
export const currentRoot = (): string => git(["rev-parse", "--show-toplevel"]).trim();

/** Whether the branch (or ref) exists. */
export function refExists(ref: string, cwd: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the branch has had a commit of its own and all its commits are in target
 * (e.g. origin/main): its PR has merged. A new branch with nothing of its own yet is
 * not merged; its session may be just starting.
 */
export function branchMerged(branch: string, target: string, cwd: string): boolean {
  if (!hasOwnCommit(reflogSubjects(`refs/heads/${branch}`, cwd))) return false;
  try {
    git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, target], cwd);
    return true;
  } catch {
    return false;
  }
}

/** The subjects of a ref's reflog, newest first; none when it has no reflog. */
function reflogSubjects(ref: string, cwd: string): string[] {
  try {
    return git(["reflog", "show", "--format=%gs", ref, "--"], cwd)
      .split(/\r?\n/)
      .filter((s) => s !== "");
  } catch {
    return [];
  }
}

/** Looks each worktree up: its commits the target lacks, whether it has uncommitted changes, and whether it has had a commit of its own. */
export function gatherFacts(worktrees: Worktree[], target: string, mainRoot: string): WorktreeFacts[] {
  return worktrees.map((w) => {
    // A folder deleted by hand is still listed; it has nothing uncommitted, and no subagent runs in it.
    const exists = existsSync(w.path);
    const dirty = exists && git(["status", "--porcelain"], w.path).trim() !== "";
    const ahead = Number(git(["rev-list", "--count", `${target}..${w.head}`], mainRoot).trim());
    // A branch's reflog is shared by every worktree; a detached HEAD's is the worktree's own.
    const subjects = w.branch ? reflogSubjects(`refs/heads/${w.branch}`, mainRoot) : exists ? reflogSubjects("HEAD", w.path) : [];
    return { ...w, ahead, dirty, noCommitsYet: exists && !hasOwnCommit(subjects) };
  });
}

/**
 * Unlocks, removes and deletes one worktree: its folder (git leaves it behind on
 * Windows when node_modules is in it) and its branch. The branch is deleted with
 * `git branch -D` when it is an ancestor of the target branch; `git branch -d` would
 * check against the main folder's HEAD, not the target. The `worktree-agent-*` branch
 * the app created the worktree on (named after its folder) goes too when it is in the
 * target. Returns why the branch was kept, if it was.
 */
export function removeWorktree(w: Worktree, mainRoot: string, target = "main"): { branchKept?: string; folderLeft?: string } {
  if (!isAgentWorktree(w.path, mainRoot)) throw new Error(`refusing to remove ${w.path}: not an agent worktree`);
  return removeLinkedWorktree(w, mainRoot, target);
}

/**
 * removeWorktree for any worktree but the main checkout (worktrees:prune decides which).
 * The folder removal retries while Windows briefly locks node_modules; a folder still
 * there afterwards is returned as folderLeft, with why.
 */
export function removeLinkedWorktree(w: Worktree, mainRoot: string, target = "main"): { branchKept?: string; folderLeft?: string } {
  if (samePath(w.path, mainRoot)) throw new Error(`refusing to remove ${w.path}: the main checkout`);
  if (w.locked !== undefined) git(["worktree", "unlock", w.path], mainRoot);
  try {
    git(["worktree", "remove", "--force", w.path], mainRoot);
  } catch (error) {
    // "Directory not empty" leaves the worktree deregistered and its folder behind; any other failure leaves it listed.
    if (listWorktrees(mainRoot).some((x) => samePath(x.path, w.path))) throw error;
  }
  let folderLeft: string | undefined;
  try {
    if (existsSync(w.path)) rmSync(w.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    folderLeft = (error as { code?: string }).code ?? String(error);
  }
  const left = folderLeft ? { folderLeft } : {};
  const created = `worktree-${basename(normalPath(w.path))}`;
  if (created !== w.branch && refExists(created, mainRoot) && inTarget(created, target, mainRoot)) git(["branch", "-D", created], mainRoot);
  if (!w.branch) return left;
  if (!inTarget(w.branch, target, mainRoot)) return { ...left, branchKept: `${w.branch} has commits ${target} does not` };
  git(["branch", "-D", w.branch], mainRoot);
  return left;
}

/**
 * Every local branch: whether its tip is in the target (merge-base --is-ancestor; not
 * `git branch -d`, which checks against the current HEAD), whether its reflog shows a
 * commit of its own, and whether its upstream is gone (after `git fetch --prune`).
 */
export function localBranches(target: string, cwd: string): { branch: string; inMain: boolean; ownCommit: boolean; upstreamGone: boolean }[] {
  return git(["for-each-ref", "--format=%(refname)%09%(upstream:track)", "refs/heads/"], cwd)
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => {
      const [ref = "", track = ""] = line.split("\t");
      const branch = ref.replace(/^refs\/heads\//, "");
      return { branch, inMain: inTarget(branch, target, cwd), ownCommit: hasOwnCommit(reflogSubjects(ref, cwd)), upstreamGone: track === "[gone]" };
    });
}

/** Commits of head that no origin branch has. */
export const unpushedCount = (head: string, cwd: string): number => Number(git(["rev-list", "--count", head, "--not", "--remotes=origin"], cwd).trim());

/** Deletes a branch whose commits are all in the target (the caller checked). */
export const deleteBranch = (branch: string, cwd: string) => git(["branch", "-D", branch], cwd);

/** `git fetch --prune origin`. */
export const fetchPrune = (cwd: string) => git(["fetch", "--prune", "origin"], cwd);

/** Whether every commit of the branch is in the target. */
export function inTarget(branch: string, target: string, cwd: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, target], cwd);
    return true;
  } catch {
    return false;
  }
}

export function pruneWorktrees(mainRoot: string): void {
  git(["worktree", "prune"], mainRoot);
}
