import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalPath } from "./paths.ts";
import { ancestors, isClaude, parseProcessTable, sessionPidOf, type ProcessList } from "./session-lock.ts";

// RP-956: worktrees:prune removed worktrees whose Claude session was still working in them.
// A session that moved into a worktree with EnterWorktree (every Main and the Orchestrator)
// leaves no git lock and no desktop worktree lease, so the scripts ask Claude Code itself:
// it writes ~/.claude/sessions/<pid>.json for each running session, with the session's
// working directory. A worktree is held while a running session's cwd is in it.
// Only the *.json files are read, never the *.key files beside them.

/** What this reads of one ~/.claude/sessions/<pid>.json; the rest is never kept. */
export type ClaudeSession = {
  pid: number;
  cwd: string;
  name?: string;
  sessionId?: string;
  hostSessionId?: string;
  /** The process's creation time as Windows FILETIME (UTC), a decimal string; guards against pid reuse. */
  procStart?: string;
};

/** One ~/.claude/sessions/<pid>.json: its session, or why it could not be read (under the pid in its name). */
export type SessionFile = { pid: number; session: ClaudeSession } | { pid: number; unreadable: string };

/** A process list that also knows each process's creation time (Windows FILETIME, UTC); undefined where it cannot tell. */
export type TimedProcessList = ProcessList & { startOf?: (pid: number) => string | undefined };

/**
 * The running sessions, or why they cannot be known. "unavailable" when the process list or
 * the sessions folder cannot be read, or a live session's file cannot.
 */
export type SessionCheck = { kind: "ok"; sessions: ClaudeSession[] } | { kind: "unavailable"; reason: string };

/** Two FILETIMEs (decimal strings) in the same microsecond: Win32_Process.CreationDate drops the last 100 ns digit. */
const sameMicrosecond = (a: string, b: string): boolean => /^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(a) / 10n === BigInt(b) / 10n;

const text = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);

/** Reads one session file's text, keeping only pid, cwd, name, sessionId, hostSessionId and procStart. */
export function parseSessionFile(fileName: string, content: string): SessionFile {
  const pid = Number(/^(\d+)\.json$/i.exec(fileName)?.[1]);
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { pid, unreadable: `${fileName} is not JSON` };
  }
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const cwd = text(j.cwd);
  if (!Number.isInteger(j.pid) || cwd === undefined) return { pid, unreadable: `${fileName} has no pid or cwd` };
  const session: ClaudeSession = { pid: j.pid as number, cwd };
  for (const key of ["name", "sessionId", "hostSessionId", "procStart"] as const) {
    const value = text(j[key]);
    if (value !== undefined) session[key] = value;
  }
  return { pid: session.pid, session };
}

/**
 * The sessions of the files that run now, other than this command's own: the pid is alive and a
 * `claude` process, started when the file says (when both sides know it: pids are reused), and is
 * neither sessionPid (CLAUDE_PID) nor an ancestor of ownPid or sessionPid. A file that cannot be
 * read while its pid is a live claude makes the check unavailable: that session may hold anything.
 */
export function sessionCheck(files: SessionFile[], processes: TimedProcessList, ownPid: number, sessionPid?: number): SessionCheck {
  const own = new Set([...ancestors(ownPid, processes), ...(sessionPid === undefined ? [] : ancestors(sessionPid, processes))]);
  const running = (pid: number) => processes.isAlive(pid) && isClaude(pid, processes) && !own.has(pid);
  const sessions: ClaudeSession[] = [];
  for (const f of files) {
    if (!running(f.pid)) continue;
    if ("unreadable" in f) return { kind: "unavailable", reason: f.unreadable };
    const started = processes.startOf?.(f.pid);
    if (f.session.procStart !== undefined && started !== undefined && !sameMicrosecond(started, f.session.procStart)) continue;
    sessions.push(f.session);
  }
  return { kind: "ok", sessions };
}

/** The folder names of the worktrees a Main or the Orchestrator works in (planning/parallel-sessions.md). */
const isMainWorktree = (path: string): boolean => /^(main|orchestrator)-/i.test(path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "");

/**
 * Why the worktree at path is held by a running Claude session, or undefined. When the
 * sessions cannot be checked, a main-* or orchestrator-* worktree is held (a Main's session
 * moves in with EnterWorktree and leaves no other trace); any other is left to the other checks.
 */
export function heldReason(path: string, check: SessionCheck, platform: NodeJS.Platform = process.platform): string | undefined {
  if (check.kind === "unavailable") {
    return isMainWorktree(path) ? `a Main or the Orchestrator may be working in it, and the running sessions could not be checked (${check.reason})` : undefined;
  }
  const holder = sessionHolding(path, check.sessions, platform);
  return holder === undefined ? undefined : `a running Claude session is in it: ${holder}`;
}

/** How a session is named in a reason: its name, else its host or session id, with its pid. */
export function describeSession(s: ClaudeSession): string {
  const id = s.name ? `"${s.name}"` : (s.hostSessionId ?? s.sessionId);
  return id ? `session ${id} (pid ${s.pid})` : `a Claude session (pid ${s.pid})`;
}

/**
 * Whether path is folder or inside it, but not inside a worktree nested in it: the app makes
 * worktrees under <main>/.claude/worktrees/, and a session there works in that worktree, not the main checkout.
 */
const within = (path: string, folder: string, platform: NodeJS.Platform): boolean => {
  const p = normalPath(path, platform);
  const f = normalPath(folder, platform);
  if (f === "" || (p !== f && !p.startsWith(`${f}/`))) return false;
  return !`${p}/`.slice(f.length).startsWith("/.claude/worktrees/");
};

/**
 * The running sessions (already filtered to live, foreign ones) whose working directory is
 * the worktree at path or inside it, described; undefined when none is.
 */
export function sessionHolding(path: string, sessions: ClaudeSession[], platform: NodeJS.Platform = process.platform): string | undefined {
  const holders = sessions.filter((s) => within(s.cwd, path, platform));
  return holders.length === 0 ? undefined : holders.map(describeSession).join(", ");
}

/** Where Claude Code writes a file per running session. */
export const claudeSessionsDir = (): string => join(homedir(), ".claude", "sessions");

/** Every <pid>.json in dir (never the *.key files beside them). Throws when dir cannot be read, or is missing. */
export function readSessionFiles(dir: string = claudeSessionsDir()): SessionFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d+\.json$/i.test(f))
    .map((f) => {
      try {
        return parseSessionFile(f, readFileSync(join(dir, f), "utf8"));
      } catch {
        return { pid: Number(/^\d+/.exec(f)?.[0]), unreadable: `${f} could not be read` };
      }
    });
}

/** Reads lines of `pid<TAB>ppid<TAB>FILETIME<TAB>name` (Win32_Process, below) into a process list with creation times. */
export function parseTimedProcessTable(out: string): TimedProcessList {
  const starts = new Map<number, string>();
  const rows: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\t(\d+)\t(\d*)\t(.*)$/.exec(line);
    if (!m) continue;
    if (m[3]) starts.set(Number(m[1]), m[3]);
    rows.push(`${m[1]} ${m[2]} ${m[4]}`);
  }
  return { ...parseProcessTable(rows.join("\n")), startOf: (pid) => starts.get(pid) };
}

/**
 * The running processes with their creation times on Windows (Win32_Process; elsewhere `ps`, with
 * no times, so pid reuse is caught by the process name alone). Throws when they cannot be read.
 */
export function readTimedProcessList(): TimedProcessList {
  if (process.platform !== "win32") {
    return parseProcessTable(execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  }
  const query = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() })`t$($_.Name)" }';
  return parseTimedProcessTable(execFileSync("powershell.exe", ["-NoProfile", "-Command", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}

/**
 * The real check: the session files against the process list (read by readProcesses, so a caller
 * that has one already passes it), excluding this command's own session (CLAUDE_PID and this
 * process's ancestors). "unavailable" when either cannot be read.
 */
export function systemSessionCheck(readProcesses: () => TimedProcessList = readTimedProcessList, dir: string = claudeSessionsDir()): SessionCheck {
  let files: SessionFile[];
  try {
    files = readSessionFiles(dir);
  } catch {
    return { kind: "unavailable", reason: `${dir} could not be read` };
  }
  let processes: TimedProcessList;
  try {
    processes = readProcesses();
  } catch {
    return { kind: "unavailable", reason: "the process list could not be read" };
  }
  return sessionCheck(files, processes, process.pid, sessionPidOf(process.env));
}
