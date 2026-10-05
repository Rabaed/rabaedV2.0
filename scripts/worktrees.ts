import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

// Cleaning up the app-made agent worktrees `/implement-spec` leaves under
// .claude/worktrees/agent-* (RP-326, planning/parallel-sessions.md). On Windows
// `git worktree remove` deregisters a worktree but fails with "Directory not empty"
// when node_modules is left behind, so the folder is deleted here as well. Used by
// worktrees-clean.ts. The decision (chooseWorktrees) is pure; git and fs calls are below.

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
};

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

const slashed = (p: string, platform: NodeJS.Platform) => {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
};

/** Whether two paths name the same folder. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return a !== "" && b !== "" && slashed(a, platform) === slashed(b, platform);
}

/** Whether the path is `<mainRoot>/.claude/worktrees/agent-*`: the folders the app makes for subagents. */
export function isAgentWorktree(path: string, mainRoot: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = slashed(path, platform);
  const dir = `${slashed(mainRoot, platform)}/.claude/worktrees/`;
  return p.startsWith(dir) && /^agent-[^/]+$/.test(p.slice(dir.length));
}

/** The app locks the worktrees it makes for subagents with a reason starting "claude agent". */
export const lockedByApp = (reason: string) => /^claude agent\b/i.test(reason);

type ChooseInput = {
  worktrees: WorktreeFacts[];
  /** The worktree this runs from; it is never removed. */
  currentPath: string;
  platform?: NodeJS.Platform;
};

/**
 * Which agent worktrees to remove: those whose commits are all in the target
 * branch (a merged branch, or a detached HEAD with no unique commits) and that
 * have no uncommitted changes. Everything else is skipped with its reason.
 * The caller passes agent worktrees only.
 */
export function chooseWorktrees({ worktrees, currentPath, platform }: ChooseInput): { remove: Worktree[]; skipped: Skipped[] } {
  const remove: Worktree[] = [];
  const skipped: Skipped[] = [];
  for (const { ahead, dirty, ...w } of worktrees) {
    const reason = samePath(w.path, currentPath, platform)
      ? "this is the current worktree"
      : dirty
        ? "uncommitted changes"
        : ahead > 0
          ? `${ahead} unmerged commit${ahead === 1 ? "" : "s"}${w.branch ? ` on ${w.branch}` : " (detached HEAD)"}`
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

/** Looks each worktree up: its commits the target lacks, and whether it has uncommitted changes. */
export function gatherFacts(worktrees: Worktree[], target: string, mainRoot: string): WorktreeFacts[] {
  return worktrees.map((w) => {
    // A folder deleted by hand is still listed; it has nothing uncommitted.
    const dirty = existsSync(w.path) && git(["status", "--porcelain"], w.path).trim() !== "";
    const ahead = Number(git(["rev-list", "--count", `${target}..${w.head}`], mainRoot).trim());
    return { ...w, ahead, dirty };
  });
}

/**
 * Unlocks, removes and deletes one worktree: its folder (git leaves it behind on
 * Windows when node_modules is in it) and its branch, which the caller found merged.
 */
export function removeWorktree(w: Worktree, mainRoot: string): void {
  if (!isAgentWorktree(w.path, mainRoot)) throw new Error(`refusing to remove ${w.path}: not an agent worktree`);
  if (w.locked !== undefined) git(["worktree", "unlock", w.path], mainRoot);
  try {
    git(["worktree", "remove", "--force", w.path], mainRoot);
  } catch (error) {
    // "Directory not empty" leaves the worktree deregistered and its folder behind; any other failure leaves it listed.
    if (listWorktrees(mainRoot).some((x) => samePath(x.path, w.path))) throw error;
  }
  if (existsSync(w.path)) rmSync(w.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (w.branch) git(["branch", "-D", w.branch], mainRoot);
}

export function pruneWorktrees(mainRoot: string): void {
  git(["worktree", "prune"], mainRoot);
}
