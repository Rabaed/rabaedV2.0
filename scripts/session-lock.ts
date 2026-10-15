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

/**
 * The refusal text when a live session other than this one holds the worktree lock; undefined when lane:env may go on.
 * sessionPid is this session's own claude pid (CLAUDE_PID, which Claude Code sets for its tools): Git Bash on Windows
 * detaches its processes (parent pid 1), so from the Bash tool the ancestor chain never reaches the session's claude.exe.
 */
export function foreignSessionLock(locked: string | undefined, ownPid: number, processes: ProcessList, sessionPid?: number): string | undefined {
  const lock = parseSessionLock(locked);
  if (!lock || !processes.isAlive(lock.pid)) return undefined;
  if (!isClaude(lock.pid, processes)) return undefined;
  if (lock.pid === sessionPid) return undefined;
  for (const p of ancestors(ownPid, processes)) if (p === lock.pid) return undefined;
  return `This worktree is locked by another live Claude session: ${lock.name} (pid ${lock.pid}). That session owns it, and its spec; do not set up a lane here, even with --force. Stop, or start your own session.`;
}

/** This session's claude pid from CLAUDE_PID, or undefined when it is not set (not run by Claude Code). */
export function sessionPidOf(env: Record<string, string | undefined>): number | undefined {
  const pid = Number(env.CLAUDE_PID);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * RP-545: the hint for a lane port held by a process of this very session (its own `pnpm demo` / `pnpm dev`), which
 * blocks the implementers' `lane:env --db` runs; undefined when the holder is not in this session's process tree.
 * The tree is the holder's parent chain reaching this session's claude: sessionPid (CLAUDE_PID), else the first
 * `claude` process among ownPid's ancestors. Never higher: the desktop app above it also parents other sessions.
 */
export function ownServerHint(
  port: number,
  holderPid: number,
  ownPid: number,
  processes: ProcessList,
  sessionPid?: number,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const session = sessionPid ?? [...ancestors(ownPid, processes)].find((p) => p > 1 && isClaude(p, processes));
  if (session === undefined) return undefined;
  if (![...ancestors(holderPid, processes)].slice(1).includes(session)) return undefined;
  // /f: a windowless node process refuses a plain taskkill ("can only be terminated forcefully").
  const stop = platform === "win32" ? `taskkill /pid ${holderPid} /t /f` : `kill ${holderPid}`;
  return `Port ${port} is held by this session's own dev server (${processes.nameOf(holderPid) ?? "process"}, pid ${holderPid}), probably its pnpm demo or pnpm dev. Stop it with \`${stop}\`, or run it after the implementers finish or on another lane.`;
}

/** pid, then its parent, grandparent and so on, stopping at a pid that is not running or one already seen. */
function* ancestors(pid: number, processes: ProcessList): Generator<number> {
  const seen = new Set<number>();
  for (let p: number | undefined = pid; p !== undefined && !seen.has(p); p = processes.parentOf(p)) {
    seen.add(p);
    yield p;
  }
}

function isClaude(pid: number, processes: ProcessList): boolean {
  return /^claude(\.exe)?$/i.test(processes.nameOf(pid) ?? "");
}

/** Whether the pid is a running `claude` process: a lock naming it belongs to a live session or agent (pids are reused). */
export const isLiveClaude = (pid: number, processes: ProcessList): boolean => processes.isAlive(pid) && isClaude(pid, processes);

/** The pid listening on a TCP port, or undefined when none is found or it cannot be read. */
export function listeningPid(port: number): number | undefined {
  try {
    const out =
      process.platform === "win32"
        ? execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        : execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const pid = Number(out.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
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

/** Every running process's command line (RP-585: whether one holds a worktree's folder). Throws when they cannot be read. */
export function readCommandLines(): string[] {
  const out =
    process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
      : execFileSync("ps", ["-A", "-o", "args="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return out.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** The running processes: `ps` on Unix, PowerShell's Win32_Process on Windows. Throws when they cannot be read (lane:env then warns and goes on). */
export function readProcessList(): ProcessList {
  const out =
    process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)\" }"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      : execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return parseProcessTable(out);
}
