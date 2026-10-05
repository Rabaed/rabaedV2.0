import { describe, expect, it } from "vitest";
import { chooseWorktrees, isAgentWorktree, parseWorktrees, type WorktreeFacts } from "./worktrees.ts";

const main = "G:/Rabaed Contech";
const here = `${main}/.claude/worktrees/agent-current`;

const wt = (name: string, w: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  path: `${main}/.claude/worktrees/${name}`,
  head: "abc123",
  branch: `worktree-${name}`,
  locked: undefined,
  ahead: 0,
  dirty: false,
  ...w,
});

describe("parseWorktrees", () => {
  it("reads path, head, branch and lock reason", () => {
    const out = [
      `worktree ${main}\nHEAD aaa\nbranch refs/heads/main`,
      `worktree ${main}/.claude/worktrees/agent-1\nHEAD bbb\nbranch refs/heads/RP-320-x\nlocked claude agent agent-1 (pid 31260)`,
      `worktree ${main}/.claude/worktrees/agent-2\nHEAD ccc\ndetached\nlocked`,
      `worktree ${main}/.claude/worktrees/agent-3\nHEAD ddd\ndetached\nprunable gitdir file points to non-existent location`,
      "",
    ].join("\r\n\r\n");
    expect(parseWorktrees(out)).toEqual([
      { path: main, head: "aaa", branch: "main", locked: undefined },
      { path: `${main}/.claude/worktrees/agent-1`, head: "bbb", branch: "RP-320-x", locked: "claude agent agent-1 (pid 31260)" },
      { path: `${main}/.claude/worktrees/agent-2`, head: "ccc", branch: undefined, locked: "" },
      { path: `${main}/.claude/worktrees/agent-3`, head: "ddd", branch: undefined, locked: undefined },
    ]);
  });
});

describe("isAgentWorktree", () => {
  it("accepts agent-* folders directly under .claude/worktrees of the main folder", () => {
    expect(isAgentWorktree(`${main}/.claude/worktrees/agent-a1b2`, main)).toBe(true);
    expect(isAgentWorktree("g:\\rabaed contech\\.claude\\worktrees\\agent-a1b2", main, "win32")).toBe(true);
  });

  it("rejects the main folder, named worktrees, nested folders and other roots", () => {
    expect(isAgentWorktree(main, main)).toBe(false);
    expect(isAgentWorktree(`${main}/.claude/worktrees/RP-299-form-part-3`, main)).toBe(false);
    expect(isAgentWorktree(`${main}/.claude/worktrees/agent-a/packages/x`, main)).toBe(false);
    expect(isAgentWorktree(`${main}/.claude/worktrees/agent-`, main)).toBe(false);
    expect(isAgentWorktree("G:/other/.claude/worktrees/agent-a", main)).toBe(false);
  });
});

describe("chooseWorktrees", () => {
  const choose = (worktrees: WorktreeFacts[]) => chooseWorktrees({ worktrees, currentPath: here, platform: "linux" });

  it("removes merged and clean worktrees, with a branch or a detached HEAD", () => {
    const { remove, skipped } = choose([wt("agent-a"), wt("agent-b", { branch: undefined })]);
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-a`, `${main}/.claude/worktrees/agent-b`]);
    expect(skipped).toEqual([]);
  });

  it("skips and names a worktree with uncommitted changes", () => {
    const { remove, skipped } = choose([wt("agent-a", { dirty: true })]);
    expect(remove).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ reason: "uncommitted changes", worktree: { path: `${main}/.claude/worktrees/agent-a` } });
  });

  it("skips a worktree with unmerged commits, saying how many and where", () => {
    const { remove, skipped } = choose([wt("agent-a", { ahead: 1 }), wt("agent-b", { ahead: 3, branch: undefined })]);
    expect(remove).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["1 unmerged commit on worktree-agent-a", "3 unmerged commits (detached HEAD)"]);
  });

  it("puts uncommitted changes before unmerged commits as the reason", () => {
    expect(choose([wt("agent-a", { dirty: true, ahead: 2 })]).skipped[0]?.reason).toBe("uncommitted changes");
  });

  it("removes worktrees the app locked, but not ones locked by hand", () => {
    const { remove, skipped } = choose([
      wt("agent-a", { locked: "claude agent agent-a (pid 31260)" }),
      wt("agent-b", { locked: "keep, mid-review" }),
      wt("agent-c", { locked: "" }),
    ]);
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-a`]);
    expect(skipped.map((s) => s.reason)).toEqual(["locked by hand (keep, mid-review)", "locked by hand (no reason)"]);
  });

  it("never removes the current worktree", () => {
    const { remove, skipped } = choose([wt("agent-current")]);
    expect(remove).toEqual([]);
    expect(skipped[0]?.reason).toBe("this is the current worktree");
  });

  it("compares the current path ignoring case and slashes on Windows", () => {
    const { remove } = chooseWorktrees({ worktrees: [wt("agent-current")], currentPath: "g:\\rabaed contech\\.claude\\worktrees\\AGENT-CURRENT\\", platform: "win32" });
    expect(remove).toEqual([]);
  });

  it("returns the worktrees without the facts used to choose", () => {
    expect(choose([wt("agent-a")]).remove[0]).toEqual({ path: `${main}/.claude/worktrees/agent-a`, head: "abc123", branch: "worktree-agent-a", locked: undefined });
  });
});
