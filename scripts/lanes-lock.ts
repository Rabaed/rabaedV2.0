import { execFileSync } from "node:child_process";
import { closeSync, linkSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

// One lane:env at a time per clone (RP-1007). On 2026-10-21 two `lane:env --free` runs started two
// seconds apart and both chose lane 33: neither had written its .env when the other looked. lane:env
// holds this lock from reading the lanes until its .env is written, so a second run waits and then
// sees the first run's .env (lanes.ts envClaims). The file lives in the clone's common git folder,
// which every worktree of the clone shares.

export type LockDeps = {
  pid: number;
  now: () => number;
  /** Whether the run holding the lock still runs. */
  alive: (pid: number) => boolean;
  sleep: (ms: number) => void;
};

type Options = {
  /** How long to wait for another run before giving up. */
  waitMs?: number;
  /** A lock older than this is a leftover, whatever its pid (a pid can be reused). */
  staleMs?: number;
};

const POLL_MS = 200;

/** Reads the holder's pid and time, or undefined for a file that is not a lock (half-written, or by hand). */
function readHolder(file: string): { pid: number; at: number } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; at?: unknown };
    return typeof parsed.pid === "number" && typeof parsed.at === "number" ? { pid: parsed.pid, at: parsed.at } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates file holding text, only if it does not exist yet: the text goes to a file of this run's
 * own first and is hard-linked into place, so another run never sees the lock half-written.
 */
function createWith(file: string, text: string, pid: number): boolean {
  const own = `${file}.${pid}.tmp`;
  const fd = openSync(own, "w");
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(own, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(own, { force: true });
  }
}

/**
 * Removes a stale lock, but only the one that was judged stale: it is moved aside first, and when
 * what moved is not that lock (another waiter took over in between) it is put back.
 */
export function removeStale(file: string, judged: string | undefined, pid: number): void {
  const aside = `${file}.${pid}.stale`;
  try {
    renameSync(file, aside);
  } catch {
    return; // Gone already: another waiter removed it.
  }
  let moved: string | undefined;
  try {
    moved = readFileSync(aside, "utf8");
  } catch {
    moved = undefined;
  }
  if (moved !== judged) {
    try {
      linkSync(aside, file);
    } catch {
      // A third run has created the lock meanwhile; it holds it.
    }
  }
  rmSync(aside, { force: true });
}

/**
 * Takes the lock at file, waiting while another run that still runs holds it. A lock whose run is
 * gone, that is older than staleMs, or that cannot be read is taken over. Gives up after waitMs with
 * the refusal to print. release() removes the lock only while it is still this run's.
 */
export function acquireLaneLock(file: string, deps: LockDeps, { waitMs = 120_000, staleMs = 600_000 }: Options = {}): { release: () => void } | { error: string } {
  const started = deps.now();
  for (;;) {
    if (createWith(file, JSON.stringify({ pid: deps.pid, at: deps.now() }), deps.pid)) {
      return {
        release: () => {
          if (readHolder(file)?.pid === deps.pid) rmSync(file, { force: true });
        },
      };
    }
    let text: string | undefined;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // Removed since: try again.
    }
    const holder = readHolder(file);
    if (holder === undefined || !deps.alive(holder.pid) || deps.now() - holder.at > staleMs) {
      removeStale(file, text, deps.pid);
      continue;
    }
    if (deps.now() - started >= waitMs) {
      return { error: `Another pnpm lane:env (pid ${holder.pid}) is choosing a lane in this clone; wait for it to finish and re-run. If it is gone, delete ${file}.` };
    }
    deps.sleep(POLL_MS);
  }
}

/** Whether a process with this pid runs (one we may not signal still runs). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const pause = new Int32Array(new SharedArrayBuffer(4));

/** The real dependencies: this process, the clock, the process table and a blocking sleep. */
export const systemLockDeps = (): LockDeps => ({
  pid: process.pid,
  now: Date.now,
  alive: pidAlive,
  sleep: (ms) => {
    Atomics.wait(pause, 0, 0, ms);
  },
});

/** The lock file of the clone the folder belongs to: in its common git folder, shared by all its worktrees. */
export function laneLockFile(cwd: string = process.cwd()): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return join(common, "rabaed-lane-env.lock");
}
