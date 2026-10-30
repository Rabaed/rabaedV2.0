import { execFileSync } from "node:child_process";

// When a process started, as the OS says (RP-1136). Windows reuses pids quickly, so a lock
// that names a pid also records the holder's start time, and a live pid that started at
// another time is someone else. Undefined when the time can't be read (no such process,
// no access, no ps): callers then trust the pid alone.

/** 100-ns ticks between 1601-01-01 (FILETIME's epoch) and 1970-01-01. */
const FILETIME_EPOCH = 116_444_736_000_000_000n;

/** PowerShell's `StartTime.ToFileTimeUtc()` output as a date. */
export function fromFileTime(text: string): Date | undefined {
  const digits = text.trim();
  if (!/^\d+$/.test(digits)) return undefined;
  return new Date(Number((BigInt(digits) - FILETIME_EPOCH) / 10_000n));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `ps -o lstart=` output in the C locale ("Fri Oct 30 11:47:30 2026", local time) as a date. */
export function fromLstart(text: string): Date | undefined {
  const match = /^\w{3} +(\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text.trim());
  if (!match) return undefined;
  const [, month, day, hours, minutes, seconds, year] = match;
  const index = MONTHS.indexOf(month!);
  return index < 0 ? undefined : new Date(Number(year), index, Number(day), Number(hours), Number(minutes), Number(seconds));
}

const run = (command: string, args: string[], env?: NodeJS.ProcessEnv): string | undefined => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000, windowsHide: true, ...(env ? { env } : {}) });
  } catch {
    return undefined; // no such process, no access, or no ps/PowerShell
  }
};

/** When the process with this pid started; undefined when that can't be read. */
export function processStart(pid: number): Date | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "win32") {
    const text = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`]);
    return text === undefined ? undefined : fromFileTime(text);
  }
  const text = run("ps", ["-o", "lstart=", "-p", String(pid)], { ...process.env, LC_ALL: "C" });
  return text === undefined ? undefined : fromLstart(text);
}
