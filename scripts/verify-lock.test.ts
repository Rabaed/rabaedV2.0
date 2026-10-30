import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, lockFile, mainSlot, releaseLock, waitForLock, type LockHolder, type Processes } from "./verify-lock.ts";

// A fresh worktree folder per test (in the OS temp folder, never a real lock); the lock goes where verify.ts puts it.
const worktree = () => mkdtempSync(join(tmpdir(), "verify-lock-"));
// These holders record no pidStarted, as a lock written before RP-1136 does: the pid alone decides.
const first = { pid: 4100, started: new Date(2026, 9, 20, 9, 5), command: "pnpm verify" };
const second = { pid: 4200, started: new Date(2026, 9, 20, 9, 40), command: "pnpm verify" };
const third = { pid: 4300, started: new Date(2026, 9, 20, 9, 41), command: "pnpm verify seam" };
/** The injected process check: which pids run, and (by default) no start time readable. */
const pids = (isAlive: (pid: number) => boolean, startOf: (pid: number) => Date | undefined = () => undefined): Processes => ({ isAlive, startOf });
const alive = pids(() => true);

describe("acquireLock", () => {
  it("refuses a second run in the same worktree and names the holder", () => {
    const file = lockFile(worktree());
    expect(acquireLock(file, first, alive)).toEqual({ acquired: true });
    expect(acquireLock(file, second, alive)).toEqual({
      acquired: false,
      message: expect.stringContaining("verify already running (pid 4100, started 09:05, `pnpm verify`)"),
    });
  });

  it("takes over a lock whose pid is no longer alive, and says so", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const dead = (pid: number) => pid !== first.pid;
    expect(acquireLock(file, second, pids(dead))).toEqual({
      acquired: true,
      tookOver: expect.stringContaining("stale lock (pid 4100, started 09:05, `pnpm verify`)"),
    });
    // The new run holds it now: a third run is refused, naming the second.
    expect(acquireLock(file, third, alive)).toEqual({ acquired: false, message: expect.stringContaining("pid 4200, started 09:40") });
  });

  it("takes over an empty or corrupt lock", () => {
    for (const content of ["", "{not json"]) {
      const file = lockFile(worktree());
      writeFileSync(file, content);
      expect(acquireLock(file, second, alive)).toEqual({ acquired: true, tookOver: "took over an unreadable lock." });
      expect(acquireLock(file, third, alive)).toEqual({ acquired: false, message: expect.stringContaining("pid 4200") });
    }
  });

  it("never removes a live lock another run put in place of the stale one it read, and names that run", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    // Between reading the stale lock and taking it over, a third run takes it over first.
    const raced = (pid: number) => {
      expect(acquireLock(file, third, pids((other) => other !== first.pid))).toEqual({ acquired: true, tookOver: expect.any(String) });
      return pid !== first.pid;
    };
    expect(acquireLock(file, second, pids(raced))).toEqual({ acquired: false, message: expect.stringContaining("verify already running (pid 4300, started 09:41, `pnpm verify seam`)") });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: third.pid });
  });

  it("leaves only the lock file in the worktree, taken or refused", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    acquireLock(file, second, alive);
    acquireLock(file, third, pids((pid) => pid !== first.pid));
    expect(readdirSync(dirname(file))).toEqual([".verify.lock"]);
  });

  it("lets verify in two different worktrees run side by side", () => {
    const [a, b] = [worktree(), worktree()];
    expect(lockFile(a)).not.toBe(lockFile(b));
    expect(acquireLock(lockFile(a), first, alive)).toEqual({ acquired: true });
    expect(acquireLock(lockFile(b), second, alive)).toEqual({ acquired: true });
  });
});

describe("acquireLock with a reused pid (RP-1136)", () => {
  // On 2026-10-30 Windows gave a finished verify's pid (17880) to a new verify, which then waited 2 hours on itself.
  const at = (hours: number, minutes: number, seconds = 0) => new Date(2026, 9, 30, hours, minutes, seconds);
  const holder: LockHolder = { pid: 17880, started: at(11, 47), pidStarted: at(11, 46, 58), command: "pnpm verify in rp-1096" };
  const waiter: LockHolder = { pid: 2560, started: at(13, 13), pidStarted: at(13, 12, 59), command: "pnpm verify in rp-1092" };
  const runs = (isAlive: (pid: number) => boolean, starts: Record<number, Date>, ancestors?: number[]): Processes => ({
    isAlive,
    startOf: (pid) => starts[pid],
    ...(ancestors ? { ancestors } : {}),
  });

  it("takes over a lock whose pid is alive but started at another time, and says so", () => {
    const file = lockFile(worktree());
    acquireLock(file, holder, alive);
    expect(acquireLock(file, waiter, runs(() => true, { 17880: at(13, 13, 1) }))).toEqual({
      acquired: true,
      tookOver: "took over a stale lock (pid 17880, started 11:47, `pnpm verify in rp-1096`): pid 17880 is now another process, started 13:13.",
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: waiter.pid, pidStarted: waiter.pidStarted!.toISOString() });
  });

  it("never waits on a lock naming its own pid, whatever its start time says", () => {
    const file = lockFile(worktree());
    acquireLock(file, holder, alive);
    const reused = { ...waiter, pid: holder.pid };
    expect(acquireLock(file, reused, runs(() => true, { 17880: holder.pidStarted! }))).toEqual({
      acquired: true,
      tookOver: "took over a stale lock (pid 17880, started 11:47, `pnpm verify in rp-1096`): its pid is this run's own.",
    });
  });

  it("never waits on a lock naming a process this run was started from, its parent's parent included", () => {
    const file = lockFile(worktree());
    acquireLock(file, { ...holder, pidStarted: undefined }, alive);
    expect(acquireLock(file, waiter, runs(() => true, {}, [3010, 17880]))).toEqual({
      acquired: true,
      tookOver: "took over a stale lock (pid 17880, started 11:47, `pnpm verify in rp-1096`): its pid is a process this run was started from.",
    });
  });

  it("refuses while the pid is alive and started when the lock says, give or take a second", () => {
    const file = lockFile(worktree());
    acquireLock(file, holder, alive);
    const sameRun = runs(() => true, { 17880: new Date(holder.pidStarted!.getTime() + 900) });
    expect(acquireLock(file, waiter, sameRun)).toEqual({ acquired: false, message: "verify already running (pid 17880, started 11:47, `pnpm verify in rp-1096`)." });
  });

  it("takes over a lock whose start time is just over 2 seconds off", () => {
    for (const offset of [2_001, -2_001]) {
      const file = lockFile(worktree());
      acquireLock(file, holder, alive);
      const reused = runs(() => true, { 17880: new Date(holder.pidStarted!.getTime() + offset) });
      expect(acquireLock(file, waiter, reused)).toMatchObject({ acquired: true, tookOver: expect.stringContaining("is now another process") });
    }
  });

  it("trusts the pid alone when the lock's stored start time is not a date", () => {
    const file = lockFile(worktree());
    writeFileSync(file, JSON.stringify({ pid: 17880, started: holder.started.toISOString(), pidStarted: "not a date", command: "pnpm verify" }));
    expect(acquireLock(file, waiter, runs(() => true, { 17880: at(11, 46, 58) }))).toEqual({
      acquired: false,
      message: expect.stringContaining("Its lock records no process start time"),
    });
  });

  it("takes over a lock from before RP-1136 (no start time) whose pid started after the lock was taken", () => {
    // RP-1137's lock: pid 17880 took it at 11:47; the pid's process now started at 13:13, so it is another one.
    const file = lockFile(worktree());
    acquireLock(file, { ...holder, pidStarted: undefined }, alive);
    expect(acquireLock(file, waiter, runs(() => true, { 17880: at(13, 13) }))).toEqual({
      acquired: true,
      tookOver: "took over a stale lock (pid 17880, started 11:47, `pnpm verify in rp-1096`): pid 17880 is now another process, started 13:13.",
    });
  });

  it("keeps waiting on a lock from before RP-1136 whose pid started before the lock was taken, and says how to free it", () => {
    const file = lockFile(worktree());
    acquireLock(file, { ...holder, pidStarted: undefined }, alive);
    expect(acquireLock(file, waiter, runs(() => true, { 17880: at(11, 46, 58) }))).toEqual({
      acquired: false,
      message: `verify already running (pid 17880, started 11:47, \`pnpm verify in rp-1096\`). Its lock records no process start time, so a reused pid can't be told apart: if pid 17880 is not a verify run, delete ${file}.`,
    });
  });

  it("trusts the pid alone when the start time can't be read now, and says how to free it", () => {
    const file = lockFile(worktree());
    acquireLock(file, holder, alive);
    expect(acquireLock(file, waiter, runs(() => true, {}))).toEqual({
      acquired: false,
      message: `verify already running (pid 17880, started 11:47, \`pnpm verify in rp-1096\`). This run could not read pid 17880's start time, so a reused pid can't be told apart: if pid 17880 is not a verify run, delete ${file}.`,
    });
  });

  it("still takes over a lock whose pid is gone without reading any start time", () => {
    const file = lockFile(worktree());
    acquireLock(file, holder, alive);
    const startOf = (pid: number): Date | undefined => {
      throw new Error(`read the start of pid ${pid}`);
    };
    expect(acquireLock(file, waiter, { isAlive: () => false, startOf })).toMatchObject({ acquired: true, tookOver: expect.stringContaining("that process is gone") });
  });
});

describe("releaseLock", () => {
  it("frees the worktree for the next run", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    releaseLock(file, first.pid);
    expect(acquireLock(file, second, alive)).toEqual({ acquired: true });
  });

  it("never removes a lock another run holds", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    releaseLock(file, second.pid);
    expect(acquireLock(file, second, alive)).toEqual({ acquired: false, message: expect.stringContaining("pid 4100") });
  });
});

describe("mainSlot", () => {
  const git = "G:/Rabaed Contech/.git";

  it("is one file per Main in the clone's common git folder, shared by its lanes", () => {
    expect(mainSlot(git, "31")).toEqual({ file: join(git, "rabaed-verify-main3.lock"), name: "Main 3's verify slot" });
    expect(mainSlot(git, "34").file).toBe(mainSlot(git, "31").file);
    // Main 3 itself (lane 30) and the legacy lane 3 share Main 3's slot too.
    expect(mainSlot(git, "30").file).toBe(mainSlot(git, "31").file);
    expect(mainSlot(git, "3").file).toBe(mainSlot(git, "31").file);
  });

  it("lets two Mains verify side by side", () => {
    expect(mainSlot(git, "41").file).not.toBe(mainSlot(git, "31").file);
    expect(mainSlot(git, "7")).toEqual({ file: join(git, "rabaed-verify-main7.lock"), name: "Main 7's verify slot" });
  });

  it("gives the main folder (lane 0, or no lane) a slot of its own", () => {
    expect(mainSlot(git, "0")).toEqual({ file: join(git, "rabaed-verify-main-folder.lock"), name: "the main folder's verify slot" });
    expect(mainSlot(git, "").file).toBe(mainSlot(git, "0").file);
  });
});

describe("waitForLock", () => {
  /** A clock that sleeps by moving on; `onSleep` runs after each sleep (to free the lock, say). */
  const clock = (onSleep: (sleeps: number) => void = () => {}) => {
    let now = 0;
    let sleeps = 0;
    return {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
        onSleep(++sleeps);
      },
    };
  };

  it("takes a free lock at once and says nothing", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    expect(await waitForLock(file, first, { processes: alive, ...clock(), report: (l) => lines.push(l), slot: "Main 3's verify slot" })).toEqual({ waitedMs: 0 });
    expect(lines).toEqual([]);
  });

  it("waits while another verify holds it, saying whose turn it is, and takes it once released", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const time = clock((sleeps) => sleeps === 40 && releaseLock(file, first.pid));
    const result = await waitForLock(file, second, { processes: pids(() => true, () => new Date(2026, 9, 20, 9, 4)), ...time, report: (l) => lines.push(l), slot: "Main 3's verify slot", pollMs: 30_000, reportEveryMs: 600_000 });
    expect(result).toEqual({ waitedMs: 40 * 30_000 });
    // An old-format lock (no start time): the pid alone decides, and the line says how to free it by hand.
    expect(lines[0]).toBe(
      `Waiting for Main 3's verify slot: verify already running (pid 4100, started 09:05, \`pnpm verify\`). Its lock records no process start time, so a reused pid can't be told apart: if pid 4100 is not a verify run, delete ${file}. One verify per Main runs at a time (RP-1096).`,
    );
    // Then a line every 10 minutes, not every poll.
    expect(lines.slice(1)).toEqual(["Still waiting for Main 3's verify slot (10 min)."]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: second.pid });
  });

  it("names the new holder when another run takes the slot first", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const time = clock((sleeps) => {
      if (sleeps === 1) {
        releaseLock(file, first.pid);
        acquireLock(file, third, alive);
      }
      if (sleeps === 2) releaseLock(file, third.pid);
    });
    await waitForLock(file, second, { processes: alive, ...time, report: (l) => lines.push(l), slot: "Main 3's verify slot" });
    expect(lines[1]).toContain("pid 4300, started 09:41");
  });

  it("takes over a lock whose verify is gone without waiting", async () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const result = await waitForLock(file, second, { processes: pids((pid) => pid !== first.pid), ...clock(), report: () => {}, slot: "Main 3's verify slot" });
    expect(result).toEqual({ waitedMs: 0, tookOver: expect.stringContaining("stale lock (pid 4100") });
  });

  it("takes over the slot at once when its pid now belongs to another process, the waiting run included (RP-1136)", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    const gone = { ...first, pidStarted: new Date(2026, 9, 30, 11, 46, 58) };
    acquireLock(file, gone, alive);
    // The OS gave pid 4100 to this very run.
    const me = { ...second, pid: first.pid, pidStarted: new Date(2026, 9, 30, 13, 12, 59) };
    const processes = pids(() => true, () => me.pidStarted);
    const result = await waitForLock(file, me, { processes, ...clock(), report: (l) => lines.push(l), slot: "Main 3's verify slot" });
    expect(result).toEqual({ waitedMs: 0, tookOver: expect.stringContaining("its pid is this run's own") });
    expect(lines).toEqual([]);
  });

  it("waits on a live holder whose start time matches, with no advice to delete the lock", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    const live = { ...first, pidStarted: new Date(2026, 9, 30, 11, 46, 58) };
    acquireLock(file, live, alive);
    const time = clock((sleeps) => sleeps === 1 && releaseLock(file, first.pid));
    await waitForLock(file, second, { processes: pids(() => true, () => live.pidStarted), ...time, report: (l) => lines.push(l), slot: "Main 3's verify slot" });
    expect(lines).toEqual(["Waiting for Main 3's verify slot: verify already running (pid 4100, started 09:05, `pnpm verify`). One verify per Main runs at a time (RP-1096)."]);
  });
});
