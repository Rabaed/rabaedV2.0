import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  heldReason,
  holdReason,
  parseSessionFile,
  parseTimedProcessTable,
  readSessionFiles,
  sessionCheck,
  sessionHolding,
  systemSessionCheck,
  type ClaudeSession,
  type Holders,
  type TimedProcessList,
} from "./claude-sessions.ts";
import type { DesktopSession } from "./desktop-sessions.ts";

const main3: ClaudeSession = { pid: 35408, cwd: "G:\\Rabaed Contech\\.claude\\worktrees\\main-3-snag-days", name: "Main 3", sessionId: "s-3", hostSessionId: "local_3" };

describe("sessionHolding", () => {
  it("names the running session whose working directory is the worktree", () => {
    expect(sessionHolding("G:/Rabaed Contech/.claude/worktrees/main-3-snag-days", [main3], "win32")).toBe('session "Main 3" (pid 35408)');
  });

  it("matches a working directory inside the worktree, case-insensitively on Windows", () => {
    const deeper = { ...main3, cwd: "g:\\rabaed contech\\.claude\\worktrees\\MAIN-3-snag-days\\apps\\api" };
    expect(sessionHolding("G:\\Rabaed Contech\\.claude\\worktrees\\main-3-snag-days\\", [deeper], "win32")).toBe('session "Main 3" (pid 35408)');
  });

  it("does not match a sibling folder whose name only starts the same", () => {
    expect(sessionHolding("G:\\Rabaed Contech\\.claude\\worktrees\\main-3-snag", [main3], "win32")).toBeUndefined();
  });

  it("does not match the main checkout above the worktree", () => {
    expect(sessionHolding("G:\\Rabaed Contech", [{ ...main3, cwd: "G:\\Rabaed Contech" }], "win32")).toBe('session "Main 3" (pid 35408)');
    expect(sessionHolding("G:\\Rabaed Contech\\.claude\\worktrees\\main-3-snag-days", [{ ...main3, cwd: "G:\\Rabaed Contech" }], "win32")).toBeUndefined();
  });

  it("does not count a session in a worktree nested under .claude/worktrees as holding the checkout around it", () => {
    expect(sessionHolding("G:\\Rabaed Contech", [main3], "win32")).toBeUndefined();
    expect(sessionHolding("G:\\Rabaed Contech", [{ ...main3, cwd: "G:\\Rabaed Contech\\.claude" }], "win32")).toBe('session "Main 3" (pid 35408)');
  });

  it("compares case-sensitively elsewhere", () => {
    expect(sessionHolding("/w/Main-3", [{ ...main3, cwd: "/w/main-3" }], "linux")).toBeUndefined();
  });

  it("names a session with no name by its host or session id", () => {
    expect(sessionHolding("/w/a", [{ pid: 7, cwd: "/w/a", hostSessionId: "local_7", sessionId: "s-7" }], "linux")).toBe("session local_7 (pid 7)");
    expect(sessionHolding("/w/a", [{ pid: 7, cwd: "/w/a", sessionId: "s-7" }], "linux")).toBe("session s-7 (pid 7)");
    expect(sessionHolding("/w/a", [{ pid: 7, cwd: "/w/a" }], "linux")).toBe("a Claude session (pid 7)");
  });

  it("names every session holding it", () => {
    const other = { pid: 9, cwd: "/w/a/web", name: "Main 9" };
    expect(sessionHolding("/w/a", [{ pid: 7, cwd: "/w/a", name: "Main 7" }, other], "linux")).toBe('session "Main 7" (pid 7), session "Main 9" (pid 9)');
  });
});

// Process list injected: pid -> [parent pid, name, creation FILETIME]. 30 is this command's session
// (claude.exe under the desktop app 3104); 35408 and 41600 are other sessions, 60 a pid reused by
// another program, 70 a claude.exe whose start time drifted from its file's, 80 a CLI session run by
// node.exe (the npm-installed CLI), 90 a process named otherwise that started when its file says.
const table = new Map<number, [number, string, string?]>([
  [3104, [1, "claude.exe", "100"]],
  [30, [3104, "claude.exe", "130"]],
  // Win32_Process.CreationDate keeps microseconds: the session file's 100 ns digit is lost.
  [35408, [3104, "claude.exe", "134369144964016990"]],
  [41600, [3104, "claude.exe"]],
  [60, [1, "explorer.exe", "160"]],
  [70, [3104, "claude.exe", "999"]],
  [80, [1, "node.exe", "180"]],
  [90, [1, "bun.exe", "190"]],
]);
const processes: TimedProcessList = {
  parentOf: (pid) => table.get(pid)?.[0],
  nameOf: (pid) => table.get(pid)?.[1],
  isAlive: (pid) => table.has(pid),
  startOf: (pid) => table.get(pid)?.[2],
};
const file = (pid: number, cwd: string, extra: Partial<ClaudeSession> = {}) => ({ pid, session: { pid, cwd, ...extra } });

describe("sessionCheck", () => {
  it("keeps the live claude sessions whose start time matches", () => {
    const check = sessionCheck([file(35408, "/w/main-3", { procStart: "134369144964016992" }), file(41600, "/w/lane-b")], processes);
    expect(check).toEqual({ kind: "ok", sessions: [{ pid: 35408, cwd: "/w/main-3", procStart: "134369144964016992" }, { pid: 41600, cwd: "/w/lane-b" }] });
  });

  it("keeps a CLI session run by node.exe, and a claude whose start time drifted from its file's", () => {
    const check = sessionCheck([file(80, "/w/cli"), file(70, "/w/c", { procStart: "170" })], processes);
    expect(check).toEqual({ kind: "ok", sessions: [{ pid: 80, cwd: "/w/cli" }, { pid: 70, cwd: "/w/c", procStart: "170" }] });
  });

  it("keeps a process named otherwise whose start time matches its file's to the microsecond", () => {
    expect(sessionCheck([file(90, "/w/d", { procStart: "199" })], processes)).toEqual({ kind: "ok", sessions: [{ pid: 90, cwd: "/w/d", procStart: "199" }] });
  });

  it("drops dead pids, and a pid reused by another program: neither its start time nor its name matches", () => {
    const check = sessionCheck([file(999, "/w/a"), file(60, "/w/b"), file(60, "/w/b", { procStart: "170" }), file(90, "/w/d", { procStart: "290" })], processes);
    expect(check).toEqual({ kind: "ok", sessions: [] });
  });

  it("keeps this command's own session: its file's folder may be stale, and still names a folder it may come back to", () => {
    expect(sessionCheck([file(30, "/w/mine")], processes)).toEqual({ kind: "ok", sessions: [{ pid: 30, cwd: "/w/mine" }] });
  });

  it("cannot run when the file of a live pid cannot be read, whatever the process is named", () => {
    expect(sessionCheck([{ pid: 41600, unreadable: "41600.json is not JSON" }], processes)).toEqual({ kind: "unavailable", reason: "41600.json is not JSON" });
    expect(sessionCheck([{ pid: 60, unreadable: "60.json is not JSON" }], processes)).toEqual({ kind: "unavailable", reason: "60.json is not JSON" });
    expect(sessionCheck([{ pid: 999, unreadable: "999.json is not JSON" }], processes)).toEqual({ kind: "ok", sessions: [] });
  });
});

describe("heldReason", () => {
  const ok = { kind: "ok" as const, sessions: [main3] };
  const unavailable = { kind: "unavailable" as const, reason: "the process list could not be read" };

  it("names the running session holding the worktree", () => {
    expect(heldReason("G:\\Rabaed Contech\\.claude\\worktrees\\main-3-snag-days", ok, "win32")).toBe('a running Claude session is in it: session "Main 3" (pid 35408)');
    expect(heldReason("G:\\Rabaed Contech\\.claude\\worktrees\\agent-a", ok, "win32")).toBeUndefined();
  });

  it("holds every worktree when the check cannot run, and names why", () => {
    const why = "running Claude sessions could not be checked: the process list could not be read";
    expect(heldReason("G:\\w\\.claude\\worktrees\\main-4-inspections", unavailable, "win32")).toBe(why);
    expect(heldReason("/w/.claude/worktrees/orchestrator-main-retro/", unavailable, "linux")).toBe(why);
    expect(heldReason("/w/.claude/worktrees/agent-a", unavailable, "linux")).toBe(why);
    expect(heldReason("/w/.claude/worktrees/rp-1-mainline", unavailable, "linux")).toBe(why);
  });
});

describe("holdReason", () => {
  const runningIn = (held: string) => (path: string) => (path === held ? 'a running Claude session is in it: session "Main 9" (pid 9)' : undefined);
  const desktopIn =
    (held: string) =>
    (path: string): DesktopSession | undefined =>
      path === held ? { kind: "open", session: 'session "RP-9"' } : undefined;

  it("gives a running session first, then an open desktop session, then nothing", () => {
    const holders: Holders = { runningSession: runningIn("/w/a"), desktopSession: (path) => desktopIn("/w/a")(path) ?? desktopIn("/w/b")(path) };
    expect(holdReason("/w/a", holders)).toBe('a running Claude session is in it: session "Main 9" (pid 9)');
    expect(holdReason("/w/b", holders)).toBe('its Claude desktop session is open (session "RP-9"); archive it first');
    expect(holdReason("/w/c", holders)).toBeUndefined();
  });

  it("does not say to archive the desktop session when it opened since the list was shown", () => {
    const holders: Holders = { runningSession: () => undefined, desktopSession: desktopIn("/w/b") };
    expect(holdReason("/w/b", holders, { sinceListed: true })).toBe('its Claude desktop session is open (session "RP-9")');
  });

  it("holds a worktree when the desktop records cannot be read", () => {
    const holders: Holders = { runningSession: () => undefined, desktopSession: () => ({ kind: "unknown", reason: "list unreadable" }) };
    expect(holdReason("/w/c", holders)).toBe("a Claude desktop session may hold it: list unreadable");
  });
});

describe("readSessionFiles", () => {
  it("reads every <pid>.json and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-sessions-"));
    try {
      writeFileSync(join(dir, "35408.json"), JSON.stringify({ pid: 35408, cwd: "G:\\w", name: "Main 3" }));
      writeFileSync(join(dir, "35408.ab12.key"), "{ not json, and never read }");
      writeFileSync(join(dir, "notes.txt"), "x");
      expect(readSessionFiles(dir)).toEqual([{ pid: 35408, session: { pid: 35408, cwd: "G:\\w", name: "Main 3" } }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when the folder is missing", () => {
    expect(() => readSessionFiles(join(tmpdir(), "claude-sessions-none-9c1f"))).toThrow();
  });
});

describe("parseTimedProcessTable", () => {
  it("reads pid, parent, creation time and a name with spaces; a process with no time has none", () => {
    const list = parseTimedProcessTable("35408\t3104\t134369144964016990\tclaude.exe\r\n4\t0\t\tSystem Idle Process\r\n");
    expect([list.parentOf(35408), list.nameOf(35408), list.startOf?.(35408)]).toEqual([3104, "claude.exe", "134369144964016990"]);
    expect([list.isAlive(4), list.nameOf(4), list.startOf?.(4)]).toEqual([true, "System Idle Process", undefined]);
  });
});

describe("systemSessionCheck", () => {
  it("cannot run when the sessions folder or the process list cannot be read", () => {
    const missing = join(tmpdir(), "claude-sessions-none-9c1f");
    expect(systemSessionCheck(() => processes, missing)).toEqual({ kind: "unavailable", reason: `${missing} could not be read` });
    const dir = mkdtempSync(join(tmpdir(), "claude-sessions-"));
    try {
      expect(systemSessionCheck(() => undefined, dir)).toEqual({ kind: "unavailable", reason: "the process list could not be read" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseSessionFile", () => {
  it("keeps only pid, cwd, name, the ids and procStart", () => {
    const text = JSON.stringify({ pid: 35408, sessionId: "s", cwd: "G:\\w", procStart: "1", name: "Main 3", hostSessionId: "local_3", messagingSocketPath: "\\\\.\\pipe\\x", status: "idle" });
    expect(parseSessionFile("35408.json", text)).toEqual({ pid: 35408, session: { pid: 35408, cwd: "G:\\w", procStart: "1", name: "Main 3", sessionId: "s", hostSessionId: "local_3" } });
  });

  it("marks a file with no pid or cwd, or not JSON, unreadable under the pid of its name", () => {
    expect(parseSessionFile("12.json", "{")).toEqual({ pid: 12, unreadable: expect.stringContaining("12.json") });
    expect(parseSessionFile("12.json", JSON.stringify({ pid: 12 }))).toEqual({ pid: 12, unreadable: expect.stringContaining("12.json") });
  });
});
