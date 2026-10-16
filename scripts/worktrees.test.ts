import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { samePath } from "./paths.ts";
import { choosePrune } from "./worktrees-pruning.ts";
import {
  chooseWorktrees,
  commandLineHolds,
  gatherFacts,
  hasOwnCommit,
  isAgentWorktree,
  isFinished,
  judgeWorktree,
  listWorktrees,
  localBranches,
  parseWorktrees,
  refExists,
  removeLinkedWorktree,
  removeWorktree,
  stillStarting,
  systemLiveness,
  unpushedCount,
  type Liveness,
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
  lockLive: false,
  heldByProcess: false,
  ...w,
});

/** A Liveness that sees no running session or process. */
const nobody: Liveness = { lockLive: () => false, heldByProcess: () => false };

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

  it("skips a merged worktree a desktop session holds, found by its path whatever its branch (RP-608)", () => {
    const held = wt("agent-held", { branch: "RP-602-renamed" });
    const openSession = (path: string) => (path === held.path ? { kind: "open" as const, session: 'session "RP-602"' } : undefined);
    const { remove, skipped } = chooseWorktrees({ worktrees: [held, wt("agent-free")], currentPath: here, platform: "linux", openSession, only: ["agent-held", "agent-free"] });
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-free`]);
    expect(skipped.map((s) => s.reason)).toEqual(['its Claude desktop session is open (session "RP-602"); archive it first']);
  });

  it("skips every worktree when the desktop app's records cannot be read (RP-608)", () => {
    const openSession = () => ({ kind: "unknown" as const, reason: "Claude desktop's worktree list (x.json) could not be read" });
    const { remove, skipped } = chooseWorktrees({ worktrees: [wt("agent-a")], currentPath: here, platform: "linux", openSession });
    expect(remove).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["a Claude desktop session may hold it: Claude desktop's worktree list (x.json) could not be read"]);
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

  it("skips a worktree with no commits yet that a running session's lock or a running process holds", () => {
    const { remove, skipped } = choose([
      wt("agent-a", { noCommitsYet: true, locked: "claude agent agent-a (pid 31260)", lockLive: true }),
      wt("agent-b", { noCommitsYet: true, heldByProcess: true }),
    ]);
    expect(remove).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "no commits yet, may still be running (locked by a running session; --include-empty removes it)",
      "no commits yet, may still be running (a running process holds its folder; --include-empty removes it)",
    ]);
  });

  it("removes a worktree with no commits yet that nothing holds: it is finished (RP-585)", () => {
    const { remove } = choose([wt("agent-a", { noCommitsYet: true, locked: "claude agent agent-a (pid 31260)" })]);
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-a`]);
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

  it("with only, considers just the named worktrees: an empty named one goes, an empty unnamed one is left alone", () => {
    const { remove, skipped } = chooseWorktrees({
      worktrees: [wt("agent-a", { noCommitsYet: true }), wt("agent-b", { noCommitsYet: true }), wt("agent-c", { ahead: 2 })],
      currentPath: here,
      only: ["agent-a"],
      platform: "linux",
    });
    expect(remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-a`]);
    expect(skipped).toEqual([]);
  });

  it("with only, matches names case-insensitively on win32 and exactly elsewhere", () => {
    const input = { worktrees: [wt("agent-a", { noCommitsYet: true })], currentPath: here, only: ["Agent-A"] };
    expect(chooseWorktrees({ ...input, platform: "win32" }).remove).toHaveLength(1);
    expect(chooseWorktrees({ ...input, platform: "linux" }).remove).toEqual([]);
  });

  it("with only, still skips and names a named worktree holding changes or unmerged commits", () => {
    const { remove, skipped } = chooseWorktrees({
      worktrees: [wt("agent-a", { noCommitsYet: true, dirty: true }), wt("agent-b", { noCommitsYet: true, ahead: 1 })],
      currentPath: here,
      only: ["agent-a", "agent-b"],
      platform: "linux",
    });
    expect(remove).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["uncommitted changes", "1 unmerged commit on worktree-agent-b"]);
  });

  it("returns the worktrees without the facts used to choose", () => {
    expect(choose([wt("agent-a")]).remove[0]).toEqual({ path: `${main}/.claude/worktrees/agent-a`, head: "abc123", branch: "worktree-agent-a", locked: undefined });
  });
});

describe("isFinished and stillStarting (RP-585)", () => {
  const facts = (f: Partial<WorktreeFacts>) => ({ ahead: 0, noCommitsYet: false, dirty: false, lockLive: false, heldByProcess: false, ...f });

  it("is finished when nothing is ahead and the branch had a commit of its own, whatever holds it", () => {
    expect(isFinished(facts({}))).toBe(true);
    expect(isFinished(facts({ lockLive: true, heldByProcess: true }))).toBe(true);
    expect(isFinished(facts({ ahead: 1 }))).toBe(false);
  });

  it("is finished with no commits yet only when clean, with no live lock and no process holding it", () => {
    expect(isFinished(facts({ noCommitsYet: true }))).toBe(true);
    expect(stillStarting(facts({ noCommitsYet: true, dirty: true }))).toBe("uncommitted changes");
    expect(stillStarting(facts({ noCommitsYet: true, lockLive: true }))).toBe("locked by a running session");
    expect(stillStarting(facts({ noCommitsYet: true, heldByProcess: true }))).toBe("a running process holds its folder");
    expect(isFinished(facts({ noCommitsYet: true, heldByProcess: true }))).toBe(false);
  });
});

describe("commandLineHolds", () => {
  const dir = "G:\\Rabaed Contech\\.claude\\worktrees\\agent-a";

  it("sees a process running a file in the folder, ignoring case and slashes on Windows", () => {
    expect(commandLineHolds('"C:\\Program Files\\nodejs\\node.exe" "g:\\rabaed contech\\.claude\\worktrees\\AGENT-A\\node_modules\\next\\dist\\bin\\next" dev', dir, "win32")).toBe(true);
    expect(commandLineHolds(`node ${dir}`, dir, "win32")).toBe(true);
  });

  it("does not take a folder whose name only starts with it, or another folder", () => {
    expect(commandLineHolds("node G:\\Rabaed Contech\\.claude\\worktrees\\agent-ab\\x.js", dir, "win32")).toBe(false);
    expect(commandLineHolds("node G:\\Rabaed Contech\\scripts\\x.js", dir, "win32")).toBe(false);
    expect(commandLineHolds("node /w/Agent-A/x.js", "/w/agent-a", "linux")).toBe(false);
  });
});

describe("systemLiveness", () => {
  it("counts no lock as not live and a lock naming no pid (by hand) as live, without reading processes", () => {
    const live = systemLiveness();
    expect(live.lockLive(undefined)).toBe(false);
    expect(live.lockLive("keep, mid-review")).toBe(true);
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
    const facts = gatherFacts([listed("agent-new"), listed("agent-reset")], "main", root, nobody);
    expect(facts.map((f) => [f.ahead, f.dirty, f.noCommitsYet])).toEqual([
      [0, false, true],
      [0, false, true],
    ]);
  });

  it("counts an untracked file as uncommitted, but not a .pnpm-store/ the branch doesn't ignore (RP-549)", () => {
    run(["worktree", "add", "-b", "worktree-agent-store", agent("agent-store")]);
    mkdirSync(join(agent("agent-store"), ".pnpm-store", "v10"), { recursive: true });
    writeFileSync(join(agent("agent-store"), ".pnpm-store", "v10", "index"), "x");
    expect(gatherFacts([listed("agent-store")], "main", root, nobody)[0]!.dirty).toBe(false);
    writeFileSync(join(agent("agent-store"), "c.txt"), "c");
    expect(gatherFacts([listed("agent-store")], "main", root, nobody)[0]!.dirty).toBe(true);
  });

  it("sees a commit, and keeps it seen once merged", () => {
    run(["worktree", "add", "-b", "worktree-agent-done", agent("agent-done")]);
    writeFileSync(join(agent("agent-done"), "b.txt"), "b");
    run(["add", "b.txt"], agent("agent-done"));
    run(["commit", "-m", "work"], agent("agent-done"));
    expect(gatherFacts([listed("agent-done")], "main", root, nobody)[0]).toMatchObject({ ahead: 1, noCommitsYet: false });
    run(["merge", "--no-ff", "-m", "merge", "worktree-agent-done"]);
    expect(gatherFacts([listed("agent-done")], "main", root, nobody)[0]).toMatchObject({ ahead: 0, noCommitsYet: false });
  });

  it("deletes a merged branch with the worktree, and keeps one git says is not merged", () => {
    for (const name of ["agent-merged", "agent-unmerged"]) {
      run(["worktree", "add", "-b", `worktree-${name}`, agent(name)]);
      writeFileSync(join(agent(name), `${name}.txt`), name);
      run(["add", `${name}.txt`], agent(name));
      run(["commit", "-m", name], agent(name));
    }
    run(["merge", "--no-ff", "-m", "merge", "worktree-agent-merged"]);

    expect(removeWorktree(listed("agent-merged"), root, "main")).toEqual({});
    expect(refExists("worktree-agent-merged", root)).toBe(false);

    const { branchesKept } = removeWorktree(listed("agent-unmerged"), root, "main");
    expect(branchesKept).toEqual([{ branch: "worktree-agent-unmerged", reason: "worktree-agent-unmerged has commits main does not" }]);
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

    const { branchesKept } = removeWorktree(listed("agent-out"), root, "integration");
    expect(branchesKept?.map((b) => b.branch)).toEqual(["RP-9-agent-out"]);
    expect(refExists("RP-9-agent-out", root)).toBe(true);
  });

  it("also deletes the worktree-agent-* branch the worktree was created on, once it is in the target", () => {
    run(["worktree", "add", "-b", "worktree-agent-renamed", agent("agent-renamed")]);
    run(["checkout", "-b", "RP-10-renamed"], agent("agent-renamed"));
    expect(removeWorktree(listed("agent-renamed"), root, "main")).toEqual({});
    expect(refExists("RP-10-renamed", root)).toBe(false);
    expect(refExists("worktree-agent-renamed", root)).toBe(false);
  });

  it("finds the worktree-agent-* branch by its folder's own case, refs packed", () => {
    run(["worktree", "add", "-b", "worktree-agent-Mixed", agent("agent-Mixed")]);
    run(["checkout", "-b", "RP-11-mixed"], agent("agent-Mixed"));
    // Packed refs are matched case-sensitively, also on Windows.
    run(["pack-refs", "--all"]);
    expect(removeWorktree(listed("agent-Mixed"), root, "main")).toEqual({});
    expect(refExists("worktree-agent-Mixed", root)).toBe(false);
  });

  it("keeps, and names, a worktree-agent-* branch git will not delete, and still deletes the worktree's own branch", () => {
    run(["worktree", "add", "-b", "worktree-agent-held", agent("agent-held")]);
    run(["checkout", "-b", "RP-12-held"], agent("agent-held"));
    // Another worktree has the created branch checked out, so `git branch -D` refuses it.
    run(["worktree", "add", join(root, "other"), "worktree-agent-held"]);
    const { branchesKept, folderLeft } = removeWorktree(listed("agent-held"), root, "main");
    expect(folderLeft).toBeUndefined();
    expect(branchesKept?.map((b) => b.branch)).toEqual(["worktree-agent-held"]);
    expect(existsSync(agent("agent-held"))).toBe(false);
    expect(refExists("RP-12-held", root)).toBe(false);
  });

  it("calls a branch with a commit of its own finished only once the target has it", () => {
    run(["worktree", "add", "-b", "RP-3-done", agent("agent-done")]);
    writeFileSync(join(agent("agent-done"), "c.txt"), "c");
    run(["add", "c.txt"], agent("agent-done"));
    run(["commit", "-m", "work"], agent("agent-done"));
    expect(judgeWorktree(listed("agent-done"), "main", root, nobody)).toEqual({ finished: false, neverCommitted: false });
    run(["merge", "--no-ff", "-m", "merge", "RP-3-done"]);
    expect(judgeWorktree(listed("agent-done"), "main", root, nobody)).toEqual({ finished: true, neverCommitted: false });
  });

  // RP-585: lane:env called RP-555-review-fixes (made on the merged integration tip, never committed to) not merged,
  // while worktrees:clean removed it. Now all four commands judge it by one rule.
  describe("one finished rule for lane:env, lanes:prune, worktrees:clean and worktrees:prune (RP-585)", () => {
    const paused = "agent-paused";
    const verdicts = (live: Liveness) => {
      const w = listed(paused);
      const facts = gatherFacts([w], "main", root, live);
      const pruneFacts = facts.map((f) => ({ ...f, upstreamGone: false, unpushed: 0, project: undefined }));
      return {
        "lane:env, lanes:prune": judgeWorktree(w, "main", root, live).finished,
        "worktrees:clean": chooseWorktrees({ worktrees: facts, currentPath: root }).remove.length === 1,
        "worktrees:prune": choosePrune({ worktrees: pruneFacts, branches: [], mainRoot: root, currentPath: root, docker: undefined, exists: existsSync }).remove.length === 1,
      };
    };
    const all = (finished: boolean) => ({ "lane:env, lanes:prune": finished, "worktrees:clean": finished, "worktrees:prune": finished });

    beforeEach(() => {
      // The integration branch has a commit and is merged; the ticket's branch is made on its tip and never committed to.
      run(["worktree", "add", "-b", "integration", join(root, "int")]);
      writeFileSync(join(root, "int", "i.txt"), "i");
      run(["add", "i.txt"], join(root, "int"));
      run(["commit", "-m", "integration"], join(root, "int"));
      run(["merge", "--no-ff", "-m", "merge", "integration"]);
      run(["worktree", "add", "-b", "RP-555-review-fixes", agent(paused), "integration"]);
    });

    it("finds a never-committed, clean, unlocked branch at a commit in the target finished in all four", () => {
      expect(verdicts(nobody)).toEqual(all(true));
      expect(judgeWorktree(listed(paused), "main", root, nobody).neverCommitted).toBe(true);
    });

    it("also with the app's lock, once the session it names has stopped", () => {
      run(["worktree", "lock", "--reason", "claude agent agent-paused (pid 4242)", agent(paused)]);
      expect(verdicts(nobody)).toEqual(all(true));
    });

    it("finds it not finished in any of the four while a running session's lock holds it", () => {
      run(["worktree", "lock", "--reason", "claude agent agent-paused (pid 4242)", agent(paused)]);
      expect(verdicts({ lockLive: (locked) => locked?.includes("pid 4242") ?? false, heldByProcess: () => false })).toEqual(all(false));
    });

    it("finds it not finished in any of the four with uncommitted files", () => {
      writeFileSync(join(agent(paused), "wip.txt"), "wip");
      expect(verdicts(nobody)).toEqual(all(false));
    });

    it("finds it not finished in any of the four while a running process holds its folder", () => {
      expect(verdicts({ lockLive: () => false, heldByProcess: (path) => samePath(path, agent(paused)) })).toEqual(all(false));
    });

    it("finds a branch that has commits the target lacks not finished in any of the four", () => {
      writeFileSync(join(agent(paused), "w.txt"), "w");
      run(["add", "w.txt"], agent(paused));
      run(["commit", "-m", "work"], agent(paused));
      expect(verdicts(nobody)).toEqual(all(false));
    });
  });

  it("calls a detached HEAD merged once its commit is in the target (RP-601)", () => {
    run(["worktree", "add", "-b", "RP-4-detach", agent("agent-detach")]);
    writeFileSync(join(agent("agent-detach"), "d.txt"), "d");
    run(["add", "d.txt"], agent("agent-detach"));
    run(["commit", "-m", "work"], agent("agent-detach"));
    run(["checkout", "--detach"], agent("agent-detach"));
    expect(listed("agent-detach").branch).toBeUndefined();
    expect(judgeWorktree(listed("agent-detach"), "main", root, nobody).finished).toBe(false);
    run(["merge", "--no-ff", "-m", "merge", "RP-4-detach"]);
    expect(judgeWorktree(listed("agent-detach"), "main", root, nobody)).toEqual({ finished: true, neverCommitted: false });
  });

  it("calls a detached HEAD whose reflog holds only checkouts finished once nothing holds it, without saying never committed (RP-601, RP-585)", () => {
    run(["worktree", "add", "--detach", agent("agent-left")]);
    expect(listed("agent-left").branch).toBeUndefined();
    expect(judgeWorktree(listed("agent-left"), "main", root, nobody)).toEqual({ finished: true, neverCommitted: false });
    expect(judgeWorktree(listed("agent-left"), "main", root, { lockLive: () => false, heldByProcess: () => true }).finished).toBe(false);
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
      { branch: "RP-1-merged", inTarget: true, ownCommit: true, upstreamGone: true },
      { branch: "RP-2-created", inTarget: true, ownCommit: false, upstreamGone: false },
      { branch: "RP-3-open", inTarget: false, ownCommit: true, upstreamGone: false },
      { branch: "main", inTarget: true, ownCommit: true, upstreamGone: false },
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

  it("counts a squash-merged branch's commits as on no origin branch once its remote branch is deleted", () => {
    run(["checkout", "-b", "RP-6-squashed"]);
    commit(clone, "g.txt");
    run(["push", "-u", "origin", "RP-6-squashed"]);
    const head = run(["rev-parse", "HEAD"]).trim();
    run(["checkout", "main"]);
    run(["merge", "--squash", "RP-6-squashed"]);
    run(["commit", "-m", "RP-6 squashed"]);
    run(["push", "origin", "main"]);
    run(["push", "origin", "--delete", "RP-6-squashed"]);
    run(["fetch", "--prune", "origin"]);
    expect(localBranches("origin/main", clone).find((b) => b.branch === "RP-6-squashed")).toMatchObject({ inTarget: false, upstreamGone: true });
    expect(unpushedCount(head, clone)).toBe(1);
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
