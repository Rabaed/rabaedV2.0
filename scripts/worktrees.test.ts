import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { samePath } from "./paths.ts";
import {
  branchMerged,
  chooseWorktrees,
  gatherFacts,
  hasOwnCommit,
  isAgentWorktree,
  listWorktrees,
  localBranches,
  parseWorktrees,
  refExists,
  removeLinkedWorktree,
  removeWorktree,
  unpushedCount,
  type WorktreeFacts,
} from "./worktrees.ts";

const main = "G:/Rabaed Contech";
const here = `${main}/.claude/worktrees/agent-current`;

const wt = (name: string, w: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
  path: `${main}/.claude/worktrees/${name}`,
  head: "abc123",
  branch: `worktree-${name}`,
  locked: undefined,
  ahead: 0,
  dirty: false,
  noCommitsYet: false,
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

  it("skips a worktree with no commits yet, whose subagent may still be running, even when the app locked it", () => {
    const { remove, skipped } = choose([wt("agent-a", { noCommitsYet: true, locked: "claude agent agent-a (pid 31260)" })]);
    expect(remove).toEqual([]);
    expect(skipped[0]?.reason).toBe("no commits yet, may still be running (--include-empty removes it)");
  });

  it("removes a worktree with no commits yet when asked to (--include-empty)", () => {
    const { remove } = chooseWorktrees({ worktrees: [wt("agent-a", { noCommitsYet: true })], currentPath: here, includeEmpty: true, platform: "linux" });
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-a`]);
  });

  it("still keeps uncommitted changes and unmerged commits with --include-empty", () => {
    const { remove } = chooseWorktrees({
      worktrees: [wt("agent-a", { noCommitsYet: true, dirty: true }), wt("agent-b", { noCommitsYet: true, ahead: 1 })],
      currentPath: here,
      includeEmpty: true,
      platform: "linux",
    });
    expect(remove).toEqual([]);
  });

  it("returns the worktrees without the facts used to choose", () => {
    expect(choose([wt("agent-a")]).remove[0]).toEqual({ path: `${main}/.claude/worktrees/agent-a`, head: "abc123", branch: "worktree-agent-a", locked: undefined });
  });
});

describe("hasOwnCommit", () => {
  it("is false while the branch was only created, renamed, reset or fast-forwarded", () => {
    expect(hasOwnCommit([])).toBe(false);
    expect(hasOwnCommit(["branch: Created from HEAD"])).toBe(false);
    expect(
      hasOwnCommit([
        "merge RP-319-retro-environment: Fast-forward",
        "Branch: renamed refs/heads/worktree-agent-a to refs/heads/RP-319-review-fixes",
        "reset: moving to RP-319-retro-environment",
        "branch: Created from origin/main",
      ]),
    ).toBe(false);
  });

  it("is true once a commit was made on the branch, even if it was reset away later", () => {
    expect(hasOwnCommit(["commit: RP-320 Screenshot verdict", "branch: Created from HEAD"])).toBe(true);
    expect(hasOwnCommit(["reset: moving to HEAD~1", "commit (amend): RP-320 x", "branch: Created from HEAD"])).toBe(true);
    expect(hasOwnCommit(["commit (merge): Merge main"])).toBe(true);
    expect(hasOwnCommit(["merge main: Merge made by the 'ort' strategy."])).toBe(true);
    expect(hasOwnCommit(["cherry-pick: RP-1 x"])).toBe(true);
    expect(hasOwnCommit(["pull: Merge made by the 'ort' strategy."])).toBe(true);
  });

  it("counts a subject it does not know as no commit, so the worktree is kept", () => {
    expect(hasOwnCommit(["something new: moved"])).toBe(false);
  });
});

// The git side, in a throwaway repository under the system temp folder.
describe("gatherFacts and removeWorktree in a throwaway repository", () => {
  let root = "";
  const run = (args: string[], cwd = root) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const agent = (name: string) => join(root, ".claude", "worktrees", name);
  const listed = (name: string) => listWorktrees(root).find((w) => w.path.endsWith(`/${name}`) || w.path.endsWith(`\\${name}`))!;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rabaed-worktrees-")));
    run(["init", "-b", "main"]);
    writeFileSync(join(root, "a.txt"), "a");
    run(["add", "a.txt"]);
    run(["commit", "-m", "first"]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  it("marks a new worktree, and one only reset onto another branch, as having no commits yet", () => {
    run(["worktree", "add", "-b", "worktree-agent-new", agent("agent-new")]);
    run(["branch", "integration"]);
    run(["worktree", "add", "-b", "worktree-agent-reset", agent("agent-reset")]);
    run(["reset", "--hard", "integration"], agent("agent-reset"));
    run(["branch", "-m", "RP-1-reset"], agent("agent-reset"));
    const facts = gatherFacts([listed("agent-new"), listed("agent-reset")], "main", root);
    expect(facts.map((f) => [f.ahead, f.dirty, f.noCommitsYet])).toEqual([
      [0, false, true],
      [0, false, true],
    ]);
  });

  it("sees a commit, and keeps it seen once merged", () => {
    run(["worktree", "add", "-b", "worktree-agent-done", agent("agent-done")]);
    writeFileSync(join(agent("agent-done"), "b.txt"), "b");
    run(["add", "b.txt"], agent("agent-done"));
    run(["commit", "-m", "work"], agent("agent-done"));
    expect(gatherFacts([listed("agent-done")], "main", root)[0]).toMatchObject({ ahead: 1, noCommitsYet: false });
    run(["merge", "--no-ff", "-m", "merge", "worktree-agent-done"]);
    expect(gatherFacts([listed("agent-done")], "main", root)[0]).toMatchObject({ ahead: 0, noCommitsYet: false });
  });

  it("deletes a merged branch with the worktree, and keeps one git says is not merged", () => {
    for (const name of ["agent-merged", "agent-unmerged"]) {
      run(["worktree", "add", "-b", `worktree-${name}`, agent(name)]);
      writeFileSync(join(agent(name), `${name}.txt`), name);
      run(["add", `${name}.txt`], agent(name));
      run(["commit", "-m", name], agent(name));
    }
    run(["merge", "--no-ff", "-m", "merge", "worktree-agent-merged"]);

    expect(removeWorktree(listed("agent-merged"), root)).toEqual({});
    expect(refExists("worktree-agent-merged", root)).toBe(false);

    const { branchKept } = removeWorktree(listed("agent-unmerged"), root);
    expect(branchKept).toMatch(/has commits main does not/);
    expect(refExists("worktree-agent-unmerged", root)).toBe(true);
    expect(existsSync(agent("agent-unmerged"))).toBe(false);
  });

  it("deletes branches merged into the target branch although main is checked out, and keeps one with commits the target lacks", () => {
    run(["branch", "integration"]);
    for (const name of ["agent-in", "agent-out"]) {
      run(["worktree", "add", "-b", `RP-9-${name}`, agent(name), "integration"]);
      writeFileSync(join(agent(name), `${name}.txt`), name);
      run(["add", `${name}.txt`], agent(name));
      run(["commit", "-m", name], agent(name));
    }
    // Merge it into integration through a throwaway worktree, since main holds the root checkout.
    run(["worktree", "add", join(root, "int"), "integration"]);
    run(["merge", "--no-ff", "-m", "merge", "RP-9-agent-in"], join(root, "int"));

    expect(removeWorktree(listed("agent-in"), root, "integration")).toEqual({});
    expect(refExists("RP-9-agent-in", root)).toBe(false);

    const { branchKept } = removeWorktree(listed("agent-out"), root, "integration");
    expect(branchKept).toMatch(/RP-9-agent-out/);
    expect(refExists("RP-9-agent-out", root)).toBe(true);
  });

  it("also deletes the worktree-agent-* branch the worktree was created on, once it is in the target", () => {
    run(["worktree", "add", "-b", "worktree-agent-renamed", agent("agent-renamed")]);
    run(["checkout", "-b", "RP-10-renamed"], agent("agent-renamed"));
    expect(removeWorktree(listed("agent-renamed"), root, "main")).toEqual({});
    expect(refExists("RP-10-renamed", root)).toBe(false);
    expect(refExists("worktree-agent-renamed", root)).toBe(false);
  });

  it("calls a branch merged only once it has a commit of its own that the target has", () => {
    run(["worktree", "add", "-b", "RP-2-fresh", agent("agent-fresh")]);
    run(["worktree", "add", "-b", "RP-3-done", agent("agent-done")]);
    expect(branchMerged("RP-2-fresh", "main", root)).toBe(false);
    writeFileSync(join(agent("agent-done"), "c.txt"), "c");
    run(["add", "c.txt"], agent("agent-done"));
    run(["commit", "-m", "work"], agent("agent-done"));
    expect(branchMerged("RP-3-done", "main", root)).toBe(false);
    run(["merge", "--no-ff", "-m", "merge", "RP-3-done"]);
    expect(branchMerged("RP-3-done", "main", root)).toBe(true);
  });
});

// worktrees:prune's git side: a clone (its folder name has a space) of a throwaway origin.
describe("localBranches, unpushedCount and removeLinkedWorktree with an origin", () => {
  let tmp = "";
  let clone = "";
  const run = (args: string[], cwd = clone) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const commit = (cwd: string, file: string) => {
    writeFileSync(join(cwd, file), file);
    run(["add", file], cwd);
    run(["commit", "-m", file], cwd);
  };
  const listed = (dir: string) => listWorktrees(clone).find((w) => samePath(w.path, dir))!;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "rabaed-prune-")));
    run(["init", "--bare", "-b", "main", "origin.git"], tmp);
    clone = join(tmp, "my clone");
    run(["clone", join(tmp, "origin.git"), clone], tmp);
    commit(clone, "a.txt");
    run(["push", "origin", "main"]);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  it("says which branches are in origin/main, had a commit, or lost their upstream", () => {
    run(["checkout", "-b", "RP-1-merged"]);
    commit(clone, "b.txt");
    run(["push", "-u", "origin", "RP-1-merged"]);
    run(["checkout", "main"]);
    run(["merge", "--no-ff", "-m", "merge", "RP-1-merged"]);
    run(["push", "origin", "main"]);
    run(["push", "origin", "--delete", "RP-1-merged"]);
    run(["branch", "RP-2-created"]);
    run(["checkout", "-b", "RP-3-open"]);
    commit(clone, "c.txt");
    run(["checkout", "main"]);
    run(["fetch", "--prune", "origin"]);

    expect(localBranches("origin/main", clone)).toEqual([
      { branch: "RP-1-merged", inMain: true, ownCommit: true, upstreamGone: true },
      { branch: "RP-2-created", inMain: true, ownCommit: false, upstreamGone: false },
      { branch: "RP-3-open", inMain: false, ownCommit: true, upstreamGone: false },
      { branch: "main", inMain: true, ownCommit: true, upstreamGone: false },
    ]);
  });

  it("counts the commits of a HEAD that no origin branch has", () => {
    run(["checkout", "-b", "RP-4-work"]);
    commit(clone, "d.txt");
    commit(clone, "e.txt");
    const head = run(["rev-parse", "HEAD"]).trim();
    expect(unpushedCount(head, clone)).toBe(2);
    run(["push", "origin", "RP-4-work"]);
    expect(unpushedCount(head, clone)).toBe(0);
  });

  it("removes a worktree outside .claude/worktrees with its folder and merged branch, and refuses the main checkout", () => {
    const dir = join(tmp, "RP 5 done");
    run(["worktree", "add", "-b", "RP-5-done", dir]);
    commit(dir, "f.txt");
    run(["merge", "--no-ff", "-m", "merge", "RP-5-done"]);
    run(["push", "origin", "main"]);
    run(["fetch", "origin"]);

    expect(() => removeWorktree(listed(dir), clone, "origin/main")).toThrow(/not an agent worktree/);
    expect(removeLinkedWorktree(listed(dir), clone, "origin/main")).toEqual({});
    expect(existsSync(dir)).toBe(false);
    expect(refExists("RP-5-done", clone)).toBe(false);
    expect(() => removeLinkedWorktree(listed(clone), clone, "origin/main")).toThrow(/main checkout/);
  });
});
