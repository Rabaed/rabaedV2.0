import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { machineDir, machineLockFile, turnMessage, readLine, removePlaces, waitForTurn } from "./verify-queue.ts";
import { releaseLock, type LockHolder, type Processes } from "./verify-lock.ts";

const dir = () => mkdtempSync(join(tmpdir(), "verify-line-"));
const alive: Processes = { isAlive: () => true, startOf: () => new Date(2026, 9, 20, 9, 5) };
const run = (pid: number, lane?: string, pr?: number): LockHolder => ({ pid, started: new Date(2026, 9, 20, 9, 5), pidStarted: new Date(2026, 9, 20, 9, 5), command: "pnpm verify", lane, pr });

/** A clock that only sleep moves; each sleep also lets the other runs go (a microtask turn). */
function clock(onSleep: (n: number) => void = () => {}) {
  let t = 1_000_000;
  let n = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; n += 1; onSleep(n); await Promise.resolve(); } };
}

describe("machineDir", () => {
  it("uses RABAED_VERIFY_DIR, else a folder in the OS temp folder", () => {
    expect(machineDir({ RABAED_VERIFY_DIR: "X:/q" }, "T:/tmp")).toBe("X:/q");
    expect(machineDir({}, "T:/tmp")).toMatch(/rabaed-verify$/);
    expect(machineDir({ RABAED_VERIFY_DIR: "" }, "T:/tmp")).toMatch(/rabaed-verify$/);
  });
});

describe("turnMessage", () => {
  it("names the run in front and the position", () => {
    expect(turnMessage([run(1, "13", 577)])).toBe("waiting behind lane 13 (#577), position 2");
    expect(turnMessage([run(1, "13", 577), run(2, "21")])).toBe("waiting behind lane 21, position 3");
    expect(turnMessage([run(4100)])).toBe("waiting behind pid 4100, position 2");
  });
});

describe("waitForTurn", () => {
  it("takes a free lock at once and leaves no place", async () => {
    const d = dir();
    const lines: string[] = [];
    const turn = await waitForTurn(d, run(10, "13"), { processes: alive, ...clock(), report: (l) => lines.push(l) });
    expect(turn.waitedMs).toBe(0);
    expect(lines).toEqual([]);
    expect(readdirSync(join(d, "line"))).toEqual([]);
    expect(readLine(d, run(99), alive).holder?.pid).toBe(10);
  });

  it("two verifies started together run one after the other, the second saying its position", async () => {
    const d = dir();
    const events: string[] = [];
    const lines: string[] = [];
    const c = clock();
    const verify = async (self: LockHolder, ticks: number) => {
      await waitForTurn(d, self, { processes: alive, ...c, report: (l) => lines.push(`${self.pid}: ${l}`) });
      events.push(`start ${self.pid}`);
      for (let i = 0; i < ticks; i++) await c.sleep(1_000);
      events.push(`end ${self.pid}`);
      releaseLock(machineLockFile(d), self.pid);
    };
    await Promise.all([verify(run(10, "13", 577), 3), verify(run(20, "21"), 1)]);
    expect(events).toEqual(["start 10", "end 10", "start 20", "end 20"]);
    expect(lines).toEqual(["20: Verify turn: waiting behind lane 13 (#577), position 2."]);
  });

  it("a third run reports position 3 and then 2 as the line moves", async () => {
    const d = dir();
    const lines: string[] = [];
    const c = clock();
    const verify = async (self: LockHolder) => {
      await waitForTurn(d, self, { processes: alive, ...c, report: (l) => self.pid === 30 && lines.push(l) });
      await c.sleep(1_000);
      releaseLock(machineLockFile(d), self.pid);
    };
    await Promise.all([verify(run(10, "11")), verify(run(20, "12")), verify(run(30, "13"))]);
    expect(lines).toEqual(["Verify turn: waiting behind lane 12, position 3.", "Verify turn: waiting behind lane 12, position 2."]);
  });

  it("takes over a lock whose holder is gone, and skips a place whose run is gone", async () => {
    const d = dir();
    mkdirSync(join(d, "line"), { recursive: true });
    const dead = run(777, "11");
    writeFileSync(machineLockFile(d), JSON.stringify({ ...dead, started: dead.started.toISOString(), pidStarted: dead.pidStarted?.toISOString() }));
    writeFileSync(join(d, "line", `${"0".padStart(15, "0")}-${"777".padStart(10, "0")}.json`), JSON.stringify({ ...dead, started: dead.started.toISOString(), pidStarted: dead.pidStarted?.toISOString() }));
    const processes: Processes = { isAlive: (pid) => pid !== 777, startOf: () => undefined };
    const turn = await waitForTurn(d, run(10), { processes, ...clock(), report: () => {} });
    expect(turn.tookOver).toContain("took over a stale lock");
    expect(readdirSync(join(d, "line"))).toEqual([]);
  });

  it("waits behind a live holder until it is released", async () => {
    const d = dir();
    const holder = run(5, "14", 600);
    mkdirSync(d, { recursive: true });
    writeFileSync(machineLockFile(d), JSON.stringify({ ...holder, started: holder.started.toISOString(), pidStarted: holder.pidStarted?.toISOString() }));
    const lines: string[] = [];
    const c = clock((n) => n === 40 && releaseLock(machineLockFile(d), 5));
    const turn = await waitForTurn(d, run(10), { processes: alive, ...c, report: (l) => lines.push(l), reportEveryMs: 100_000 });
    expect(lines[0]).toBe("Verify turn: waiting behind lane 14 (#600), position 2.");
    expect(lines.some((l) => l.startsWith("Verify turn: still waiting behind lane 14"))).toBe(true);
    expect(turn.waitedMs).toBeGreaterThan(0);
  });
});

describe("readLine and removePlaces", () => {
  it("lists the holder and the live waiters; removePlaces drops a run's place", async () => {
    const d = dir();
    const c = clock();
    const first = waitForTurn(d, run(10, "13"), { processes: alive, ...c, report: () => {} });
    await first;
    const second = waitForTurn(d, run(20, "21"), { processes: alive, ...c, report: () => {} });
    await Promise.resolve();
    await Promise.resolve();
    const q = readLine(d, run(99), alive);
    expect(q.holder?.pid).toBe(10);
    expect(q.waiting.map((w) => w.pid)).toEqual([20]);
    removePlaces(d, 20);
    expect(readLine(d, run(99), alive).waiting).toEqual([]);
    releaseLock(machineLockFile(d), 10);
    void second;
  });
});
