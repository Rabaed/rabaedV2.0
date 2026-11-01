import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { processStart } from "./process-start.ts";
import { describeHolder, liveHolder, lockFile, type LockHolder, type Processes } from "./verify-lock.ts";
import { addByPid, describeRun, machineDir, machineLockFile, OLD_SLOT, readLine } from "./verify-queue.ts";
import { isRunning } from "./worktrees-stale.ts";
import { listWorktrees } from "./worktrees.ts";

// RP-1170, rule 4: volumes are removed only when no `pnpm verify` runs anywhere on the machine.
// On 2026-10-31 `pnpm worktrees:prune --yes` removed 372 stories volumes while lanes verified:
// 361 failed with `spawnSync docker ETIMEDOUT` and Docker's volume API hung, stalling new stacks;
// a bulk `docker volume rm` during verifies had hung it once before. A verify holds its worktree's
// `.verify.lock` and its Main's slot (verify-lock.ts), so any live holder of either means one runs.
// When the locks cannot be read, the volumes stay too.

/** A lock file and where it is, for the message. */
export type VerifyLock = { where: string; file: string };
export type VerifyRun = { where: string; holder: LockHolder };
/** `waiting` (RP-1197): runs queued behind the machine-wide verify, each about to verify; absent when none. */
export type VerifyCheck = { runs: VerifyRun[]; waiting?: VerifyRun[] } | { unknown: string };


/** The machine-wide verify lock (RP-1197, when `machineDirectory` is given), every worktree's `.verify.lock`, then the Mains' verify slots among the common git folder's files. */
export function verifyLockFiles(worktrees: string[], commonGitDir: string, commonFiles: string[], machineDirectory?: string): VerifyLock[] {
  return [
    ...(machineDirectory === undefined ? [] : [{ where: "the machine-wide verify line", file: machineLockFile(machineDirectory) }]),
    ...worktrees.map((path) => ({ where: path, file: lockFile(path) })),
    ...commonFiles.filter((name) => OLD_SLOT.test(name)).map((name) => ({ where: `the verify slot ${name}`, file: join(commonGitDir, name) })),
  ];
}

/** The live holders of the locks (holderOf: verify-lock.ts liveHolder), one entry per pid. */
export function runningVerifies(locks: VerifyLock[], holderOf: (file: string) => LockHolder | undefined): VerifyRun[] {
  const runs: VerifyRun[] = [];
  for (const lock of locks) {
    const holder = holderOf(lock.file);
    if (holder !== undefined) addByPid(runs, { where: lock.where, holder }, (run) => run.holder.pid);
  }
  return runs;
}

export const describeRuns = (runs: VerifyRun[]): string =>
  `${runs.length === 1 ? "a verify runs" : `${runs.length} verifies run`} (${runs.map((r) => `${describeHolder(r.holder)}, in ${r.where}`).join("; ")})`;

/** The runs queued behind the verifying one (RP-1197): "2 waiting (lane 13 (#577), in the machine-wide verify line; ...)". */
export const describeWaiting = (waiting: VerifyRun[]): string =>
  `${waiting.length} waiting (${waiting.map((r) => `${describeRun(r.holder)}, in ${r.where}`).join("; ")})`;

/** Why no volume may be removed now, or undefined when none runs and none waits (a waiting run verifies soon). */
export const volumesKeptReason = (check: VerifyCheck): string | undefined => {
  if ("unknown" in check) return `whether a verify runs could not be checked (${check.unknown})`;
  const waiting = check.waiting ?? [];
  if (check.runs.length === 0 && waiting.length === 0) return undefined;
  return [check.runs.length > 0 ? describeRuns(check.runs) : undefined, waiting.length > 0 ? describeWaiting(waiting) : undefined].filter(Boolean).join("; ");
};

/** The running verifies of this clone, read now; `unknown` when git or the lock folder could not be read. */
export function verifiesRunningNow(cwd: string = process.cwd()): VerifyCheck {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const worktrees = listWorktrees(cwd).map((w) => w.path);
    const processes: Processes = { isAlive: isRunning, startOf: processStart, ancestors: [] };
    const self: LockHolder = { pid: process.pid, started: new Date(), command: "a clean-up" };
    const dir = machineDir();
    const runs = runningVerifies(verifyLockFiles(worktrees, common, readdirSync(common), dir), (file) => liveHolder(file, self, processes));
    const queued = readLine(dir, self, processes).waiting.filter((w) => !runs.some((r) => r.holder.pid === w.pid));
    return queued.length === 0 ? { runs } : { runs, waiting: queued.map((holder) => ({ where: "the machine-wide verify line", holder })) };
  } catch (error) {
    return { unknown: ((error as { stderr?: string }).stderr || (error as Error).message || String(error)).split("\n")[0]!.trim() };
  }
}
