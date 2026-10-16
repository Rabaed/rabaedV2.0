import { execFileSync } from "node:child_process";
import { normalPath } from "./paths.ts";
import { readProcessList } from "./session-lock.ts";

// The dev servers one worktree started (RP-568): node processes whose command line runs a
// file under that worktree's node_modules (web, api, admin, Storybook), with the ports they
// listen on. `pnpm servers:stop` and `pnpm worktrees:clean` stop them. A process is
// attributed to the deepest worktree whose folder holds the file, so the main folder never
// claims a lane worktree's servers under .claude/worktrees/. Never Docker: only node.
// The decision (serversOf) and the parsers are pure; the OS lookups are below.

export type ServerProcess = { pid: number; name: string; commandLine: string };

/** A dev server: its process and the TCP ports it listens on. */
export type Server = ServerProcess & { ports: number[] };

const isNode = (name: string) => /^node(\.exe)?$/i.test(name);

/** The files a command line names: quoted, or bare runs without spaces. */
function pathsIn(commandLine: string): string[] {
  return [...commandLine.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** The deepest worktree folder holding the path, or undefined. Paths are normalPath'd. */
function ownerOf(path: string, worktrees: string[]): string | undefined {
  let best: string | undefined;
  for (const w of worktrees) if ((path === w || path.startsWith(`${w}/`)) && (best === undefined || w.length > best.length)) best = w;
  return best;
}

/**
 * The node processes running a file under the worktree's node_modules (its own, or a
 * package's: apps/api/node_modules/...). worktrees: every worktree of the clone, so a file
 * under a nested worktree (.claude/worktrees/x in the main folder) counts as that one's.
 * skip: pids to leave out (this command and its ancestors).
 */
export function serversOf(processes: ServerProcess[], worktree: string, worktrees: string[], platform: NodeJS.Platform = process.platform, skip: ReadonlySet<number> = new Set()): ServerProcess[] {
  const dir = normalPath(worktree, platform);
  const roots = [...new Set([...worktrees.map((w) => normalPath(w, platform)), dir])];
  return processes.filter(
    (p) =>
      isNode(p.name) &&
      !skip.has(p.pid) &&
      pathsIn(p.commandLine).some((raw) => {
        const path = normalPath(raw, platform);
        return ownerOf(path, roots) === dir && path.slice(dir.length).includes("/node_modules/");
      }),
  );
}

/** Parses `pid<TAB>name<TAB>command line` lines; the command line keeps any tabs of its own. */
export function parseProcesses(out: string): ServerProcess[] {
  const list: ServerProcess[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\t([^\t]*)\t(.*)$/.exec(line);
    if (m) list.push({ pid: Number(m[1]), name: m[2]!.replace(/^.*[\\/]/, ""), commandLine: m[3]! });
  }
  return list;
}

/** Parses `port pid` lines into the listening ports of each pid, sorted and without duplicates. */
export function parseListeningPorts(out: string): Map<number, number[]> {
  const ports = new Map<number, Set<number>>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[2]);
    ports.set(pid, (ports.get(pid) ?? new Set()).add(Number(m[1])));
  }
  return new Map([...ports].map(([pid, set]) => [pid, [...set].sort((a, b) => a - b)]));
}

/** `lsof -F pn` output (a `p<pid>` line, then `n<address>:<port>` lines) as `port pid` lines for parseListeningPorts. */
export function lsofToPortLines(out: string): string {
  const lines: string[] = [];
  let pid = "";
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("p")) pid = line.slice(1);
    else if (line.startsWith("n") && pid) {
      const port = /:(\d+)$/.exec(line)?.[1];
      if (port) lines.push(`${port} ${pid}`);
    }
  }
  return lines.join("\n");
}

/** The command that stops a server: its whole tree, forcefully, on Windows (a windowless node refuses a plain taskkill); SIGTERM elsewhere. */
export const stopCommand = (pid: number, platform: NodeJS.Platform = process.platform): [string, string[]] =>
  platform === "win32" ? ["taskkill", ["/pid", String(pid), "/t", "/f"]] : ["kill", [String(pid)]];

/** One line naming a server for the output: pid, ports and what it runs. */
export function describeServer(s: Server): string {
  const ports = s.ports.length > 0 ? `port${s.ports.length === 1 ? "" : "s"} ${s.ports.join(", ")}` : "no port";
  const runs = s.commandLine.length > 140 ? `${s.commandLine.slice(0, 137)}...` : s.commandLine;
  return `pid ${s.pid}, ${ports}: ${runs}`;
}

const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

/** Every running process with its command line. Throws when they cannot be read. */
export function readProcesses(): ServerProcess[] {
  return parseProcesses(
    process.platform === "win32"
      ? run("powershell.exe", ["-NoProfile", "-Command", 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)" }'])
      : run("ps", ["-A", "-o", "pid=,comm=,args="]).replace(/^\s*(\d+)\s+(\S+)\s+/gm, "$1\t$2\t"),
  );
}

/** The TCP ports each pid listens on; empty when they cannot be read (the servers are still stopped, their ports just not named). */
export function readListeningPorts(): Map<number, number[]> {
  try {
    return parseListeningPorts(
      process.platform === "win32"
        ? // eslint-disable-next-line rabaed/no-avoid-terms -- Get-NetTCPConnection's own -State parameter, not our term
          run("powershell.exe", ["-NoProfile", "-Command", 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalPort) $($_.OwningProcess)" }'])
        : lsofToPortLines(run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"])),
    );
  } catch {
    return new Map();
  }
}

/** This process and its ancestors (pnpm, the shell): never stopped. */
export function ownTree(): Set<number> {
  const skip = new Set<number>([process.pid]);
  try {
    const list = readProcessList();
    for (let p = list.parentOf(process.pid); p !== undefined && !skip.has(p); p = list.parentOf(p)) skip.add(p);
  } catch {
    if (process.ppid) skip.add(process.ppid);
  }
  return skip;
}

/** The dev servers of each target worktree right now, with their ports; the processes are read once. Throws when they cannot be read. */
export function findServersOf(targets: string[], worktrees: string[]): Map<string, Server[]> {
  if (targets.length === 0) return new Map();
  const processes = readProcesses();
  const ports = readListeningPorts();
  const skip = ownTree();
  return new Map(targets.map((t) => [t, serversOf(processes, t, worktrees, process.platform, skip).map((p) => ({ ...p, ports: ports.get(p.pid) ?? [] }))]));
}

/** The dev servers of one worktree right now, with their ports. */
export const findServers = (worktree: string, worktrees: string[]): Server[] => findServersOf([worktree], worktrees).get(worktree) ?? [];

/** Stops each server; returns those it could not stop, with why. A server already gone counts as stopped. */
export function stopServers(servers: Server[]): { server: Server; reason: string }[] {
  const failed: { server: Server; reason: string }[] = [];
  for (const s of servers) {
    const [file, args] = stopCommand(s.pid);
    try {
      run(file, args);
    } catch (error) {
      if (stillRunning(s.pid)) failed.push({ server: s, reason: (error as { stderr?: string }).stderr?.trim() || String(error) });
    }
  }
  return failed;
}

function stillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}
