import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, liveHolder, serializeHolder, type LockHolder, type Processes } from "./verify-lock.ts";

// In this file "line" is the machine-wide verify queue: the glossary lint forbids that word in identifiers, so the
// line, a place in it and a run's turn are what the code and its messages call it.
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

/** Adds `item` to `list` unless one with its pid (`pidOf`) is already there: one run can hold several locks. */
export function addByPid<T>(list: T[], item: T, pidOf: (item: T) => number): void {
  if (!list.some((x) => pidOf(x) === pidOf(item))) list.push(item);
}
const holderPid = (holder: LockHolder): number => holder.pid;

/** A file name among the common git folder's: a Main's verify slot from before the machine-wide line (RP-1096), or the main folder's. */
export const OLD_SLOT = /^rabaed-verify-.+\.lock$/;

/** The old per-Main slot files among `names` (a git folder's files), as full paths. */
export const oldSlotFiles = (commonGitDir: string, names: string[]): string[] => names.filter((name) => OLD_SLOT.test(name)).map((name) => join(commonGitDir, name));

/** The old slot files of the clone at `cwd`, read now; none when git or its folder cannot be read (the machine-wide lock then stands alone). */
export function oldSlotsOf(cwd: string): string[] {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return oldSlotFiles(common, readdirSync(common));
  } catch {
    return [];
  }
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
    if (place !== undefined && place.pid !== holder?.pid) addByPid(waiting, place, holderPid);
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
  /**
   * The old per-Main slot files (oldSlotFiles; RP-1096) that a verify from before this line may still hold.
   * A live holder is ahead of every new run, so an old-branch verify and a new one never run together.
   */
  oldSlots?: string[];
};

/**
 * Takes the machine's verify lock for `self`: takes a place in line, waits until it is the first live place
 * and the lock is free (or its holder stale, which is taken over), then returns holding the lock with
 * the place gone. Never gives up: the run in front ends some time, and Ctrl-C stops the wait.
 */
export async function waitForTurn(
  dir: string,
  self: LockHolder,
  { processes, now, sleep, report, pollMs = 5_000, reportEveryMs = 600_000, oldSlots = [] }: TurnDeps,
): Promise<{ waitedMs: number; tookOver?: string }> {
  mkdirSync(lineDir(dir), { recursive: true });
  const start = now();
  const own = placeName(start, self.pid);
  const ownFile = join(lineDir(dir), own);
  writeFileSync(ownFile, serializeHolder(self));
  let said: string | undefined;
  let nextReport = start + reportEveryMs;
  try {
    for (;;) {
      const old: LockHolder[] = [];
      for (const file of oldSlots) {
        const slotHolder = liveHolder(file, self, processes);
        if (slotHolder !== undefined) addByPid(old, slotHolder, holderPid);
      }
      const ahead: LockHolder[] = [...old];
      for (const name of placeNames(dir)) {
        if (name === own) break;
        const file = join(lineDir(dir), name);
        const place = liveHolder(file, self, processes);
        if (place === undefined) rmSync(file, { force: true });
        else addByPid(ahead, place, holderPid);
      }
      let hint = "";
      if (ahead.length === 0) {
        const result = acquireLock(machineLockFile(dir), self, processes);
        if (result.acquired) return { waitedMs: now() - start, ...(result.tookOver === undefined ? {} : { tookOver: result.tookOver }) };
        // A holder whose pid alone decided: the message says how to free it by hand.
        if (/ delete /.test(result.message)) hint = ` ${result.message}`;
      }
      const holder = liveHolder(machineLockFile(dir), self, processes);
      const front = holder === undefined ? ahead : [holder, ...ahead.filter((a) => a.pid !== holder.pid)];
      const inFront = front[front.length - 1];
      const message = turnMessage(front) + (inFront !== undefined && old.some((o) => o.pid === inFront.pid) ? " (it holds a Main's old verify slot)" : "");
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
