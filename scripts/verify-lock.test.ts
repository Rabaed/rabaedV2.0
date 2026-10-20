import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, lockFile, pidAlive, releaseLock } from "./verify-lock.ts";

// A fresh worktree folder per test; the lock goes where verify.ts puts it.
const worktree = () => mkdtempSync(join(tmpdir(), "verify-lock-"));
const first = { pid: 4100, started: new Date(2026, 9, 20, 9, 5), command: "pnpm verify" };
const second = { pid: 4200, started: new Date(2026, 9, 20, 9, 40), command: "pnpm verify" };
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
    expect(acquireLock(file, { ...first, pid: 4300 }, alive)).toEqual({ acquired: false, message: expect.stringContaining("pid 4200, started 09:40") });
  });

  it("lets verify in two different worktrees run side by side", () => {
    const [a, b] = [worktree(), worktree()];
    expect(lockFile(a)).not.toBe(lockFile(b));
    expect(acquireLock(lockFile(a), first, alive)).toEqual({ acquired: true });
    expect(acquireLock(lockFile(b), second, alive)).toEqual({ acquired: true });
  });
});

describe("pidAlive", () => {
  const throwing = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };

  it("counts this process as alive", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("counts a pid with no process (ESRCH) as dead", () => {
    expect(pidAlive(4100, throwing("ESRCH"))).toBe(false);
  });

  it("counts a live process it may not signal (EPERM, as on Windows) as alive", () => {
    expect(pidAlive(4100, throwing("EPERM"))).toBe(true);
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
