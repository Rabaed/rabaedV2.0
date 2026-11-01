import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Holders } from "./claude-sessions.ts";
import { protectedLaneReason, type Container, type StaleProject } from "./lanes.ts";
import { isShallowRepo } from "./worktrees.ts";
import {
  bareMergedYesRefusal,
  guardCandidates,
  keptLast,
  laneRefusal,
  listedChanges,
  mergedLanes,
  sessionHeldProject,
  shallowRefusal,
  splitProtected,
} from "./prune-guards.ts";

const container = (name: string, project: string, workingDir: string, state = "exited"): Container => ({ name, state, project, workingDir, ports: [] });
const stale = (project: string, reason = "not running"): StaleProject => ({ project, reason, containers: [`${project}-db-1`], volumes: [`${project}_db`] });

describe("lane 7 (Main 7's harness data; lanes.test.ts tests which lane is protected)", () => {
  it("is split out of the candidates and kept with its reason and folder", () => {
    const containers = [container("rabaed-lane7-db-1", "rabaed-lane7", "G:/uat")];
    const { prune, kept } = splitProtected([stale("rabaed-lane7"), stale("rabaed-lane42")], containers);
    expect(prune.map((p) => p.project)).toEqual(["rabaed-lane42"]);
    expect(kept).toEqual([{ project: "rabaed-lane7", path: "G:/uat", reason: protectedLaneReason("rabaed-lane7") }]);
  });

  it("refuses `--lane 7` outright", () => {
    expect(laneRefusal(7)).toContain("lane 7");
    expect(laneRefusal(42)).toBeUndefined();
    expect(laneRefusal(undefined)).toBeUndefined();
  });
});

describe("bareMergedYesRefusal (RP-1007)", () => {
  it("refuses --merged --yes without --lane, and nothing else", () => {
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: false })).toMatch(/^lanes:prune refused: `--merged --yes` needs `--lane`/);
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: false, lane: 42 })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: true, yes: false, dryRun: false })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: true })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: false, yes: true, dryRun: false })).toBeUndefined();
  });

  it("names the current worktree's lane in the command to run instead (RP-1198: no `--lane N` placeholder)", () => {
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: false, ownLane: 41 })).toBe(
      "lanes:prune refused: `--merged --yes` needs `--lane` (RP-1007: a bare one removed other Mains' live stacks). Prune this worktree's lane with `pnpm lanes:prune --merged --yes --lane 41`, or drop `--yes` to see the list and confirm.",
    );
  });

  it("names no lane when the worktree has none, or has lane 7's, and never offers a placeholder", () => {
    for (const ownLane of [undefined, 7]) {
      const refusal = bareMergedYesRefusal({ merged: true, yes: true, dryRun: false, ownLane });
      expect(refusal).toContain("Add `--lane` with your lane's number (`pnpm lanes:prune --stale` lists the stacks), or drop `--yes` to see the list and confirm.");
      expect(refusal).not.toMatch(/--lane N|--lane 7|<|>/);
    }
  });
});

describe("sessionHeldProject", () => {
  const holders = (held: Record<string, string>): Holders => ({ runningSession: (p) => held[p], desktopSession: () => undefined });

  it("names the session working in a stale project's existing folder", () => {
    const containers = [container("rabaed-lane52-db-1", "rabaed-lane52", "G:/w/hopeful-thompson")];
    expect(sessionHeldProject(stale("rabaed-lane52"), containers, holders({ "G:/w/hopeful-thompson": "a running Claude session is in it: session \"x\" (pid 1)" }), () => true)).toEqual({
      project: "rabaed-lane52",
      path: "G:/w/hopeful-thompson",
      reason: 'a running Claude session is in it: session "x" (pid 1)',
    });
  });

  it("ignores a folder that is gone, so a session check that cannot run does not keep every orphan", () => {
    const containers = [container("rabaed-lane52-db-1", "rabaed-lane52", "G:/w/gone")];
    const unavailable: Holders = { runningSession: () => "running Claude sessions could not be checked", desktopSession: () => undefined };
    expect(sessionHeldProject(stale("rabaed-lane52", "worktree gone (G:/w/gone)"), containers, unavailable, () => false)).toBeUndefined();
  });

  it("is undefined when no session holds its folders", () => {
    const containers = [container("rabaed-lane52-db-1", "rabaed-lane52", "G:/w/a")];
    expect(sessionHeldProject(stale("rabaed-lane52"), containers, holders({}), () => true)).toBeUndefined();
  });
});

describe("guardCandidates", () => {
  it("keeps lane 7 and a stale project a session works in, and passes the rest", () => {
    const containers = [container("rabaed-lane7-db-1", "rabaed-lane7", "G:/uat"), container("rabaed-lane52-db-1", "rabaed-lane52", "G:/w/held"), container("rabaed-lane53-db-1", "rabaed-lane53", "G:/w/free")];
    const holders: Holders = { runningSession: (p) => (p === "G:/w/held" ? "a running Claude session is in it" : undefined), desktopSession: () => undefined };
    const { prune, kept } = guardCandidates([stale("rabaed-lane7"), stale("rabaed-lane52"), stale("rabaed-lane53")], containers, holders, () => true);
    expect(prune.map((p) => p.project)).toEqual(["rabaed-lane53"]);
    expect(kept.map((k) => [k.project, k.path])).toEqual([
      ["rabaed-lane7", "G:/uat"],
      ["rabaed-lane52", "G:/w/held"],
    ]);
  });
});

describe("shallow clones", () => {
  let repo: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "prune-shallow-"));
    git(repo, "init", "-q", "-b", "main");
    for (const n of ["1", "2"]) {
      writeFileSync(join(repo, "a.txt"), n);
      git(repo, "add", ".");
      git(repo, "commit", "-qm", n);
    }
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("tells a full clone from a shallow one", () => {
    expect(isShallowRepo(repo)).toBe(false);
    // What `git clone --depth 1` leaves: .git/shallow naming the cut-off commit.
    writeFileSync(join(repo, ".git", "shallow"), `${git(repo, "rev-parse", "HEAD").trim()}\n`);
    expect(isShallowRepo(repo)).toBe(true);
  });

  it("refuses with the command to unshallow", () => {
    expect(shallowRefusal(false, "worktrees:prune")).toBeUndefined();
    const message = shallowRefusal(true, "worktrees:prune");
    expect(message).toContain("worktrees:prune refused: this clone is shallow");
    expect(message).toContain("git fetch --unshallow origin");
  });
});

describe("mergedLanes (lanes:prune --merged)", () => {
  it("counts a finished worktree with uncommitted or untracked files as not merged, and lists them", () => {
    const { worktrees, kept } = mergedLanes([
      { path: "/w/done", branch: "RP-1-done", project: "rabaed-lane41", finished: true, changes: [] },
      { path: "/w/dirty", branch: "RP-2-dirty", project: "rabaed-lane42", finished: true, changes: ["UU docs/visibility.md", "?? notes.md"] },
      { path: "/w/open", branch: "RP-3-open", project: "rabaed-lane43", finished: false, changes: ["?? x"] },
    ]);
    expect(worktrees.map((w) => [w.path, w.merged])).toEqual([
      ["/w/done", true],
      ["/w/dirty", false],
      ["/w/open", false],
    ]);
    expect(kept).toEqual([{ project: "rabaed-lane42", path: "/w/dirty", reason: "uncommitted changes: UU docs/visibility.md, ?? notes.md" }]);
  });
});

describe("listedChanges", () => {
  it("lists at most five, then how many more", () => {
    expect(listedChanges(undefined)).toBe("");
    expect(listedChanges(["?? a"])).toBe(": ?? a");
    expect(listedChanges(["1", "2", "3", "4", "5", "6", "7"])).toBe(": 1, 2, 3, 4, 5 and 2 more");
  });
});

describe("keptLast", () => {
  it("prints each kept item with its reason as the last lines, so `| tail` keeps them", () => {
    expect(keptLast([{ what: "rabaed-lane12 of G:/w/a", reason: "a running Claude session is in it" }])).toEqual([
      "Kept, with why:",
      "  rabaed-lane12 of G:/w/a: a running Claude session is in it",
    ]);
    expect(keptLast([])).toEqual([]);
    // Lines a later step logged (removeProjectsNow's "Kept compose project …") follow, under the same heading.
    expect(keptLast([], ["Kept compose project rabaed-lane12: /w/a was not removed."])).toEqual(["Kept, with why:", "  Kept compose project rabaed-lane12: /w/a was not removed."]);
  });
});
