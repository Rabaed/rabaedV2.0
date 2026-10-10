import { describe, expect, it } from "vitest";
import { claimWarnings, branchKey, type ClaimGit } from "./lane-claims.ts";

const here = "/repo/.claude/worktrees/agent-1";

const git = (g: Partial<ClaimGit>): ClaimGit => ({ worktrees: () => [], localBranches: () => [], remoteBranches: () => [], ...g });
const wt = (path: string, branch: string | undefined) => ({ path, head: "abc", branch, locked: undefined });

describe("branchKey", () => {
  it("reads the RP key from the front of a branch name", () => {
    expect(branchKey("RP-451-jira-close-skip-spec-2")).toBe("RP-451");
    expect(branchKey("RP-451")).toBe("RP-451");
  });

  it("is undefined for a branch with no key", () => {
    expect(branchKey("main")).toBeUndefined();
    expect(branchKey("worktree-agent-aab0")).toBeUndefined();
    expect(branchKey(undefined)).toBeUndefined();
  });
});

describe("claimWarnings", () => {
  it("names another worktree on a branch with the same key, with its path", () => {
    const warnings = claimWarnings(
      git({
        worktrees: () => [wt(here, "RP-451-x"), wt("/repo/.claude/worktrees/agent-2", "RP-451-y")],
        localBranches: () => ["RP-451-x", "RP-451-y"],
      }),
      here,
      "RP-451-x",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RP-451-y");
    expect(warnings[0]).toContain("/repo/.claude/worktrees/agent-2");
  });

  it("does not match a key that is only a prefix of another number", () => {
    const warnings = claimWarnings(
      git({
        worktrees: () => [wt(here, "RP-45-x"), wt("/other", "RP-451-y")],
        localBranches: () => ["RP-45-x", "RP-451-y"],
        remoteBranches: () => ["RP-451-z"],
      }),
      here,
      "RP-45-x",
    );
    expect(warnings).toEqual([]);
  });

  it("ignores this worktree's own branch, locally and on origin", () => {
    const warnings = claimWarnings(
      git({ worktrees: () => [wt(here, "RP-451-x")], localBranches: () => ["RP-451-x"], remoteBranches: () => ["RP-451-x"] }),
      here,
      "RP-451-x",
    );
    expect(warnings).toEqual([]);
  });

  it("names a local branch that has no worktree, and an origin branch", () => {
    const warnings = claimWarnings(
      git({ localBranches: () => ["RP-451-x", "RP-451-old"], remoteBranches: () => ["RP-451-x", "RP-451-pushed", "RP-452-other"] }),
      here,
      "RP-451-x",
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("RP-451-old");
    expect(warnings.join("\n")).toContain("origin/RP-451-pushed");
    expect(warnings.join("\n")).not.toContain("RP-452");
  });

  it("lists a branch once when it is local, in a worktree and on origin", () => {
    const warnings = claimWarnings(
      git({
        worktrees: () => [wt(here, "RP-451-x"), wt("/w2", "RP-451-y")],
        localBranches: () => ["RP-451-x", "RP-451-y"],
        remoteBranches: () => ["RP-451-y"],
      }),
      here,
      "RP-451-x",
    );
    expect(warnings).toHaveLength(1);
  });

  it("is silent when the current branch has no key", () => {
    expect(claimWarnings(git({ localBranches: () => ["RP-451-y"] }), here, "main")).toEqual([]);
  });
});
