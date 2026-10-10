import { execFileSync } from "node:child_process";
import { samePath } from "./paths.ts";
import { listWorktrees, type Worktree } from "./worktrees.ts";

// Used by lane-env.ts (RP-499): warns when another branch or worktree already works the
// ticket this worktree's branch is named for, so two sessions do not build the same ticket.
// A warning, not a refusal: --db subagents and a spec's integration branch share a key legitimately.

/** What claimWarnings asks git; injected in tests. */
export type ClaimGit = {
  worktrees: () => Worktree[];
  /** Local branch names. */
  localBranches: () => string[];
  /** origin branch names without the `origin/` prefix. */
  remoteBranches: () => string[];
};

/** The `RP-nnn` a branch name starts with (`RP-451-x` or `RP-451`), or undefined. */
export const branchKey = (branch: string | undefined): string | undefined => branch?.match(/^(RP-\d+)(?:-|$)/)?.[1];

/** One warning line per other branch (local, in a worktree, or on origin) that starts with this branch's key. */
export function claimWarnings(git: ClaimGit, currentPath: string, currentBranch: string | undefined): string[] {
  const key = branchKey(currentBranch);
  if (!key) return [];
  const same = (branch: string | undefined): branch is string => branch !== undefined && branchKey(branch) === key && branch !== currentBranch;
  const worktrees = git.worktrees().filter((w) => !samePath(w.path, currentPath));
  const local = git.localBranches();
  const remoteNames = git.remoteBranches();
  const names = new Set<string>();
  for (const b of [...local, ...worktrees.map((w) => w.branch), ...remoteNames]) if (same(b)) names.add(b);
  const remote = new Set(remoteNames);
  return [...names].sort().map((branch) => {
    const where = [
      ...worktrees.filter((w) => w.branch === branch).map((w) => `worktree ${w.path}`),
      ...(local.includes(branch) && !worktrees.some((w) => w.branch === branch) ? ["local branch"] : []),
      ...(remote.has(branch) ? [`origin/${branch}`] : []),
    ];
    return `${key} may already be claimed: ${branch} (${where.join(", ")}).`;
  });
}

const gitOut = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lines = (out: string) => out.split(/\r?\n/).filter((l) => l !== "");

/** The real git behind ClaimGit; a failing call (no origin, say) reads as no branches. */
const orEmpty = <T>(read: () => T[]): T[] => {
  try {
    return read();
  } catch {
    return [];
  }
};

export const realClaimGit: ClaimGit = {
  worktrees: () => orEmpty(listWorktrees),
  localBranches: () => orEmpty(() => lines(gitOut(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]))),
  remoteBranches: () =>
    orEmpty(() =>
      lines(gitOut(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"]))
        .filter((r) => r.startsWith("origin/"))
        .map((r) => r.slice("origin/".length)),
    ),
};

export const currentBranch = (): string | undefined => {
  try {
    return gitOut(["branch", "--show-current"]).trim() || undefined;
  } catch {
    return undefined;
  }
};
