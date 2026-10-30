import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, lockFile, machineLockFile, releaseLock, waitForLock } from "./verify-lock.ts";

// A fresh worktree folder per test; the lock goes where verify.ts puts it.
const worktree = () => mkdtempSync(join(tmpdir(), "verify-lock-"));
const first = { pid: 4100, started: new Date(2026, 9, 20, 9, 5), command: "pnpm verify" };
const second = { pid: 4200, started: new Date(2026, 9, 20, 9, 40), command: "pnpm verify" };
const third = { pid: 4300, started: new Date(2026, 9, 20, 9, 41), command: "pnpm verify seam" };
const alive = () => true;

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
    expect(acquireLock(file, second, dead)).toEqual({
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
      expect(acquireLock(file, third, (other) => other !== first.pid)).toEqual({ acquired: true, tookOver: expect.any(String) });
      return pid !== first.pid;
    };
    expect(acquireLock(file, second, raced)).toEqual({ acquired: false, message: expect.stringContaining("verify already running (pid 4300, started 09:41, `pnpm verify seam`)") });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: third.pid });
  });

  it("leaves only the lock file in the worktree, taken or refused", () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    acquireLock(file, second, alive);
    acquireLock(file, third, (pid) => pid !== first.pid);
    expect(readdirSync(dirname(file))).toEqual([".verify.lock"]);
  });

  it("lets verify in two different worktrees run side by side", () => {
    const [a, b] = [worktree(), worktree()];
    expect(lockFile(a)).not.toBe(lockFile(b));
    expect(acquireLock(lockFile(a), first, alive)).toEqual({ acquired: true });
    expect(acquireLock(lockFile(b), second, alive)).toEqual({ acquired: true });
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

describe("machineLockFile", () => {
  it("is one file in the clone's common git folder, the same for every worktree of it", () => {
    expect(machineLockFile("G:/Rabaed Contech/.git")).toBe(join("G:/Rabaed Contech/.git", "rabaed-verify-machine.lock"));
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
    expect(await waitForLock(file, first, { isAlive: alive, ...clock(), report: (l) => lines.push(l) })).toEqual({ waitedMs: 0 });
    expect(lines).toEqual([]);
  });

  it("waits while another verify holds it, saying whose turn it is, and takes it once released", async () => {
    const lines: string[] = [];
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const time = clock((sleeps) => sleeps === 40 && releaseLock(file, first.pid));
    const result = await waitForLock(file, second, { isAlive: alive, ...time, report: (l) => lines.push(l), pollMs: 30_000, reportEveryMs: 600_000 });
    expect(result).toEqual({ waitedMs: 40 * 30_000 });
    expect(lines[0]).toBe(
      `Waiting for the machine's verify slot: verify already running (pid 4100, started 09:05, \`pnpm verify\`). One verify runs at a time (RP-1096); if that pid is not a verify run, delete ${file}.`,
    );
    // Then a line every 10 minutes, not every poll.
    expect(lines.slice(1)).toEqual(["Still waiting for the machine's verify slot (10 min)."]);
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
    await waitForLock(file, second, { isAlive: alive, ...time, report: (l) => lines.push(l) });
    expect(lines[1]).toContain("pid 4300, started 09:41");
  });

  it("takes over a lock whose verify is gone without waiting", async () => {
    const file = lockFile(worktree());
    acquireLock(file, first, alive);
    const result = await waitForLock(file, second, { isAlive: (pid) => pid !== first.pid, ...clock(), report: () => {} });
    expect(result).toEqual({ waitedMs: 0, tookOver: expect.stringContaining("stale lock (pid 4100") });
  });
});
