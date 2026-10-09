import { describe, expect, it } from "vitest";
import { foreignSessionLock, parseProcessTable, sessionLockPid } from "./session-lock.ts";

const lock = "claude session RP-461-retro-tooling (pid 1700)";
// Process list injected: pid -> parent pid. Pid 1700 is a live foreign session; 50 -> 40 -> 30 is this process's chain.
const table = new Map([
  [1700, 1],
  [50, 40],
  [40, 30],
  [30, 1],
]);
const processes = { parentOf: (pid: number) => table.get(pid), isAlive: (pid: number) => table.has(pid) };

describe("sessionLockPid", () => {
  it("reads the pid of a claude session lock", () => {
    expect(sessionLockPid(lock)).toBe(1700);
  });
  it("ignores agent locks, hand locks and no lock", () => {
    expect(sessionLockPid("claude agent agent-1 (pid 31260)")).toBeUndefined();
    expect(sessionLockPid("keep, mid-review")).toBeUndefined();
    expect(sessionLockPid("")).toBeUndefined();
    expect(sessionLockPid(undefined)).toBeUndefined();
  });
});

describe("foreignSessionLock", () => {
  it("refuses a lock held by a live pid that is not an ancestor, naming pid and session", () => {
    const refusal = foreignSessionLock(lock, 50, processes);
    expect(refusal).toContain("1700");
    expect(refusal).toContain("RP-461-retro-tooling");
  });
  it("passes when the pid is dead", () => {
    expect(foreignSessionLock("claude session old (pid 999)", 50, processes)).toBeUndefined();
  });
  it("passes when the lock's pid is this process's own ancestor", () => {
    expect(foreignSessionLock("claude session mine (pid 30)", 50, processes)).toBeUndefined();
  });
  it("passes when the lock's pid is this process itself", () => {
    expect(foreignSessionLock("claude session mine (pid 50)", 50, processes)).toBeUndefined();
  });
  it("passes for agent locks and unlocked worktrees", () => {
    expect(foreignSessionLock("claude agent agent-1 (pid 1700)", 50, processes)).toBeUndefined();
    expect(foreignSessionLock(undefined, 50, processes)).toBeUndefined();
  });
});

describe("parseProcessTable", () => {
  it("reads `pid ppid` lines into a process list", () => {
    const p = parseProcessTable("  1700 1\r\n50 40\r\n\r\nbad line\r\n");
    expect(p.isAlive(1700)).toBe(true);
    expect(p.isAlive(9)).toBe(false);
    expect(p.parentOf(50)).toBe(40);
  });
});
