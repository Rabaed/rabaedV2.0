import { describe, expect, it } from "vitest";
import { fromFileTime, fromLstart, processStart } from "./process-start.ts";

describe("fromFileTime", () => {
  it("reads PowerShell's StartTime.ToFileTimeUtc() as a date", () => {
    // 2026-10-30T08:47:30Z: (ms since 1970 + 11644473600000) × 10 000.
    expect(fromFileTime("134378236500000000\r\n")).toEqual(new Date(Date.UTC(2026, 9, 30, 8, 47, 30)));
  });

  it("gives undefined for no output or not a number", () => {
    for (const text of ["", "\r\n", "Get-Process : Cannot find a process"]) expect(fromFileTime(text)).toBeUndefined();
  });
});

describe("fromLstart", () => {
  it("reads ps's lstart column (C locale) as a local date", () => {
    expect(fromLstart("Fri Oct 30 11:47:30 2026\n")).toEqual(new Date(2026, 9, 30, 11, 47, 30));
    expect(fromLstart("Mon Nov  2 09:05:01 2026")).toEqual(new Date(2026, 10, 2, 9, 5, 1));
  });

  it("gives undefined for no output or another format", () => {
    for (const text of ["", "\n", "2026-10-30 11:47:30"]) expect(fromLstart(text)).toBeUndefined();
  });
});

describe("processStart", () => {
  it("reads this process's start time from the OS", () => {
    const start = processStart(process.pid);
    expect(start).toBeInstanceOf(Date);
    // Node's own idea of when it started, give or take the OS clock's rounding.
    expect(Math.abs(start!.getTime() - (Date.now() - process.uptime() * 1000))).toBeLessThan(5_000);
  }, 20_000);

  it("gives the same time when read twice, so a lock can compare it exactly", () => {
    expect(processStart(process.pid)).toEqual(processStart(process.pid));
  }, 20_000);

  it("gives undefined for a pid no process has", () => {
    expect(processStart(2 ** 31 - 2)).toBeUndefined();
  }, 20_000);
});
