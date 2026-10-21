import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
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
 * Takes the lock at file, waiting while another run that still runs holds it. A lock whose run is
 * gone, that is older than staleMs, or that cannot be read is taken over. Gives up after waitMs with
 * the refusal to print. release() removes the lock only while it is still this run's.
 */
export function acquireLaneLock(file: string, deps: LockDeps, { waitMs = 120_000, staleMs = 600_000 }: Options = {}): { release: () => void } | { error: string } {
  const started = deps.now();
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: deps.pid, at: deps.now() }));
      } finally {
        closeSync(fd);
      }
      return {
        release: () => {
          if (readHolder(file)?.pid === deps.pid) rmSync(file, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readHolder(file);
    if (holder === undefined || !deps.alive(holder.pid) || deps.now() - holder.at > staleMs) {
      rmSync(file, { force: true });
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
