import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { normalPath, samePath } from "./paths.ts";
import { otherLiveSession, readCommandLines, readProcessList, sessionPidOf, type ProcessList } from "./session-lock.ts";
import { lockPid } from "./worktrees-stale.ts";

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

/** What git and the disk say about one worktree (agent worktrees for worktrees:clean, any for worktrees:prune). */
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
  /**
   * Its lock names a running Claude session or agent, or names no pid at all (Liveness.lockLive).
   * Looked up only while it has no commits yet and nothing ahead; false otherwise.
   */
  lockLive: boolean;
  /** A running process holds its folder, such as its dev server (Liveness.heldByProcess). Looked up as lockLive is. */
  heldByProcess: boolean;
};

/** The running sessions and processes a worktree with no commits yet is checked against (RP-585); injected so tests need none. */
export type Liveness = {
  /** Whether the lock reason names a running Claude session or agent, or names no pid (a lock by hand). */
  lockLive: (locked: string | undefined) => boolean;
  /** Whether a running process's command line names a file in the folder. */
  heldByProcess: (path: string) => boolean;
};

/**
 * Why a worktree whose branch has had no commit of its own may still be starting
 * (its session or subagent may be about to write code); undefined when it has had one,
 * or when nothing holds it: clean, no live lock, and no running process in its folder.
 */
export function stillStarting(f: Pick<WorktreeFacts, "noCommitsYet" | "dirty" | "lockLive" | "heldByProcess">): string | undefined {
  if (!f.noCommitsYet) return undefined;
  if (f.dirty) return "uncommitted changes";
  if (f.lockLive) return "locked by a running session";
  if (f.heldByProcess) return "a running process holds its folder";
  return undefined;
}

/**
 * The one "finished worktree" rule (RP-585) of lane:env, lanes:prune, worktrees:clean and
 * worktrees:prune: its tip is in the target (nothing ahead), and either its branch has had a
 * commit of its own, or it has none and nothing holds it (stillStarting). A branch created on
 * an already merged commit and never committed to is then finished once its session is gone.
 */
export const isFinished = (f: Pick<WorktreeFacts, "ahead" | "noCommitsYet" | "dirty" | "lockLive" | "heldByProcess">): boolean =>
  f.ahead === 0 && stillStarting(f) === undefined;

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

/** The skip reason for the worktree the script runs from (worktrees:clean and worktrees:prune leave it unlisted). */
export const CURRENT_WORKTREE = "this is the current worktree";

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
  /** Folder names (agent-*) to limit the run to (--only); they count as includeEmpty, the rest are left out of the run. */
  only?: string[];
  platform?: NodeJS.Platform;
};

/** The last segment of a worktree path. */
export const worktreeName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";

/** Whether the worktree's folder name is one of `names`; case-insensitive on Windows, like paths. */
export const isNamed = (path: string, names: string[], platform?: NodeJS.Platform): boolean =>
  names.some((n) => normalPath(n, platform) === normalPath(worktreeName(path), platform));

/**
 * Which agent worktrees to remove: the finished ones (isFinished: commits all in the
 * target branch, a merged branch or a detached HEAD with no unique commits, and either
 * a commit of its own or nothing holding it), that have no uncommitted changes; with
 * includeEmpty also those with no commits yet that something still holds, unless they
 * have uncommitted changes. Everything else is skipped with its reason.
 * The caller passes agent worktrees only.
 */
export function chooseWorktrees({ worktrees, currentPath, includeEmpty = false, only, platform }: ChooseInput): { remove: Worktree[]; skipped: Skipped[] } {
  const remove: Worktree[] = [];
  const skipped: Skipped[] = [];
  const keepEmpty = includeEmpty || only !== undefined;
  for (const { ahead, dirty, noCommitsYet, lockLive, heldByProcess, ...w } of worktrees) {
    if (only && !isNamed(w.path, only, platform)) continue;
    const starting = stillStarting({ noCommitsYet, dirty, lockLive, heldByProcess });
    const reason = samePath(w.path, currentPath, platform)
      ? CURRENT_WORKTREE
      : dirty
        ? "uncommitted changes"
        : ahead > 0
          ? `${ahead} unmerged commit${ahead === 1 ? "" : "s"}${w.branch ? ` on ${w.branch}` : " (detached HEAD)"}`
          : starting && !keepEmpty
            ? `no commits yet, may still be running (${starting}; --include-empty removes it)`
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

/**
 * Whether the folder has uncommitted changes, untracked files outside ignored paths included.
 * A root .pnpm-store/ never counts: pnpm makes one when a sandboxed agent can't write to the
 * drive root's store, and a branch from before RP-549 does not ignore it yet.
 */
export const gitDirty = (dir: string): boolean =>
  git(["--no-optional-locks", "status", "--porcelain", "--", ":(top)", ":(top,exclude).pnpm-store"], dir).trim() !== "";

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

/**
 * Looks each worktree up: its commits the target lacks, whether it has uncommitted changes,
 * whether it has had a commit of its own, and, when it has none and nothing is ahead, whether
 * a live lock or a running process holds it.
 */
export function gatherFacts(worktrees: Worktree[], target: string, mainRoot: string, live: Liveness): WorktreeFacts[] {
  return worktrees.map((w) => worktreeFacts(w, target, mainRoot, live));
}

function worktreeFacts(w: Worktree, target: string, mainRoot: string, live: Liveness): WorktreeFacts {
  // A folder deleted by hand is still listed; it has nothing uncommitted, and no subagent runs in it.
  const exists = existsSync(w.path);
  const dirty = exists && gitDirty(w.path);
  const ahead = Number(git(["rev-list", "--count", `${target}..${w.head}`], mainRoot).trim());
  // A branch's reflog is shared by every worktree; a detached HEAD's is the worktree's own.
  const subjects = w.branch ? reflogSubjects(`refs/heads/${w.branch}`, mainRoot) : exists ? reflogSubjects("HEAD", w.path) : [];
  const noCommitsYet = exists && !hasOwnCommit(subjects);
  const mayBeStarting = ahead === 0 && noCommitsYet;
  return { ...w, ahead, dirty, noCommitsYet, lockLive: mayBeStarting && live.lockLive(w.locked), heldByProcess: mayBeStarting && live.heldByProcess(w.path) };
}

/** judgeWorktree's answer. neverCommitted: finished although its branch has had no commit of its own. */
export type Verdict = { finished: boolean; neverCommitted: boolean };

export const NOT_FINISHED: Verdict = { finished: false, neverCommitted: false };

/**
 * isFinished for one worktree against the target (lane:env and lanes:prune; worktrees:clean
 * and worktrees:prune judge gatherFacts' facts by the same rule). A detached HEAD is judged
 * too (RP-601): the app often leaves a worktree detached once its branch merges, and its HEAD
 * reflog holds checkouts, not commits, so it is finished once its commit is in the target and
 * nothing holds it. neverCommitted: finished
 * although its branch has had no commit of its own. A worktree git cannot read is not finished.
 */
export function judgeWorktree(w: Worktree, target: string, mainRoot: string, live: Liveness): Verdict {
  let facts: WorktreeFacts;
  try {
    facts = worktreeFacts(w, target, mainRoot, live);
  } catch {
    return NOT_FINISHED;
  }
  const finished = isFinished(facts);
  // A detached HEAD's reflog holds checkouts, so "never committed to" would mislead there.
  return { finished, neverCommitted: finished && facts.noCommitsYet && w.branch !== undefined };
}

/**
 * The real Liveness: the process list is read once, on first need. A lock is live when it names
 * another running Claude session (session-lock.ts otherLiveSession): the app locks a subagent's
 * worktree with its parent's pid, so this session's own paused subagents do not count. When the
 * processes cannot be read, every lock with a pid and every folder counts as held, so nothing with
 * no commits yet is finished.
 */
export function systemLiveness(platform: NodeJS.Platform = process.platform): Liveness & { pidLive: (pid: number) => boolean } {
  let processes: ProcessList | null | undefined;
  let commandLines: string[] | null | undefined;
  const read = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  /** Whether the pid is another live Claude session (true when the processes cannot be read). */
  const pidLive = (pid: number): boolean => {
    if (processes === undefined) processes = read(readProcessList);
    return processes === null || otherLiveSession(pid, process.pid, processes, sessionPidOf(process.env));
  };
  return {
    pidLive,
    lockLive: (locked) => {
      if (locked === undefined) return false;
      const pid = lockPid(locked);
      return pid === undefined || pidLive(pid);
    },
    heldByProcess: (path) => {
      if (commandLines === undefined) commandLines = read(readCommandLines);
      return commandLines === null || commandLines.some((line) => commandLineHolds(line, path, platform));
    },
  };
}

/**
 * Whether a process command line names the folder or a file in it, e.g. the node of its
 * `pnpm dev`, "G:\...\agent-a\node_modules\...". The folder's name must end there, so
 * agent-a does not match agent-ab.
 */
export function commandLineHolds(commandLine: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const line = normalPath(commandLine, platform);
  const dir = normalPath(folder, platform);
  if (dir === "") return false;
  for (let at = line.indexOf(dir); at !== -1; at = line.indexOf(dir, at + 1)) {
    const next = line[at + dir.length];
    if (next === undefined || /[/"'\s]/.test(next)) return true;
  }
  return false;
}

/**
 * Unlocks, removes and deletes one worktree: its folder (git leaves it behind on
 * Windows when node_modules is in it) and its branch. The branch is deleted with
 * `git branch -D` when it is an ancestor of the target branch; `git branch -d` would
 * check against the main folder's HEAD, not the target. The `worktree-agent-*` branch
 * the app created the worktree on (named after its folder) goes too when it is in the
 * target. Returns the branches kept, each with why.
 */
export function removeWorktree(w: Worktree, mainRoot: string, target: string): Removal {
  if (!isAgentWorktree(w.path, mainRoot)) throw new Error(`refusing to remove ${w.path}: not an agent worktree`);
  return removeLinkedWorktree(w, mainRoot, target);
}

/** What removeWorktree left: branches it kept, and why its folder is still there. Empty when it removed everything. */
export type Removal = { branchesKept?: { branch: string; reason: string }[]; folderLeft?: string };

/**
 * removeWorktree for any worktree but the main checkout (worktrees:prune decides which).
 * The folder removal retries while Windows briefly locks node_modules; a folder still
 * there afterwards is returned as folderLeft, with why. Once the worktree is removed,
 * a branch git will not delete is kept and named, not thrown.
 */
export function removeLinkedWorktree(w: Worktree, mainRoot: string, target: string): Removal {
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
  const branchesKept: { branch: string; reason: string }[] = [];
  const deleteIfInTarget = (branch: string) => {
    if (!inTarget(branch, target, mainRoot)) {
      branchesKept.push({ branch, reason: `${branch} has commits ${target} does not` });
      return;
    }
    try {
      git(["branch", "-D", branch], mainRoot);
    } catch (error) {
      branchesKept.push({ branch, reason: gitError(error) });
    }
  };
  const createdBranch = `worktree-${basename(w.path)}`;
  if (createdBranch !== w.branch && refExists(createdBranch, mainRoot)) deleteIfInTarget(createdBranch);
  if (w.branch) deleteIfInTarget(w.branch);
  return { ...(branchesKept.length > 0 ? { branchesKept } : {}), ...(folderLeft ? { folderLeft } : {}) };
}

/**
 * Prints what removeWorktree did with one worktree. Returns whether it failed: its
 * folder is still there.
 */
export function reportRemoval(path: string, { branchesKept = [], folderLeft }: Removal): boolean {
  if (folderLeft) console.error(`Removed ${path} from git, but could not delete its folder (${folderLeft}); delete it by hand.`);
  else console.log(`Removed ${path}.`);
  for (const { branch, reason } of branchesKept) console.log(`  Kept branch ${branch}: ${reason}`);
  return folderLeft !== undefined;
}

/** A local branch, as localBranches reads it. */
export type LocalBranch = {
  branch: string;
  /** Its tip is an ancestor of the target branch (merge-base --is-ancestor). */
  inTarget: boolean;
  /** Its reflog shows a commit made on it (hasOwnCommit). */
  ownCommit: boolean;
  /** Its upstream was deleted on origin (after `git fetch --prune`). */
  upstreamGone: boolean;
};

/**
 * Every local branch: whether its tip is in the target (merge-base --is-ancestor; not
 * `git branch -d`, which checks against the current HEAD), whether its reflog shows a
 * commit of its own, and whether its upstream is gone (after `git fetch --prune`).
 */
export function localBranches(target: string, cwd: string): LocalBranch[] {
  return git(["for-each-ref", "--format=%(refname)%09%(upstream:track)", "refs/heads/"], cwd)
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => {
      const [ref = "", track = ""] = line.split("\t");
      const branch = ref.replace(/^refs\/heads\//, "");
      return { branch, inTarget: inTarget(branch, target, cwd), ownCommit: hasOwnCommit(reflogSubjects(ref, cwd)), upstreamGone: track === "[gone]" };
    });
}

/** Commits of head that no origin branch has. */
export const unpushedCount = (head: string, cwd: string): number => Number(git(["rev-list", "--count", head, "--not", "--remotes=origin"], cwd).trim());

/** Deletes a branch whose commits are all in the target (the caller checked). */
export const deleteBranch = (branch: string, cwd: string) => git(["branch", "-D", branch], cwd);

/** `git fetch --prune origin`. */
export const fetchPrune = (cwd: string) => git(["fetch", "--prune", "origin"], cwd);

/** Whether `ancestor` is an ancestor of `commit`, or the same commit (`git merge-base --is-ancestor`). */
export function isAncestor(ancestor: string, commit: string, cwd: string, spawn: typeof spawnSync = spawnSync): boolean {
  return spawn("git", ["merge-base", "--is-ancestor", ancestor, commit], { cwd, stdio: "ignore" }).status === 0;
}

/** Whether every commit of the branch is in the target. */
export const inTarget = (branch: string, target: string, cwd: string): boolean => isAncestor(`refs/heads/${branch}`, target, cwd);

export function pruneWorktrees(mainRoot: string): void {
  git(["worktree", "prune"], mainRoot);
}
