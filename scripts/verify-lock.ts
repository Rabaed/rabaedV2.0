import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One `pnpm verify` per worktree (RP-996): two runs in one worktree share the lane's
// databases and fail each other. The lock is a file in the worktree, so verify in two
// worktrees still runs side by side. The pid check is passed in, so it is unit-tested.

/** Who holds the lock: the verify process, when it started and how it was started. */
export type LockHolder = { pid: number; started: Date; command: string };

/** Taken (`tookOver` says whose stale lock it replaced), or refused with a message naming the holder. */
export type LockResult = { acquired: true; tookOver?: string } | { acquired: false; message: string };

/** The worktree's lock file; `.gitignore` names it (and its `.verify.lock.*` temp files), so it never counts as a changed file. */
export function lockFile(worktree: string): string {
  return join(worktree, ".verify.lock");
}

const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const describeHolder = ({ pid, started, command }: LockHolder) => `pid ${pid}, started ${hhmm(started)}, \`${command}\``;
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** Links `from` to `file`; false when `file` is already there. */
function link(from: string, file: string): boolean {
  try {
    linkSync(from, file);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * Creates the lock file for `self`, false when one is already there. It is written to a temp file
 * beside it and linked into place, so a reader never sees a live run's lock empty.
 */
function create(file: string, self: LockHolder): boolean {
  const temp = `${file}.${self.pid}`;
  writeFileSync(temp, JSON.stringify({ ...self, started: self.started.toISOString() }));
  try {
    return link(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

/** The run named in a lock's text; undefined when it is gone or unreadable. */
function parseHolder(text: string | undefined): LockHolder | undefined {
  try {
    const stored = JSON.parse(text ?? "") as { pid: number; started: string; command: string };
    return Number.isInteger(stored.pid) ? { ...stored, started: new Date(stored.started) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Removes the stale lock whose text was `staleText`, unless another run replaced it since: it is
 * moved aside first, and a lock that turns out not to be the stale one is linked back. False then.
 */
function removeStale(file: string, staleText: string | undefined, pid: number): boolean {
  const aside = `${file}.${pid}.stale`;
  try {
    renameSync(file, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
  try {
    if (readText(aside) === staleText) return true;
    link(aside, file); // when a lock is there again, that run holds it now
    return false;
  } finally {
    rmSync(aside, { force: true });
  }
}

const refusal = (holder: LockHolder) => `verify already running (${describeHolder(holder)}).`;
const refuseCurrent = (file: string): LockResult => {
  const holder = parseHolder(readText(file));
  return { acquired: false, message: holder ? refusal(holder) : `verify could not take ${file}; run it again.` };
};

/**
 * Takes the lock for `self`, or refuses with a message naming the live run that holds it. A lock
 * whose pid `isAlive` denies (or that cannot be read) is stale and taken over once; if another run
 * took it over first, even between the read and the takeover, that run is the holder.
 */
export function acquireLock(file: string, self: LockHolder, isAlive: (pid: number) => boolean): LockResult {
  if (create(file, self)) return { acquired: true };
  const staleText = readText(file);
  const stale = parseHolder(staleText);
  if (stale && isAlive(stale.pid)) return { acquired: false, message: refusal(stale) };
  if (!removeStale(file, staleText, self.pid) || !create(file, self)) return refuseCurrent(file);
  return { acquired: true, tookOver: stale ? `took over a stale lock (${describeHolder(stale)}): that process is gone.` : "took over an unreadable lock." };
}

/** Removes the lock if `pid` holds it; a lock another run took (over) is left alone. */
export function releaseLock(file: string, pid: number): void {
  if (parseHolder(readText(file))?.pid === pid) rmSync(file, { force: true });
}
