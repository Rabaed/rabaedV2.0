import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, lockFile, releaseLock } from "./verify-lock.ts";

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
