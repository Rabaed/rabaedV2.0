import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatChange, formatDuration, isSlower, relativeFile, run, summarise, timingOf, type VitestReport } from "./test-timing.ts";

// Real vitest reports from the RP-299 retro (seam 1 on main, and on the slowed
// branch). Set TEST_TIMING_REPORTS to the folder holding them to run those tests.
const reports = process.env.TEST_TIMING_REPORTS;
const real = (name: string): VitestReport => JSON.parse(readFileSync(join(reports!, name), "utf8"));

const report = (...files: [string, number, number][]): VitestReport => ({
  testResults: files.map(([name, startTime, endTime]) => ({ name, startTime, endTime })),
});

describe("relativeFile", () => {
  it("drops the checkout directory, on any platform", () => {
    expect(relativeFile("/home/runner/work/rabaedV2.0/rabaedV2.0/apps/api/test/a.test.ts")).toBe("apps/api/test/a.test.ts");
    expect(relativeFile("G:\\x\\.claude\\worktrees\\w1\\packages\\db\\test\\b.test.ts")).toBe("packages/db/test/b.test.ts");
    expect(relativeFile("/elsewhere/c.test.ts")).toBe("/elsewhere/c.test.ts");
  });
});

describe("timingOf", () => {
  it("times each file, and the total from the first start to the last end", () => {
    const t = timingOf(report(["apps/a.test.ts", 1000, 4000], ["apps/b.test.ts", 4000, 9000]));
    expect(t.files).toEqual([
      { file: "apps/a.test.ts", ms: 3000 },
      { file: "apps/b.test.ts", ms: 5000 },
    ]);
    expect(t.totalMs).toBe(8000);
  });

  it("copes with a report without files", () => {
    expect(timingOf({ testResults: [] })).toEqual({ totalMs: 0, files: [] });
  });
});

describe("formatting", () => {
  it("formats durations and changes", () => {
    expect(formatDuration(12_340)).toBe("12.3s");
    expect(formatDuration(265_000)).toBe("4m25s");
    expect(formatChange(510_000, 265_000)).toBe("+92%");
    expect(formatChange(200_000, 250_000)).toBe("-20%");
  });
});

describe("isSlower", () => {
  it("flags only more than 25% above main", () => {
    expect(isSlower(125_000, 100_000)).toBe(false);
    expect(isSlower(125_001, 100_000)).toBe(true);
    expect(isSlower(50_000, 100_000)).toBe(false);
    expect(isSlower(50_000, 0)).toBe(false);
  });
});

describe("summarise", () => {
  const main = timingOf(report(["apps/a.test.ts", 0, 10_000], ["apps/b.test.ts", 10_000, 20_000]));

  it("lists the slowest files first, limited to 10", () => {
    const files = Array.from({ length: 12 }, (_, i): [string, number, number] => [`apps/f${i}.test.ts`, i * 1000, i * 1000 + (i + 1) * 100]);
    const { markdown } = summarise("seam 1", timingOf(report(...files)), undefined);
    const rows = markdown.split("\n").filter((l) => l.startsWith("| `"));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain("apps/f11.test.ts");
    expect(markdown).toContain("no run on main to compare with yet");
  });

  it("shows the total and each file against main, with no notice at the same speed", () => {
    const { markdown, notice } = summarise("seam 1", main, main);
    expect(markdown).toContain("Total: **20.0s, main 20.0s (+0%)**");
    expect(notice).toBeUndefined();
    expect(markdown).toContain("| `apps/a.test.ts` | 10.0s | 10.0s |");
  });

  it("gives a notice above 25%", () => {
    const slow = timingOf(report(["apps/a.test.ts", 0, 20_000], ["apps/b.test.ts", 20_000, 40_000]));
    const { markdown, notice } = summarise("seam 1", slow, main);
    expect(notice).toContain("+100%");
    expect(markdown).toContain("Slower than main");
  });
});

describe("run", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "rabaed-timing-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, r: VitestReport) => {
    writeFileSync(join(dir, name), JSON.stringify(r));
    return join(dir, name);
  };

  it("appends to the job summary without failing, even when slower", () => {
    const summary = join(dir, "summary.md");
    const current = write("cur.json", report(["apps/a.test.ts", 0, 30_000]));
    const mainPath = write("main.json", report(["apps/a.test.ts", 0, 10_000]));
    run([current, "--title", "seam 1", "--main", mainPath], { GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, "utf8")).toContain("seam 1: test time");
  });

  it("still summarises when main's timing is broken", () => {
    const summary = join(dir, "summary.md");
    const current = write("cur.json", report(["apps/a.test.ts", 0, 30_000]));
    writeFileSync(join(dir, "main.json"), "not json");
    run([current, "--main", join(dir, "main.json")], { GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, "utf8")).toContain("no run on main to compare with yet");
  });
});

describe.skipIf(!reports)("the real RP-299 seam 1 reports", () => {
  it("summarises a slowed branch against main with a notice", () => {
    const main = timingOf(real("seam1-main.json"));
    const branch = timingOf(real("perf-before1.json"));
    expect(main.files.length).toBeGreaterThan(10);
    const { markdown } = summarise("seam 1", branch, main);
    expect(markdown.split("\n").filter((l) => l.startsWith("| `"))).toHaveLength(10);
    expect(markdown).toMatch(/\| `(apps|packages)\//);
  });

  it("gives no notice for a run against itself", () => {
    const t = timingOf(real("perf-after1.json"));
    expect(summarise("seam 1", t, t).notice).toBeUndefined();
  });
});
