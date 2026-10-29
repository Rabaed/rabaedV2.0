import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Holders } from "./claude-sessions.ts";
import type { Container, StaleProject } from "./lanes.ts";
import {
  bareMergedYesRefusal,
  isShallowRepo,
  keptLast,
  laneRefusal,
  listedChanges,
  mergedLanes,
  protectedLaneReason,
  sessionHeldProject,
  shallowRefusal,
  splitProtected,
} from "./prune-guards.ts";

const container = (name: string, project: string, workingDir: string, state = "exited"): Container => ({ name, state, project, workingDir, ports: [] });
const stale = (project: string, reason = "not running"): StaleProject => ({ project, reason, containers: [`${project}-db-1`], volumes: [`${project}_db`] });

describe("lane 7 (the live UAT stack)", () => {
  it("is protected; other lanes, even 70-something names, are not", () => {
    expect(protectedLaneReason("rabaed-lane7")).toContain("live UAT stack");
    expect(protectedLaneReason("rabaed-lane71")).toBeUndefined();
    expect(protectedLaneReason("rabaed-lane42")).toBeUndefined();
    expect(protectedLaneReason(undefined)).toBeUndefined();
  });

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
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: false })).toContain("--lane N");
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: false, lane: 42 })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: true, yes: false, dryRun: false })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: true, yes: true, dryRun: true })).toBeUndefined();
    expect(bareMergedYesRefusal({ merged: false, yes: true, dryRun: false })).toBeUndefined();
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
      "Kept, with why (printed last):",
      "  rabaed-lane12 of G:/w/a: a running Claude session is in it",
    ]);
    expect(keptLast([])).toEqual([]);
    // Lines a later step logged (removeProjectsNow's "Kept compose project …") follow, under the same heading.
    expect(keptLast([], ["Kept compose project rabaed-lane12: /w/a was not removed."])).toEqual(["Kept, with why (printed last):", "  Kept compose project rabaed-lane12: /w/a was not removed."]);
  });
});
