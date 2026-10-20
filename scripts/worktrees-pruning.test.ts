import { describe, expect, it } from "vitest";
import type { Holders } from "./claude-sessions.ts";
import type { Container, Volume } from "./lanes.ts";
import { changedSinceListed, choosePrune, type PruneWorktree } from "./worktrees-pruning.ts";
import type { LocalBranch } from "./worktrees.ts";

const main = "G:/Rabaed Contech";
const here = `${main}/.claude/worktrees/RP-1-current`;

const wt = (path: string, w: Partial<PruneWorktree> = {}): PruneWorktree => ({
  path,
  head: "abc123",
  branch: "RP-5-done",
  locked: undefined,
  ahead: 0,
  dirty: false,
  noCommitsYet: false,
  lockLive: false,
  heldByProcess: false,
  upstreamGone: false,
  unpushed: 0,
  project: undefined,
  ...w,
});
const mainCheckout = wt(main, { branch: "main", project: "rabaed" });
const current = wt(here, { branch: "RP-1-current", ahead: 2, project: "rabaed-lane2" });
const container = (name: string, project: string, workingDir: string, state = "running"): Container => ({ name, state, project, workingDir, ports: [] });
const merged = (branch: string, b: Partial<LocalBranch> = {}): LocalBranch => ({ branch, inTarget: true, ownCommit: true, upstreamGone: false, ...b });
const none: Holders = { runningSession: () => undefined, desktopSession: () => undefined };
const volume = (project: string): Volume => ({ name: `${project}_db`, project });

const choose = (worktrees: PruneWorktree[], more: Partial<Parameters<typeof choosePrune>[0]> = {}) =>
  choosePrune({ worktrees: [mainCheckout, current, ...worktrees], branches: [], mainRoot: main, currentPath: here, docker: undefined, exists: () => true, holders: none, platform: "linux", ...more });
const reasons = (p: ReturnType<typeof choosePrune>) => p.skipped.map((s) => [s.worktree.path, s.reason]);

describe("choosePrune", () => {
  it("removes a merged worktree with its compose project and branch", () => {
    const done = wt("G:/work/RP-5 done", { project: "rabaed-lane3" });
    const p = choose([done], {
      branches: [merged("RP-5-done"), merged("RP-4-old")],
      docker: { containers: [container("rabaed-lane3-db-1", "rabaed-lane3", done.path)], volumes: [volume("rabaed-lane3")], currentProject: "rabaed-lane2" },
    });
    expect(p.remove.map((w) => w.path)).toEqual(["G:/work/RP-5 done"]);
    expect(p.projects.map((x) => [x.project, x.containers, x.volumes])).toEqual([["rabaed-lane3", ["rabaed-lane3-db-1"], ["rabaed-lane3_db"]]]);
    // Removed only once that worktree is.
    expect(p.projects[0]?.waitsFor).toEqual(["G:/work/RP-5 done"]);
    // RP-5-done goes with its worktree; the other merged branches are listed on their own.
    expect(p.branches).toEqual(["RP-4-old"]);
  });

  it("never touches the main checkout or the current worktree, even when merged", () => {
    const p = choosePrune({
      worktrees: [wt(main, { branch: "RP-9-x" }), wt(here, { branch: "RP-1-current" })],
      branches: [],
      mainRoot: main,
      currentPath: here,
      docker: undefined,
      exists: () => true,
      holders: none,
      platform: "linux",
    });
    expect(p.remove).toEqual([]);
    expect(reasons(p)).toEqual([
      [main, "the main checkout"],
      [here, "this is the current worktree"],
    ]);
  });

  it("compares paths ignoring case and slashes on Windows", () => {
    const p = choosePrune({
      worktrees: [wt("g:\\rabaed contech\\"), wt("G:\\RABAED CONTECH\\.claude\\worktrees\\rp-1-current")],
      branches: [],
      mainRoot: main,
      currentPath: here,
      docker: undefined,
      exists: () => true,
      holders: none,
      platform: "win32",
    });
    expect(p.remove).toEqual([]);
  });

  it("skips and lists a dirty worktree, one with commits on no origin branch, and one not merged", () => {
    const p = choose([
      wt("/w/dirty", { dirty: true }),
      wt("/w/unpushed", { unpushed: 2, ahead: 2 }),
      wt("/w/open", { ahead: 1 }),
      wt("/w/fresh", { noCommitsYet: true, lockLive: true }),
      wt("/w/served", { noCommitsYet: true, heldByProcess: true }),
    ]);
    expect(p.remove).toEqual([]);
    expect(reasons(p).slice(2)).toEqual([
      ["/w/dirty", "uncommitted changes"],
      ["/w/unpushed", "2 commits on no origin branch"],
      ["/w/open", "1 commit not in origin/main"],
      ["/w/fresh", "no commits yet, may still be running (locked by a running session)"],
      ["/w/served", "no commits yet, may still be running (a running process holds its folder)"],
    ]);
  });

  it("skips and names a merged worktree a running Claude session is in, before any other reason (RP-956)", () => {
    const held = 'a running Claude session is in it: session "Main 4" (pid 35760)';
    const path = `${main}/.claude/worktrees/main-4-inspections`;
    const holders: Holders = { ...none, runningSession: (p) => (p === path ? held : undefined) };
    const p = choose([wt(path, { dirty: true }), wt("/w/done")], { holders });
    expect(p.remove.map((w) => w.path)).toEqual(["/w/done"]);
    expect(reasons(p)[2]).toEqual([path, held]);
  });

  it("skips every worktree when the running sessions cannot be checked, naming why (RP-956)", () => {
    const why = "running Claude sessions could not be checked: the process list could not be read";
    const p = choose([wt(`${main}/.claude/worktrees/agent-a`), wt("/w/done")], { holders: { ...none, runningSession: () => why } });
    expect(p.remove).toEqual([]);
    expect(reasons(p).slice(2)).toEqual([
      [`${main}/.claude/worktrees/agent-a`, why],
      ["/w/done", why],
    ]);
  });

  it("names a running session before an open desktop session when both hold a worktree", () => {
    const holders: Holders = { runningSession: () => "a running Claude session is in it: x", desktopSession: () => ({ kind: "open", session: 'session "RP-9"' }) };
    expect(reasons(choose([wt("/w/done")], { holders }))[2]?.[1]).toBe("a running Claude session is in it: x");
  });

  it("removes a worktree never committed to once the session its lock names has stopped and nothing holds it (RP-585)", () => {
    const p = choose([wt(`${main}/.claude/worktrees/agent-paused`, { branch: "RP-555-review-fixes", noCommitsYet: true, locked: "claude agent agent-paused (pid 4242)" })]);
    expect(p.remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/agent-paused`]);
  });

  it("keeps an unlocked worktree never committed to: its session may have just branched off origin/main (RP-610)", () => {
    const p = choose([wt(`${main}/.claude/worktrees/vibrant`, { branch: "RP-568-servers-stop", noCommitsYet: true })]);
    expect(p.remove).toEqual([]);
    expect(reasons(p)[2]).toEqual([`${main}/.claude/worktrees/vibrant`, "no commits yet, may still be running (no lock to show its session has stopped)"]);
  });

  it("puts uncommitted changes first, even on a merged worktree whose upstream is gone", () => {
    expect(reasons(choose([wt("/w/a", { dirty: true, unpushed: 1, upstreamGone: true })]))[2]?.[1]).toBe("uncommitted changes");
  });

  it("keeps a squash-merged worktree whose remote branch was deleted: its commits are on no origin branch", () => {
    // After a squash merge and the remote branch's deletion, origin has none of its commits.
    const p = choose([wt("/w/squashed", { ahead: 3, upstreamGone: true, unpushed: 3 })]);
    expect(p.remove).toEqual([]);
    expect(reasons(p)[2]).toEqual(["/w/squashed", "3 commits on no origin branch"]);
  });

  it("treats a gone upstream as merged when another origin branch still has its commits", () => {
    // E.g. a stacked branch merged into its base branch, which origin still has.
    const p = choose([wt("/w/stacked", { ahead: 3, upstreamGone: true, unpushed: 0 })]);
    expect(p.remove.map((w) => w.path)).toEqual(["/w/stacked"]);
  });

  it("includes a desktop-app worktree only when merged into origin/main, not for a gone upstream alone", () => {
    const p = choose([wt(`${main}/.claude/worktrees/agent-a`, { ahead: 3, upstreamGone: true }), wt(`${main}/.claude/worktrees/RP-7-b`, { locked: "claude agent agent-b (pid 1)" })]);
    expect(p.remove.map((w) => w.path)).toEqual([`${main}/.claude/worktrees/RP-7-b`]);
    expect(reasons(p)[2]).toEqual([`${main}/.claude/worktrees/agent-a`, "3 commits not in origin/main"]);
  });

  it("skips a merged worktree whose desktop-app session is still open", () => {
    const p = choose([wt(`${main}/.claude/worktrees/RP-8-c`, { locked: "claude session RP-8-c (pid 42668)" })]);
    expect(p.remove).toEqual([]);
    expect(reasons(p)[2]?.[1]).toBe("its Claude desktop session is open (claude session RP-8-c (pid 42668)); archive it first");
  });

  it("skips a merged desktop-app worktree whose session is open after its branch was renamed (RP-608)", () => {
    // The app does not lock its own worktrees: the open session is known by the worktree's path only.
    const renamed = wt(`${main}/.claude/worktrees/quiet-heron-0a1b2c`, { branch: "RP-602-lane-numbers", upstreamGone: true });
    const holders: Holders = { ...none, desktopSession: (path) => (path === renamed.path ? { kind: "open", session: 'session "Build RP-602"' } : undefined) };
    const p = choose([renamed], { holders });
    expect(p.remove).toEqual([]);
    expect(reasons(p)[2]).toEqual([renamed.path, 'its Claude desktop session is open (session "Build RP-602"); archive it first']);
  });

  it("skips every worktree when the desktop app's records cannot be read (RP-608)", () => {
    const holders: Holders = { ...none, desktopSession: () => ({ kind: "unknown", reason: "Claude desktop's worktree list (x.json) could not be read" }) };
    const p = choose([wt("/w/done")], { holders });
    expect(p.remove).toEqual([]);
    expect(reasons(p)[2]).toEqual(["/w/done", "a Claude desktop session may hold it: Claude desktop's worktree list (x.json) could not be read"]);
  });

  it("skips a worktree on main and one locked by hand", () => {
    const p = choose([wt("/w/on-main", { branch: "main" }), wt("/w/locked", { locked: "keep" })]);
    expect(p.remove).toEqual([]);
    expect(reasons(p).slice(2).map((r) => r[1])).toEqual(["on main", "locked by hand (keep)"]);
  });

  it("deletes only other branches in origin/main that had a commit or lost their upstream, never main or a checked-out one", () => {
    const p = choose([wt("/w/dirty", { dirty: true, branch: "RP-6-dirty" })], {
      branches: [
        merged("main"),
        merged("RP-1-current"),
        merged("RP-6-dirty"),
        merged("RP-2-merged"),
        merged("RP-3-gone", { ownCommit: false, upstreamGone: true }),
        merged("RP-4-just-created", { ownCommit: false }),
        merged("RP-5-open", { inTarget: false, upstreamGone: true }),
      ],
    });
    expect(p.branches).toEqual(["RP-2-merged", "RP-3-gone"]);
  });

  it("keeps a removed worktree's compose project while a kept worktree names it in its .env", () => {
    const done = wt("/w/done", { project: "rabaed-lane3" });
    const p = choose([done, wt("/w/open", { ahead: 1, project: "rabaed-lane3" })], {
      docker: { containers: [container("rabaed-lane3-db-1", "rabaed-lane3", done.path)], volumes: [], currentProject: "rabaed-lane2" },
    });
    expect(p.remove.map((w) => w.path)).toEqual(["/w/done"]);
    expect(p.projects).toEqual([]);
  });

  it("also removes the orphans lanes:prune finds, never the current project or one of an existing folder", () => {
    const p = choose([], {
      docker: {
        containers: [
          container("rabaed-lane5-db-1", "rabaed-lane5", "/gone"),
          container("rabaed-lane6-db-1", "rabaed-lane6", "/other-clone"),
          container("rabaed-lane2-db-1", "rabaed-lane2", here),
        ],
        volumes: [volume("rabaed-lane7")],
        currentProject: "rabaed-lane2",
      },
      exists: (dir) => dir !== "/gone",
    });
    expect(p.projects.map((x) => [x.project, x.reason, x.waitsFor])).toEqual([
      ["rabaed-lane5", "worktree gone (/gone)", []],
      ["rabaed-lane7", "no containers, only volumes", []],
    ]);
  });

  it("chooses no compose project when Docker is not running", () => {
    expect(choose([wt("/w/done", { project: "rabaed-lane3" })]).projects).toEqual([]);
  });
});

describe("changedSinceListed", () => {
  it("lets a worktree go that is still clean and pushed", () => {
    expect(changedSinceListed(wt("/w/done"), none)).toBeUndefined();
  });

  it("keeps one that got uncommitted changes or unpushed commits after it was listed, or is gone from git", () => {
    expect(changedSinceListed(wt("/w/done", { dirty: true }), none)).toBe("uncommitted changes since it was listed");
    expect(changedSinceListed(wt("/w/done", { unpushed: 1 }), none)).toBe("1 commit on no origin branch since it was listed");
    expect(changedSinceListed(undefined, none)).toBe("no longer a worktree");
  });

  it("keeps one a running or desktop session holds now, the running one named first", () => {
    const running = 'a running Claude session is in it: session "Main 9" (pid 9)';
    const open = () => ({ kind: "open" as const, session: 'session "RP-9"' });
    expect(changedSinceListed(wt("/w/done"), { runningSession: () => running, desktopSession: open })).toBe(running);
    expect(changedSinceListed(wt("/w/done"), { ...none, desktopSession: open })).toBe('its Claude desktop session is open (session "RP-9")');
    expect(changedSinceListed(wt("/w/done"), { ...none, desktopSession: () => ({ kind: "unknown", reason: "list unreadable" }) })).toBe(
      "a Claude desktop session may hold it: list unreadable",
    );
  });
});
