import { execFileSync } from "node:child_process";

// RP-501: two sessions ran one spec because the second resumed the first's live worktree.
// The app locks a session's worktree with "claude session <name> (pid N)"; lane:env refuses
// when that pid is a live process that is not this process or one of its ancestors.
// The decision is pure over an injected process list; the real list is read below.

export type ProcessList = {
  /** The parent pid, or undefined when the pid is not running. */
  parentOf: (pid: number) => number | undefined;
  isAlive: (pid: number) => boolean;
};

/** The pid in a "claude session <name> (pid N)" lock reason; undefined for agent locks, hand locks and no lock. */
export function sessionLockPid(locked: string | undefined): number | undefined {
  const m = /^claude session\b.*\(pid (\d+)\)\s*$/i.exec(locked ?? "");
  return m ? Number(m[1]) : undefined;
}

/** The refusal text when a live session other than this one holds the worktree lock; undefined when lane:env may go on. */
export function foreignSessionLock(locked: string | undefined, ownPid: number, processes: ProcessList): string | undefined {
  const pid = sessionLockPid(locked);
  if (pid === undefined || !processes.isAlive(pid)) return undefined;
  const seen = new Set<number>();
  for (let p: number | undefined = ownPid; p !== undefined && !seen.has(p); p = processes.parentOf(p)) {
    if (p === pid) return undefined;
    seen.add(p);
  }
  const session = /^claude session (.*?) \(pid \d+\)\s*$/i.exec(locked ?? "")?.[1] ?? "";
  return `This worktree is locked by another live Claude session: ${session} (pid ${pid}). That session owns it, and its spec; do not set up a lane here, even with --force. Stop, or start your own session.`;
}

/** Reads lines of `pid ppid` into a process list. */
export function parseProcessTable(out: string): ProcessList {
  const parents = new Map<number, number>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) parents.set(Number(m[1]), Number(m[2]));
  }
  return { parentOf: (pid) => parents.get(pid), isAlive: (pid) => parents.has(pid) };
}

/** The running processes: `ps` on Unix, PowerShell's Win32_Process on Windows. Undefined when it cannot be read (then the guard does not block). */
export function readProcessList(): ProcessList | undefined {
  try {
    const out =
      process.platform === "win32"
        ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        : execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parseProcessTable(out);
  } catch {
    return undefined;
  }
}
