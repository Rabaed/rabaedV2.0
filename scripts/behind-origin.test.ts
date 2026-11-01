import { describe, expect, it } from "vitest";
import { judgeBehindOrigin, MAX_BEHIND_ORIGIN, type BehindFacts, type StaleFacts } from "./behind-origin.ts";

const mainRoot = "G:/Rabaed Contech";
const lane = "G:/Rabaed Contech/.claude/worktrees/lane-x";
const stale = (over: Partial<StaleFacts> = {}): StaleFacts => ({
  mainRoot,
  freshPath: "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101",
  branch: "main",
  clean: true,
  ahead: 0,
  worktrees: [],
  ...over,
});
const facts = (over: Partial<BehindFacts>): BehindFacts => ({ command: "pnpm lane:done 512", here: mainRoot, behind: 0, shallow: false, ...over });
const stopped = "pnpm lane:done 512 stopped: HEAD is 973 merged PRs behind origin/main: this checkout's scripts are older than main's.";

describe("judgeBehindOrigin", () => {
  it("is silent up to 50 merged PRs behind", () => {
    expect(MAX_BEHIND_ORIGIN).toBe(50);
    expect(judgeBehindOrigin(facts({ behind: 0 }))).toEqual({ stop: false, lines: [] });
    expect(judgeBehindOrigin(facts({ behind: 50 }))).toEqual({ stop: false, lines: [] });
  });

  it("stops at 51, with the reason alone until it is given the stale checkout's facts", () => {
    expect(judgeBehindOrigin(facts({ behind: 51 }))).toEqual({ stop: true, lines: ["pnpm lane:done 512 stopped: HEAD is 51 merged PRs behind origin/main: this checkout's scripts are older than main's."] });
  });

  it("names the worktrees closest to origin/main, a named one before the main checkout on a tie; never this one, a stale one, a subagent's or one a live session holds", () => {
    const verdict = judgeBehindOrigin(
      facts({
        behind: 973,
        here: lane,
        stale: stale({
          worktrees: [
            { path: lane, behind: 0 },
            { path: "G:/Rabaed Contech/.claude/worktrees/agent-a62ae01e2f1123762", behind: 0 },
            { path: "G:/Rabaed Contech/.claude/worktrees/old", behind: 400 },
            { path: "G:/Rabaed Contech/.claude/worktrees/lane-b", behind: 12 },
            { path: mainRoot, behind: 0 },
            { path: "G:/Rabaed Contech/.claude/worktrees/lane-a", behind: 0 },
            { path: "G:/Rabaed Contech/.claude/worktrees/agent-b1/", behind: 3 },
            { path: "G:/Rabaed Contech/.claude/worktrees/lane-c", behind: 30 },
            { path: "G:/Rabaed Contech/.claude/worktrees/lane-held", behind: 0, held: true },
          ],
        }),
      }),
    );
    expect(verdict).toEqual({
      stop: true,
      lines: [
        stopped,
        "Run it from a worktree of this clone closer to origin/main:",
        '  cd "G:/Rabaed Contech/.claude/worktrees/lane-a"   (up to date with origin/main)',
        '  cd "G:/Rabaed Contech"   (up to date with origin/main)',
        '  cd "G:/Rabaed Contech/.claude/worktrees/lane-b"   (12 merged PRs behind)',
        "  pnpm lane:done 512",
      ],
    });
  });

  it("sends nobody back to a main checkout 40 behind while a worktree has origin/main", () => {
    const verdict = judgeBehindOrigin(
      facts({ behind: 973, here: lane, stale: stale({ worktrees: [{ path: mainRoot, behind: 40 }, { path: "G:/Rabaed Contech/.claude/worktrees/lane-a", behind: 0 }] }) }),
    );
    expect(verdict.lines[2]).toBe('  cd "G:/Rabaed Contech/.claude/worktrees/lane-a"   (up to date with origin/main)');
  });

  it("counts one merged PR in the singular", () => {
    const verdict = judgeBehindOrigin(facts({ behind: 973, here: lane, stale: stale({ worktrees: [{ path: "G:/Rabaed Contech/.claude/worktrees/lane-a", behind: 1 }] }) }));
    expect(verdict.lines[2]).toBe('  cd "G:/Rabaed Contech/.claude/worktrees/lane-a"   (1 merged PR behind)');
  });

  it("with no worktree within 50, a clean main with nothing origin/main lacks fast-forwards", () => {
    const verdict = judgeBehindOrigin(facts({ behind: 973, stale: stale({ worktrees: [{ path: "G:/Rabaed Contech/.claude/worktrees/agent-a1", behind: 0 }] }) }));
    expect(verdict).toEqual({
      stop: true,
      lines: [
        stopped,
        "No worktree of this clone is within 50 merged PRs of origin/main. This checkout is on main with no uncommitted tracked changes and nothing origin/main lacks: bring it up to date, then run it again:",
        "  git merge --ff-only origin/main",
        "  pnpm install --frozen-lockfile",
        "  pnpm lane:done 512",
      ],
    });
  });

  it("with no worktree within 50, cuts a fresh worktree when main has changes or commits of its own, or this is not main", () => {
    const fresh = [
      stopped,
      "No worktree of this clone is within 50 merged PRs of origin/main. Cut a fresh worktree from origin/main and run it there:",
      '  git worktree add --detach "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2" origin/main',
      '  cd "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2"',
      "  pnpm install --frozen-lockfile",
      "  pnpm lane:done 512",
    ];
    const freshPath = "G:/Rabaed Contech/.claude/worktrees/origin-main-20261101-2";
    expect(judgeBehindOrigin(facts({ behind: 973, stale: stale({ freshPath, clean: false }) })).lines).toEqual(fresh);
    expect(judgeBehindOrigin(facts({ behind: 973, stale: stale({ freshPath, ahead: 1 }) })).lines).toEqual(fresh);
    expect(judgeBehindOrigin(facts({ behind: 973, stale: stale({ freshPath, ahead: undefined }) })).lines).toEqual(fresh);
    expect(judgeBehindOrigin(facts({ behind: 973, here: lane, stale: stale({ freshPath, branch: "RP-12-x" }) })).lines).toEqual(fresh);
  });

  it("says in one line when the fetch failed, and judges against origin/main as last fetched", () => {
    const failed = "pnpm lane:done 512: `git fetch origin main` failed (Could not resolve host: github.com), so it is judged against origin/main as last fetched.";
    expect(judgeBehindOrigin(facts({ behind: 0, fetchError: "Could not resolve host: github.com" }))).toEqual({ stop: false, lines: [failed] });
    expect(judgeBehindOrigin(facts({ behind: 973, fetchError: "Could not resolve host: github.com" }))).toEqual({ stop: true, lines: [failed, stopped] });
  });

  it("carries on, saying so, when there is no origin/main or the clone is shallow", () => {
    expect(judgeBehindOrigin(facts({ behind: undefined }))).toEqual({ stop: false, lines: ["pnpm lane:done 512: origin/main not found, so whether HEAD is behind it was not checked."] });
    expect(judgeBehindOrigin(facts({ behind: undefined, shallow: true }))).toEqual({
      stop: false,
      lines: ["pnpm lane:done 512: this clone is shallow, so how far HEAD is behind origin/main cannot be counted; not checked."],
    });
  });
});
