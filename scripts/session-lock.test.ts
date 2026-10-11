import { describe, expect, it } from "vitest";
import { foreignSessionLock, ownServerHint, parseProcessTable, parseSessionLock, sessionPidOf } from "./session-lock.ts";

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
  it("passes from Git Bash, whose detached chain (parent pid 1) misses the session's claude.exe, when CLAUDE_PID names the lock's pid", () => {
    const bash = new Map(table).set(70, [1, "bash.exe"]).set(71, [70, "node.exe"]);
    const fromBash = { parentOf: (pid: number) => bash.get(pid)?.[0], nameOf: (pid: number) => bash.get(pid)?.[1], isAlive: (pid: number) => bash.has(pid) };
    expect(foreignSessionLock("claude session mine (pid 30)", 71, fromBash)).toContain("30");
    expect(foreignSessionLock("claude session mine (pid 30)", 71, fromBash, sessionPidOf({ CLAUDE_PID: "30" }))).toBeUndefined();
    expect(foreignSessionLock(lock, 71, fromBash, sessionPidOf({ CLAUDE_PID: "30" }))).toContain("1700");
  });
  it("reads CLAUDE_PID, and nothing when it is missing or not a pid", () => {
    expect(sessionPidOf({ CLAUDE_PID: "31676" })).toBe(31676);
    expect(sessionPidOf({})).toBeUndefined();
    expect(sessionPidOf({ CLAUDE_PID: "" })).toBeUndefined();
    expect(sessionPidOf({ CLAUDE_PID: "abc" })).toBeUndefined();
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

describe("ownServerHint (RP-545)", () => {
  // 90 (vite) -> 80 (node) -> 30 (this session's claude.exe); 70 hangs off the foreign claude.exe 1700; 60 hangs off explorer.
  const tree = new Map<number, [number, string]>([...table, [80, [30, "node.exe"]], [90, [80, "node.exe"]], [70, [1700, "node.exe"]]]);
  const procs = { parentOf: (pid: number) => tree.get(pid)?.[0], nameOf: (pid: number) => tree.get(pid)?.[1], isAlive: (pid: number) => tree.has(pid) };

  it("names a port held by a process under the session's claude and the command to stop it", () => {
    const hint = ownServerHint(4700, 90, 50, procs, 30, "win32");
    expect(hint).toContain("Port 4700 is held by this session's own dev server");
    expect(hint).toContain("pid 90");
    expect(hint).toContain("taskkill /pid 90 /t /f");
    expect(ownServerHint(4700, 90, 50, procs, 30, "linux")).toContain("`kill 90`");
  });
  it("finds the session through this process's own ancestors when CLAUDE_PID is not set", () => {
    expect(ownServerHint(4700, 90, 50, procs)).toContain("pid 90");
  });
  it("says nothing about a holder outside the session's tree", () => {
    expect(ownServerHint(4700, 70, 50, procs, 30)).toBeUndefined();
    expect(ownServerHint(4700, 60, 50, procs, 30)).toBeUndefined();
  });
  it("stops at this session's claude, so another session's server under the same desktop app is not called its own", () => {
    // Both claude.exe sessions (30, 1700) run under the desktop app 5, which is also named claude.exe.
    const app = new Map<number, [number, string]>([...tree, [30, [5, "claude.exe"]], [1700, [5, "claude.exe"]], [5, [1, "claude.exe"]]]);
    const under = { parentOf: (pid: number) => app.get(pid)?.[0], nameOf: (pid: number) => app.get(pid)?.[1], isAlive: (pid: number) => app.has(pid) };
    expect(ownServerHint(4700, 70, 50, under)).toBeUndefined();
    expect(ownServerHint(4700, 90, 50, under)).toContain("pid 90");
  });
});
