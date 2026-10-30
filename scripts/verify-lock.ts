import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One `pnpm verify` per worktree (RP-996): two runs in one worktree share the lane's
// databases and fail each other. The lock is a file in the worktree, so verify in two
// worktrees still runs side by side. The pid check is passed in, so it is unit-tested.
// RP-1096 adds each Main's one verify slot (mainSlot): a second verify among a Main's lanes waits for it.

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

/**
 * A Main's one verify slot (RP-1096; the owner chose one per Main, as planning/parallel-sessions.md's
 * staged restart says): a lock file in the clone's common git folder, shared by the Main's lanes mL
 * (and m0, and the legacy lane m). On 2026-10-29 many verify runs at once pushed the machine to 98% CPU
 * and seam suites ran past 3 hours. `lane` is the .env's lane ("31"); lane 0 or none is the main folder's.
 */
export function mainSlot(commonGitDir: string, lane: string): { file: string; name: string } {
  const n = Number(lane);
  if (lane === "" || !Number.isInteger(n) || n === 0) return { file: join(commonGitDir, "rabaed-verify-main-folder.lock"), name: "the main folder's verify slot" };
  const main = n >= 10 ? Math.floor(n / 10) : n;
  return { file: join(commonGitDir, `rabaed-verify-main${main}.lock`), name: `Main ${main}'s verify slot` };
}

export type WaitDeps = {
  isAlive: (pid: number) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** A line for the run's output: when it starts waiting, when the holder changes, and every reportEveryMs. */
  report: (line: string) => void;
  /** The slot's name in those lines ("Main 3's verify slot"). */
  slot: string;
  pollMs?: number;
  reportEveryMs?: number;
};

/**
 * Takes the lock for `self`, waiting while another live run holds it (a stale one is taken over at
 * once, as acquireLock does). Never gives up: the run holding it ends some time, and Ctrl-C stops the wait.
 */
export async function waitForLock(
  file: string,
  self: LockHolder,
  { isAlive, now, sleep, report, slot, pollMs = 30_000, reportEveryMs = 600_000 }: WaitDeps,
): Promise<{ waitedMs: number; tookOver?: string }> {
  const start = now();
  let said: string | undefined;
  let nextReport = start + reportEveryMs;
  for (;;) {
    const result = acquireLock(file, self, isAlive);
    if (result.acquired) return { waitedMs: now() - start, ...(result.tookOver === undefined ? {} : { tookOver: result.tookOver }) };
    if (result.message !== said) {
      // A hard-killed run never releases its lock, and Windows reuses pids: say which file to delete then.
      report(`Waiting for ${slot}: ${result.message} One verify per Main runs at a time (RP-1096); if that pid is not a verify run, delete ${file}.`);
      said = result.message;
      nextReport = now() + reportEveryMs;
    } else if (now() >= nextReport) {
      report(`Still waiting for ${slot} (${Math.floor((now() - start) / 60_000)} min).`);
      nextReport = now() + reportEveryMs;
    }
    await sleep(pollMs);
  }
}

/** Removes the lock if `pid` holds it; a lock another run took (over) is left alone. */
export function releaseLock(file: string, pid: number): void {
  if (parseHolder(readText(file))?.pid === pid) rmSync(file, { force: true });
}
