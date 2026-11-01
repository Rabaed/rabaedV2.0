import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, liveHolder, type LockHolder, type Processes } from "./verify-lock.ts";

// RP-1197: never two full `pnpm verify` runs at once on one machine. On 2026-10-29 and again on 2026-10-31
// many verifies at once starved Docker and the CPU, and per-worktree and per-Main locks (RP-996, RP-1096)
// could not see a run in another clone. The line lives in one folder outside every clone: `verify.lock`
// (the run that is verifying; acquireLock / releaseLock of verify-lock.ts, so a dead or reused pid is taken
// over as before) and `line/<time>-<pid>.json`, one place per waiting run, first come first served.
// Only the first live place tries for the lock, so the order holds. Each waiter prints where it stands
// ("waiting behind lane 13 (#577), position 2") and the line changes as the line moves.

/** The folder of the machine-wide line: `RABAED_VERIFY_DIR` when set (tests), else `rabaed-verify` in the OS temp folder: outside any clone, one per user, and cleared with a reboot, which leaves no run to wait for anyway. */
export function machineDir(env: Record<string, string | undefined> = process.env, temp: string = tmpdir()): string {
  const set = env.RABAED_VERIFY_DIR;
  return set !== undefined && set !== "" ? set : join(temp, "rabaed-verify");
}

/** The lock of the run that is verifying now. */
export const machineLockFile = (dir: string): string => join(dir, "verify.lock");
const lineDir = (dir: string): string => join(dir, "line");
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const placeName = (time: number, pid: number) => `${pad(time, 15)}-${pad(pid, 10)}.json`;

/** "lane 13 (#577)": the run by its lane and PR; "pid 4100" when its lock names no lane. */
export function describeRun({ lane, pr, pid }: LockHolder): string {
  const who = lane === undefined || lane === "" ? `pid ${pid}` : `lane ${lane}`;
  return pr === undefined ? who : `${who} (#${pr})`;
}

/**
 * What a waiting run prints. `ahead` is every live run in front of it, the verifying one first;
 * its position is one more than that, and it names the run directly in front.
 */
export function turnMessage(ahead: LockHolder[]): string {
  const last = ahead[ahead.length - 1];
  return last === undefined ? "waiting for the verify line" : `waiting behind ${describeRun(last)}, position ${ahead.length + 1}`;
}

/** What the line holds now: the run verifying, and the live places in order. */
export type MachineLine = { holder?: LockHolder; waiting: LockHolder[] };

const placeNames = (dir: string): string[] => {
  try {
    return readdirSync(lineDir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
};

/**
 * The live run verifying and the live waiters, read only (a stale place is left for the waiters to clear). `self` is the caller,
 * whose own pid and ancestors never count.
 */
export function readLine(dir: string, self: LockHolder, processes: Processes): MachineLine {
  const holder = liveHolder(machineLockFile(dir), self, processes);
  const waiting: LockHolder[] = [];
  for (const name of placeNames(dir)) {
    const place = liveHolder(join(lineDir(dir), name), self, processes);
    if (place !== undefined && place.pid !== holder?.pid && !waiting.some((w) => w.pid === place.pid)) waiting.push(place);
  }
  return { ...(holder === undefined ? {} : { holder }), waiting };
}

/** Deletes every place of `pid` (the exit hook: a run stopped with Ctrl-C leaves no place in the line). */
export function removePlaces(dir: string, pid: number): void {
  for (const name of placeNames(dir)) if (name.endsWith(`-${pad(pid, 10)}.json`)) rmSync(join(lineDir(dir), name), { force: true });
}

export type TurnDeps = {
  processes: Processes;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** A line for the run's output: when it starts waiting, when its place changes, and every reportEveryMs. */
  report: (line: string) => void;
  pollMs?: number;
  reportEveryMs?: number;
};

/**
 * Takes the machine's verify lock for `self`: takes a place in line, waits until it is the first live place
 * and the lock is free (or its holder stale, which is taken over), then returns holding the lock with
 * the place gone. Never gives up: the run in front ends some time, and Ctrl-C stops the wait.
 */
export async function waitForTurn(
  dir: string,
  self: LockHolder,
  { processes, now, sleep, report, pollMs = 5_000, reportEveryMs = 600_000 }: TurnDeps,
): Promise<{ waitedMs: number; tookOver?: string }> {
  mkdirSync(lineDir(dir), { recursive: true });
  const start = now();
  const own = placeName(start, self.pid);
  const ownFile = join(lineDir(dir), own);
  writeFileSync(ownFile, JSON.stringify({ ...self, started: self.started.toISOString(), pidStarted: self.pidStarted?.toISOString() }));
  let said: string | undefined;
  let nextReport = start + reportEveryMs;
  try {
    for (;;) {
      const ahead: LockHolder[] = [];
      for (const name of placeNames(dir)) {
        if (name === own) break;
        const file = join(lineDir(dir), name);
        const place = liveHolder(file, self, processes);
        if (place === undefined) rmSync(file, { force: true });
        else if (!ahead.some((a) => a.pid === place.pid)) ahead.push(place);
      }
      let hint = "";
      if (ahead.length === 0) {
        const result = acquireLock(machineLockFile(dir), self, processes);
        if (result.acquired) return { waitedMs: now() - start, ...(result.tookOver === undefined ? {} : { tookOver: result.tookOver }) };
        // A holder whose pid alone decided: the message says how to free it by hand.
        if (/ delete /.test(result.message)) hint = ` ${result.message}`;
      }
      const holder = liveHolder(machineLockFile(dir), self, processes);
      const message = turnMessage(holder === undefined ? ahead : [holder, ...ahead.filter((a) => a.pid !== holder.pid)]);
      if (message !== said) {
        report(`Verify turn: ${message}.${hint}`);
        said = message;
        nextReport = now() + reportEveryMs;
      } else if (now() >= nextReport) {
        report(`Verify turn: still ${message} (${Math.floor((now() - start) / 60_000)} min).`);
        nextReport = now() + reportEveryMs;
      }
      await sleep(pollMs);
    }
  } finally {
    rmSync(ownFile, { force: true });
  }
}
