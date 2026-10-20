import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One `pnpm verify` per worktree (RP-996): two runs in one worktree share the lane's
// databases and fail each other. The lock is a file in the worktree, so verify in two
// worktrees still runs side by side. The pid check is passed in, so it is unit-tested.

/** Who holds the lock: the verify process, when it started and how it was started. */
export type LockHolder = { pid: number; started: Date; command: string };

/** Taken (`tookOver` says whose stale lock it replaced), or refused with a message naming the holder. */
export type Acquired = { acquired: true; tookOver?: string } | { acquired: false; message: string };

/** The worktree's lock file; `.gitignore` names it, so it never counts as a changed file. */
export function lockFile(worktree: string): string {
  return join(worktree, ".verify.lock");
}

const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const describeHolder = ({ pid, started, command }: LockHolder) => `pid ${pid}, started ${hhmm(started)}, \`${command}\``;

/** Creates the lock file for `self`; false when one is already there. */
function create(file: string, self: LockHolder): boolean {
  try {
    writeFileSync(file, JSON.stringify({ ...self, started: self.started.toISOString() }), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** The run named in the lock file; undefined when it is gone or unreadable (a run killed mid-write). */
function readHolder(file: string): LockHolder | undefined {
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as { pid: number; started: string; command: string };
    return Number.isInteger(stored.pid) ? { ...stored, started: new Date(stored.started) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes the lock for `self`, or refuses with a message naming the live run that holds it. A lock
 * whose pid `isAlive` denies (or that cannot be read) is stale: it is removed and taken over once;
 * if another run took it over first, that run is the holder.
 */
export function acquireLock(file: string, self: LockHolder, isAlive: (pid: number) => boolean): Acquired {
  if (create(file, self)) return { acquired: true };
  const stale = readHolder(file);
  if (stale && isAlive(stale.pid)) return { acquired: false, message: refusal(stale) };
  rmSync(file, { force: true });
  const tookOver = stale ? `took over a stale lock (${describeHolder(stale)}): that process is gone.` : "took over an unreadable lock.";
  if (create(file, self)) return { acquired: true, tookOver };
  const holder = readHolder(file);
  return { acquired: false, message: holder ? refusal(holder) : `verify could not take ${file}; run it again.` };
}

const refusal = (holder: LockHolder) => `verify already running (${describeHolder(holder)}).`;

/**
 * Whether a process with `pid` runs: signal 0 only checks. ESRCH means no such process; EPERM (a
 * live process this user may not signal, which Windows also reports) counts as alive.
 */
export function pidAlive(pid: number, kill: (pid: number, signal: number) => unknown = process.kill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Removes the lock if `pid` holds it; a lock another run took (over) is left alone. */
export function releaseLock(file: string, pid: number): void {
  if (readHolder(file)?.pid === pid) rmSync(file, { force: true });
}
