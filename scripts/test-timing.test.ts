import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatChange,
  formatDuration,
  isSlower,
  mergeReports,
  relativeFile,
  run,
  summarise,
  timingOf,
  type VitestReport,
} from "./test-timing.ts";

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

describe("mergeReports (one report from seam 1's shards, RP-557)", () => {
  // Shard 1 spans 10s, shard 2 spans 25s; shard 2 started later, on another runner.
  const shard1 = report(["apps/a.test.ts", 1_000, 5_000], ["apps/b.test.ts", 5_000, 11_000]);
  const shard2 = report(["apps/c.test.ts", 100_000, 125_000]);
  const shard4 = report(["apps/d.test.ts", 0, 3_000]);

  it("keeps every file of each shard, and the total is the longest shard's span", () => {
    const t = timingOf(mergeReports([{ shard: 1, report: shard1 }, { shard: 2, report: shard2 }], 2));
    expect(t.files.map((f) => f.file)).toEqual(["apps/a.test.ts", "apps/b.test.ts", "apps/c.test.ts"]);
    expect(t.totalMs).toBe(25_000);
    expect(t.shards).toEqual([
      { shard: 1, ms: 10_000 },
      { shard: 2, ms: 25_000 },
    ]);
  });

  it("lists each shard's span in the summary, by its real shard number", () => {
    const { markdown } = summarise("seam 1", timingOf(mergeReports([{ shard: 1, report: shard1 }, { shard: 2, report: shard2 }], 2)), undefined);
    expect(markdown).toContain("Total: **25.0s");
    expect(markdown).toContain("Shards: 1/2 10.0s, 2/2 25.0s");
  });

  it("lists an expected shard with no report as missing, without relabelling the others", () => {
    const merged = mergeReports([{ shard: 4, report: shard4 }, { shard: 1, report: shard1 }, { shard: 2, report: shard2 }], 4);
    expect(summarise("seam 1", timingOf(merged), undefined).markdown).toContain("Shards: 1/4 10.0s, 2/4 25.0s, 3/4 missing, 4/4 3.0s");
  });

  it("keeps vitest's top-level shape: counts summed, success only if every shard's is, other fields from the first", () => {
    const a = { ...shard1, numTotalTests: 5, numFailedTests: 0, numPassedTestSuites: 2, success: true, startTime: 1_000, snapshot: { added: 0 } };
    const b = { ...shard2, numTotalTests: 3, numFailedTests: 1, numPassedTestSuites: 1, success: false, startTime: 100_000, snapshot: { added: 9 } };
    const merged = mergeReports([{ shard: 1, report: a }, { shard: 2, report: b }], 2);
    expect(merged).toMatchObject({ numTotalTests: 8, numFailedTests: 1, numPassedTestSuites: 3, success: false, startTime: 1_000, snapshot: { added: 0 } });
    expect(merged.testResults).toHaveLength(3);
    expect(mergeReports([{ shard: 1, report: a }, { shard: 2, report: { ...b, success: true } }], 2).success).toBe(true);
  });

  it("gives no shard line for a report from one job", () => {
    expect(summarise("seam 1", timingOf(shard1), undefined).markdown).not.toContain("Shards:");
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

describe("summarise with a budget (RP-558)", () => {
  // 4 files, 10 minutes in all: 4m, 3m, 2m, 1m.
  const tenMinutes = timingOf(
    report(["apps/a.test.ts", 0, 240_000], ["apps/b.test.ts", 240_000, 420_000], ["apps/c.test.ts", 420_000, 540_000], ["apps/d.test.ts", 540_000, 600_000]),
  );

  it("over the budget, warns with the total, the budget and the three slowest, as the summary's very first line", () => {
    const { markdown, warning } = summarise("seam 1", tenMinutes, undefined, { budgetMinutes: 8 });
    expect(warning).toBe("seam 1 took 10m00s, over its budget of 8 min. Slowest: apps/a.test.ts 4m00s, apps/b.test.ts 3m00s, apps/c.test.ts 2m00s.");
    expect(markdown.split("\n").slice(0, 3)).toEqual([warning, "", "### seam 1: test time"]);
  });

  it("under the budget, or with no budget, gives no warning", () => {
    expect(summarise("seam 1", tenMinutes, undefined, { budgetMinutes: 11 }).warning).toBeUndefined();
    expect(summarise("seam 1", tenMinutes, undefined).warning).toBeUndefined();
    expect(summarise("seam 1", tenMinutes, undefined).markdown).not.toContain("Over budget");
  });

  it("keeps the comparison with main beside the budget", () => {
    const main = timingOf(report(["apps/a.test.ts", 0, 240_000]));
    const { notice, warning } = summarise("seam 1", tenMinutes, main, { budgetMinutes: 20 });
    expect(notice).toContain("+150%");
    expect(warning).toBeUndefined();
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

  it("prints an over-budget warning with --budget, and still does not fail", () => {
    const summary = join(dir, "summary.md");
    const current = write("cur.json", report(["apps/a.test.ts", 0, 200_000]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      run([current, "--title", "seam 2", "--budget", "3"], { GITHUB_STEP_SUMMARY: summary });
      run([current, "--title", "seam 2"], { GITHUB_STEP_SUMMARY: summary });
      const message = "seam 2 took 3m20s, over its budget of 3 min. Slowest: apps/a.test.ts 3m20s.";
      expect(log.mock.calls).toEqual([[`::warning title=seam 2 over budget::${message}`]]);
      expect(readFileSync(summary, "utf8").startsWith(`${message}\n`)).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("merges shard reports into one file with --merge, each labelled by the shard number in its name", () => {
    const a = write("seam1-timing-1.json", report(["apps/a.test.ts", 0, 4_000]));
    const c = write("seam1-timing-3.json", report(["apps/b.test.ts", 50_000, 57_000]));
    const out = join(dir, "seam1-timing.json");
    run(["--merge", out, "--of", "4", c, a]);
    const t = timingOf(JSON.parse(readFileSync(out, "utf8")) as VitestReport);
    expect(t.files.map((f) => f.file)).toEqual(["apps/a.test.ts", "apps/b.test.ts"]);
    expect(t.totalMs).toBe(7_000);
    expect(t.shards).toEqual([{ shard: 1, ms: 4_000 }, { shard: 2 }, { shard: 3, ms: 7_000 }, { shard: 4 }]);
  });

  it("throws on misuse of --merge or --budget, for the command line to turn into a warning", () => {
    const a = write("seam1-timing-1.json", report(["apps/a.test.ts", 0, 4_000]));
    const unnumbered = write("timing.json", report(["apps/a.test.ts", 0, 4_000]));
    const out = join(dir, "out.json");
    expect(() => run(["--merge", out, a])).toThrow(/--of/);
    expect(() => run(["--merge", out, "--of", "4", unnumbered])).toThrow(/shard number/);
    expect(() => run(["--merge", out, "--of", "4", write("seam1-timing-5.json", report())])).toThrow(/1 to 4/);
    expect(() => run([a, "--budget", "soon"])).toThrow(/--budget/);
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
