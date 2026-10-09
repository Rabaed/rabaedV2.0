import { execFileSync } from "node:child_process";

// RP-501: two sessions ran one spec because the second resumed the first's live worktree.
// The app locks a session's worktree with "claude session <name> (pid N)"; lane:env refuses
// when that pid is a live process that is not this process or one of its ancestors.
// Pids are reused (Windows especially) and stale locks with dead pids are common, so a lock's
// live pid only counts when that process is itself `claude` / `claude.exe`.
// The decision is pure over an injected process list; the real list is read below.

export type ProcessList = {
  /** The parent pid, or undefined when the pid is not running. */
  parentOf: (pid: number) => number | undefined;
  /** The process name (`claude.exe`, `node`), or undefined when the pid is not running. */
  nameOf: (pid: number) => string | undefined;
  isAlive: (pid: number) => boolean;
};

/** The session name and pid in a "claude session <name> (pid N)" lock reason; undefined for agent locks, hand locks and no lock. */
export function parseSessionLock(locked: string | undefined): { name: string; pid: number } | undefined {
  const m = /^claude session (.*?)\s*\(pid (\d+)\)\s*$/i.exec(locked ?? "");
  return m ? { name: m[1], pid: Number(m[2]) } : undefined;
}

/** The refusal text when a live session other than this one holds the worktree lock; undefined when lane:env may go on. */
export function foreignSessionLock(locked: string | undefined, ownPid: number, processes: ProcessList): string | undefined {
  const lock = parseSessionLock(locked);
  if (!lock || !processes.isAlive(lock.pid)) return undefined;
  if (!/^claude(\.exe)?$/i.test(processes.nameOf(lock.pid) ?? "")) return undefined;
  const seen = new Set<number>();
  for (let p: number | undefined = ownPid; p !== undefined && !seen.has(p); p = processes.parentOf(p)) {
    if (p === lock.pid) return undefined;
    seen.add(p);
  }
  return `This worktree is locked by another live Claude session: ${lock.name} (pid ${lock.pid}). That session owns it, and its spec; do not set up a lane here, even with --force. Stop, or start your own session.`;
}

/** Reads lines of `pid ppid name` into a process list. */
export function parseProcessTable(out: string): ProcessList {
  const parents = new Map<number, number>();
  const names = new Map<number, string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)(?:\s+(.+?))?\s*$/.exec(line);
    if (!m) continue;
    parents.set(Number(m[1]), Number(m[2]));
    if (m[3]) names.set(Number(m[1]), m[3].replace(/^.*[\\/]/, ""));
  }
  return { parentOf: (pid) => parents.get(pid), nameOf: (pid) => names.get(pid), isAlive: (pid) => parents.has(pid) };
}

/** The running processes: `ps` on Unix, PowerShell's Win32_Process on Windows. Throws when they cannot be read (lane:env then warns and goes on). */
export function readProcessList(): ProcessList {
  const out =
    process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)\" }"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      : execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return parseProcessTable(out);
}
