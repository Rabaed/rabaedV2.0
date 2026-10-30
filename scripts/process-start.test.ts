import { describe, expect, it } from "vitest";
import { fromElapsed, fromFileTime, pidLines, processAncestors, processStart } from "./process-start.ts";

describe("fromFileTime", () => {
  it("reads PowerShell's StartTime.ToFileTimeUtc() as a date", () => {
    // 2026-10-30T08:47:30Z: (ms since 1970 + 11644473600000) × 10 000.
    expect(fromFileTime("134378236500000000\r\n")).toEqual(new Date(Date.UTC(2026, 9, 30, 8, 47, 30)));
  });

  it("gives undefined for no output or not a number", () => {
    for (const text of ["", "\r\n", "Get-Process : Cannot find a process"]) expect(fromFileTime(text)).toBeUndefined();
  });
});

describe("fromElapsed", () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0, 400);

  it("reads ps's etime column, in each of its shapes, as a start time", () => {
    expect(fromElapsed("   05:07\n", now)).toEqual(new Date(Date.UTC(2026, 9, 30, 11, 54, 53)));
    expect(fromElapsed("02:05:07", now)).toEqual(new Date(Date.UTC(2026, 9, 30, 9, 54, 53)));
    expect(fromElapsed("1-02:05:07", now)).toEqual(new Date(Date.UTC(2026, 9, 29, 9, 54, 53)));
  });

  it("gives undefined for no output or another format", () => {
    for (const text of ["", "\n", "Fri Oct 30 11:47:30 2026"]) expect(fromElapsed(text, now)).toBeUndefined();
  });
});

describe("pidLines", () => {
  it("keeps the positive whole numbers, in order", () => {
    expect(pidLines("4100\r\n  36380\n0\nnope\n\n")).toEqual([4100, 36380]);
  });
});

describe("processStart", () => {
  it("reads this process's start time from the OS", () => {
    const start = processStart(process.pid);
    expect(start).toBeInstanceOf(Date);
    // Node's own idea of when it started, give or take the OS clock's rounding.
    expect(Math.abs(start!.getTime() - (Date.now() - process.uptime() * 1000))).toBeLessThan(5_000);
  }, 20_000);

  it("gives the same time, within a second, when read twice, so a lock can compare it", () => {
    const [a, b] = [processStart(process.pid), processStart(process.pid)];
    expect(Math.abs(a!.getTime() - b!.getTime())).toBeLessThanOrEqual(1_000);
  }, 20_000);

  it("reads nothing for a pid that is not a positive whole number (it never reaches the shell command)", () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(processStart(pid)).toBeUndefined();
  });

  it("gives undefined for a pid no process has", () => {
    expect(processStart(2 ** 31 - 2)).toBeUndefined();
  }, 20_000);
});

describe("processAncestors", () => {
  it("starts with this process's parent", () => {
    expect(processAncestors(process.pid)[0]).toBe(process.ppid);
  }, 20_000);

  it("is empty for a pid no process has, or one that is not a pid", () => {
    expect(processAncestors(2 ** 31 - 2)).toEqual([]);
    expect(processAncestors(-1)).toEqual([]);
  }, 20_000);
});
