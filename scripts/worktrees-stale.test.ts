import { describe, expect, it } from "vitest";
import { findStale, formatStale, lockPid, parseStaleDays, type Activity } from "./worktrees-stale.ts";
import type { Skipped } from "./worktrees.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-10T12:00:00Z");
const ago = (days: number) => now - days * DAY;

const skip = (path: string, w: { branch?: string; locked?: string } = {}, reason = "uncommitted changes"): Skipped => ({
  worktree: { path, head: "abc", branch: "branch" in w ? w.branch : "RP-1-x", locked: w.locked },
  reason,
});
const run = (skipped: Skipped[], activity: Record<string, Activity>, more: { staleDays?: number; running?: number[] } = {}) =>
  findStale({
    skipped,
    now,
    staleDays: more.staleDays ?? 7,
    activityOf: (path) => activity[path],
    pidRunning: (pid) => (more.running ?? []).includes(pid),
  });

describe("findStale", () => {
  it("lists a worktree untouched for 8 days with its age, and not one changed today", () => {
    const stale = run([skip("/w/old"), skip("/w/new")], {
      "/w/old": { lastCommit: ago(8), newestChange: ago(9) },
      "/w/new": { lastCommit: ago(30), newestChange: ago(0.1) },
    });
    expect(stale.map((s) => [s.worktree.path, s.ageDays, s.reason])).toEqual([["/w/old", 8, "uncommitted changes"]]);
  });

  it("counts the newer of the last commit and the newest changed file", () => {
    const stale = run([skip("/w/a")], { "/w/a": { lastCommit: ago(20), newestChange: ago(10) } });
    expect(stale[0]?.ageDays).toBe(10);
  });

  it("uses the last commit alone when nothing changed, and skips a worktree with no known activity", () => {
    const stale = run([skip("/w/clean"), skip("/w/unknown")], { "/w/clean": { lastCommit: ago(12), newestChange: undefined } });
    expect(stale.map((s) => [s.worktree.path, s.ageDays])).toEqual([["/w/clean", 12]]);
  });

  it("honours --stale-days and lists the oldest first", () => {
    const activity = { "/w/a": { lastCommit: ago(3), newestChange: undefined }, "/w/b": { lastCommit: ago(5), newestChange: undefined } };
    expect(run([skip("/w/a"), skip("/w/b")], activity, { staleDays: 2 }).map((s) => s.worktree.path)).toEqual(["/w/b", "/w/a"]);
    expect(run([skip("/w/a"), skip("/w/b")], activity, { staleDays: 4 }).map((s) => s.worktree.path)).toEqual(["/w/b"]);
  });

  it("marks whether the pid in a lock still runs, and a lock with no pid", () => {
    const old = { lastCommit: ago(10), newestChange: undefined };
    const stale = run(
      [skip("/w/gone", { locked: "claude agent a (pid 111)" }), skip("/w/alive", { locked: "claude session s (pid 222)" }), skip("/w/hand", { locked: "keep" }), skip("/w/free")],
      { "/w/gone": old, "/w/alive": old, "/w/hand": old, "/w/free": old },
      { running: [222] },
    );
    expect(stale.map((s) => [s.worktree.path, s.pid, s.pidRunning])).toEqual([
      ["/w/gone", 111, false],
      ["/w/alive", 222, true],
      ["/w/hand", undefined, undefined],
      ["/w/free", undefined, undefined],
    ]);
  });
});

describe("formatStale", () => {
  it("prints age, branch, reason and the lock's pid state", () => {
    const old = { lastCommit: ago(8), newestChange: undefined };
    const lines = formatStale(
      run([skip("/w/gone", { locked: "claude agent a (pid 111)" }), skip("/w/alive", { locked: "claude agent b (pid 222)", branch: undefined })], { "/w/gone": old, "/w/alive": old }, { running: [222] }),
    );
    expect(lines).toEqual([
      "  /w/gone (RP-1-x), 8 days: uncommitted changes; locked, pid 111 is not running",
      "  /w/alive (detached HEAD), 8 days: uncommitted changes; locked, pid 222 is still running",
    ]);
  });
});

describe("lockPid", () => {
  it("reads the pid from the app's lock reasons", () => {
    expect(lockPid("claude agent agent-b (pid 1234)")).toBe(1234);
    expect(lockPid("claude session RP-8-c (pid 42668)")).toBe(42668);
    expect(lockPid("keep")).toBeUndefined();
    expect(lockPid("")).toBeUndefined();
  });
});

describe("parseStaleDays", () => {
  it("defaults to 7 and accepts a positive number", () => {
    expect(parseStaleDays(undefined)).toBe(7);
    expect(parseStaleDays("14")).toBe(14);
    expect(parseStaleDays("0")).toBeUndefined();
    expect(parseStaleDays("x")).toBeUndefined();
  });
});
