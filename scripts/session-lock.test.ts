import { describe, expect, it } from "vitest";
import { foreignSessionLock, parseProcessTable, parseSessionLock } from "./session-lock.ts";

const lock = "claude session RP-461-retro-tooling (pid 1700)";
// Process list injected: pid -> [parent pid, name]. Pid 1700 is a live foreign claude.exe; 50 -> 40 -> 30 is this process's chain.
const table = new Map<number, [number, string]>([
  [1700, [1, "claude.exe"]],
  [50, [40, "node.exe"]],
  [40, [30, "pwsh.exe"]],
  [30, [1, "claude.exe"]],
  [60, [1, "explorer.exe"]],
  [31, [30, "claude.exe"]],
]);
const processes = { parentOf: (pid: number) => table.get(pid)?.[0], nameOf: (pid: number) => table.get(pid)?.[1], isAlive: (pid: number) => table.has(pid) };

describe("parseSessionLock", () => {
  it("reads the session name and pid of a claude session lock", () => {
    expect(parseSessionLock(lock)).toEqual({ name: "RP-461-retro-tooling", pid: 1700 });
  });
  it("ignores agent locks, hand locks and no lock", () => {
    expect(parseSessionLock("claude agent agent-1 (pid 31260)")).toBeUndefined();
    expect(parseSessionLock("keep, mid-review")).toBeUndefined();
    expect(parseSessionLock("")).toBeUndefined();
    expect(parseSessionLock(undefined)).toBeUndefined();
  });
});

describe("foreignSessionLock", () => {
  it("refuses a lock held by a live claude pid that is not an ancestor, naming pid and session", () => {
    const refusal = foreignSessionLock(lock, 50, processes);
    expect(refusal).toContain("1700");
    expect(refusal).toContain("RP-461-retro-tooling");
  });
  it("passes when the pid is dead", () => {
    expect(foreignSessionLock("claude session old (pid 999)", 50, processes)).toBeUndefined();
  });
  it("passes when the live pid is not a claude process (pid reuse)", () => {
    expect(foreignSessionLock("claude session stale (pid 60)", 50, processes)).toBeUndefined();
  });
  it("passes when the lock's pid is a claude.exe reached as an ancestor through shell -> node", () => {
    expect(foreignSessionLock("claude session mine (pid 30)", 50, processes)).toBeUndefined();
  });
  it("refuses a sibling claude.exe, a child of the same app claude.exe", () => {
    expect(foreignSessionLock("claude session other (pid 31)", 50, processes)).toContain("31");
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
  it("reads `pid ppid name` lines into a process list", () => {
    const p = parseProcessTable("  1700 1 claude.exe\r\n50 40 node\r\n\r\nbad line\r\n70 1 /usr/bin/claude\r\n");
    expect(p.isAlive(1700)).toBe(true);
    expect(p.isAlive(9)).toBe(false);
    expect(p.parentOf(50)).toBe(40);
    expect(p.nameOf(1700)).toBe("claude.exe");
    expect(p.nameOf(70)).toBe("claude");
  });
});
