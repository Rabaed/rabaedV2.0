import { execFileSync } from "node:child_process";

// When a process started, as the OS says, and which processes it was started from (RP-1136).
// Windows reuses pids quickly, so a lock that names a pid also records the holder's start time,
// and a live pid that started at another time is someone else. Undefined (or an empty chain)
// when it can't be read (no such process, no access, no ps): callers then trust the pid alone.

/** 100-ns ticks between 1601-01-01 (FILETIME's epoch) and 1970-01-01. */
const FILETIME_EPOCH = 116_444_736_000_000_000n;

/** PowerShell's `StartTime.ToFileTimeUtc()` output as a date. */
export function fromFileTime(text: string): Date | undefined {
  const digits = text.trim();
  if (!/^\d+$/.test(digits)) return undefined;
  return new Date(Number((BigInt(digits) - FILETIME_EPOCH) / 10_000n));
}

/**
 * `ps -o etime=` output ("[[dd-]hh:]mm:ss", on Linux and macOS) as the start time it implies at `now`.
 * Elapsed time, not ps's local-time lstart, so a TZ or DST change can't move it.
 */
export function fromElapsed(text: string, now: number): Date | undefined {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim());
  if (!match) return undefined;
  const [, days = "0", hours = "0", minutes, seconds] = match;
  const elapsed = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return new Date(Math.floor(now / 1000) * 1000 - elapsed * 1000);
}

/** One pid per line, first to last; non-numbers and pids up to 0 dropped. */
export function pidLines(text: string): number[] {
  return text
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

const run = (command: string, args: string[]): string | undefined => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000, windowsHide: true });
  } catch {
    return undefined; // no such process, no access, or no ps/PowerShell
  }
};
const powershell = (command: string) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
const validPid = (pid: number) => Number.isInteger(pid) && pid > 0;

/** When the process with this pid started; undefined when that can't be read. */
export function processStart(pid: number): Date | undefined {
  if (!validPid(pid)) return undefined;
  if (process.platform === "win32") {
    const text = powershell(`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`);
    return text === undefined ? undefined : fromFileTime(text);
  }
  const text = run("ps", ["-o", "etime=", "-p", String(pid)]);
  return text === undefined ? undefined : fromElapsed(text, Date.now());
}

/** The processes `pid` was started from, its parent first (at most 32); empty when that can't be read. */
export function processAncestors(pid: number): number[] {
  if (!validPid(pid)) return [];
  let text: string | undefined;
  if (process.platform === "win32") {
    // One PowerShell for the whole chain. Windows keeps a dead parent's pid as ParentProcessId and may
    // give it to another process, so the walk stops at a "parent" that started after its child.
    text = powershell(
      `$c = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; for ($i = 0; $c -and $i -lt 32; $i++) { if ($c.ParentProcessId -eq $c.ProcessId) { break }; $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.ParentProcessId)"; if (-not $p -or $p.CreationDate -gt $c.CreationDate) { break }; $p.ProcessId; $c = $p }`,
    );
  } else {
    const chain: number[] = [];
    for (let p = pid; chain.length < 32; ) {
      const parent = pidLines(run("ps", ["-o", "ppid=", "-p", String(p)]) ?? "")[0];
      if (parent === undefined) break;
      chain.push(parent);
      p = parent;
    }
    return chain;
  }
  return pidLines(text ?? "");
}
