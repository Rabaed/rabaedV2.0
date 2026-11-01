import { describe, expect, it } from "vitest";
import { judgeBehindOrigin, MAX_BEHIND_ORIGIN, type BehindFacts } from "./behind-origin.ts";

const here = "G:/Rabaed Contech";
const facts = (over: Partial<BehindFacts>): BehindFacts => ({
  command: "pnpm lane:done 512",
  here,
  mainRoot: here,
  freshPath: "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101",
  behind: 0,
  branch: "main",
  clean: true,
  worktrees: [],
  ...over,
});

describe("judgeBehindOrigin", () => {
  it("says nothing when HEAD has all of origin/main", () => {
    expect(judgeBehindOrigin(facts({ behind: 0 }))).toEqual({ stop: false, lines: [] });
  });

  it("warns in one line and carries on at 1 to 50 commits behind", () => {
    expect(MAX_BEHIND_ORIGIN).toBe(50);
    expect(judgeBehindOrigin(facts({ behind: 50 }))).toEqual({
      stop: false,
      lines: ["pnpm lane:done 512: HEAD is 50 commits behind origin/main (it stops past 50); carrying on."],
    });
    expect(judgeBehindOrigin(facts({ behind: 1 })).lines).toEqual(["pnpm lane:done 512: HEAD is 1 commit behind origin/main (it stops past 50); carrying on."]);
  });

  it("stops past 50 and names the worktrees of this clone closest to origin/main, not this one or another stale one", () => {
    const verdict = judgeBehindOrigin(
      facts({
        behind: 973,
        worktrees: [
          { path: "G:/Rabaed Contech/", behind: 0 },
          { path: "G:/Rabaed Contech/.claude/worktrees/old", behind: 400 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-b", behind: 12 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-a", behind: 0 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-c", behind: 30 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-d", behind: 40 },
        ],
      }),
    );
    expect(verdict).toEqual({
      stop: true,
      lines: [
        "pnpm lane:done 512 stopped: HEAD is 973 commits behind origin/main: this checkout's scripts are older than main's.",
        "Run it from a worktree of this clone closer to origin/main:",
        '  cd "G:/Rabaed Contech/.claude/worktrees/lane-a"   (up to date with origin/main)',
        '  cd "G:/Rabaed Contech/.claude/worktrees/lane-b"   (12 commits behind)',
        '  cd "G:/Rabaed Contech/.claude/worktrees/lane-c"   (30 commits behind)',
        "  pnpm lane:done 512",
      ],
    });
  });

  it("never names a subagent's agent-* worktree, and names the main checkout first when it is within 50", () => {
    const lane = "G:/Rabaed Contech/.claude/worktrees/lane-x";
    const verdict = judgeBehindOrigin(
      facts({
        behind: 973,
        here: lane,
        worktrees: [
          { path: "G:/Rabaed Contech/.claude/worktrees/agent-a62ae01e2f1123762", behind: 0 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-b", behind: 12 },
          { path: "G:/Rabaed Contech", behind: 40 },
          { path: "G:/Rabaed Contech/.claude/worktrees/lane-a", behind: 0 },
          { path: "G:/Rabaed Contech/.claude/worktrees/agent-b1", behind: 3 },
        ],
      }),
    );
    expect(verdict.lines.slice(1, 5)).toEqual([
      "Run it from a worktree of this clone closer to origin/main:",
      '  cd "G:/Rabaed Contech"   (40 commits behind)',
      '  cd "G:/Rabaed Contech/.claude/worktrees/lane-a"   (up to date with origin/main)',
      '  cd "G:/Rabaed Contech/.claude/worktrees/lane-b"   (12 commits behind)',
    ]);
  });

  it("with only agent-* worktrees within 50, it does not send you to them", () => {
    const verdict = judgeBehindOrigin(facts({ behind: 973, worktrees: [{ path: "G:/Rabaed Contech/.claude/worktrees/agent-a1/", behind: 0 }] }));
    expect(verdict.lines[1]).toMatch(/^No worktree of this clone is within 50 commits/);
  });

  it("with no worktree within 50, a clean checkout on main fast-forwards", () => {
    const verdict = judgeBehindOrigin(facts({ behind: 973, branch: "main", clean: true, worktrees: [{ path: "G:/Rabaed Contech/.claude/worktrees/old", behind: 51 }] }));
    expect(verdict.stop).toBe(true);
    expect(verdict.lines.slice(1)).toEqual([
      "No worktree of this clone is within 50 commits of origin/main. This checkout is on main with no uncommitted tracked changes: bring it up to date, then run it again:",
      "  git merge --ff-only origin/main",
      "  pnpm install --frozen-lockfile",
      "  pnpm lane:done 512",
    ]);
  });

  it("with no worktree within 50, a checkout off main or with changes cuts a fresh worktree from origin/main", () => {
    const fresh = [
      "No worktree of this clone is within 50 commits of origin/main. Cut a fresh worktree from origin/main and run it there:",
      '  git worktree add --detach "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2" origin/main',
      '  cd "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2"',
      "  pnpm install --frozen-lockfile",
      "  pnpm lane:done 512",
    ];
    const freshPath = "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2";
    expect(judgeBehindOrigin(facts({ behind: 60, branch: "main", clean: false, freshPath })).lines.slice(1)).toEqual(fresh);
    expect(judgeBehindOrigin(facts({ behind: 60, branch: "RP-12-x", clean: true, here: "G:/Rabaed Contech/.claude/worktrees/lane-a", freshPath })).lines.slice(1)).toEqual(fresh);
  });

  it("says in one line when the fetch failed, and judges against the origin/main it has", () => {
    const failed = "pnpm lane:done 512: `git fetch origin main` failed (Could not resolve host: github.com), so it is judged against origin/main as last fetched.";
    expect(judgeBehindOrigin(facts({ behind: 0, fetchError: "Could not resolve host: github.com" }))).toEqual({ stop: false, lines: [failed] });
    const verdict = judgeBehindOrigin(facts({ behind: 973, fetchError: "Could not resolve host: github.com" }));
    expect(verdict.stop).toBe(true);
    expect(verdict.lines[0]).toBe(failed);
    expect(verdict.lines[1]).toMatch(/^pnpm lane:done 512 stopped: HEAD is 973 commits behind/);
  });

  it("carries on, saying so, when there is no origin/main to judge against", () => {
    expect(judgeBehindOrigin(facts({ behind: undefined }))).toEqual({ stop: false, lines: ["pnpm lane:done 512: origin/main not found, so whether HEAD is behind it was not checked."] });
  });
});
