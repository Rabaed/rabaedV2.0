import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

// Summarises a vitest JSON report for the job summary of a seam job (RP-321):
// the slowest test files and the total test time, beside the latest run on main.
// Slowing a seam shows only as the 5-second test limit firing in unrelated
// files, so a number on the PR points at the cause sooner (RP-299 retro).
//
//   node scripts/test-timing.ts <report.json> --title "seam 1" [--main main.json] [--budget <minutes>]
//
// With --budget, a total over that many minutes gets a warning (RP-558): a
// drift on main is never 25% slower than main, so only a fixed budget sees it.
//
// Seam 1 runs as shards (RP-557); their reports become one first, whose total
// is the longest shard's span:
//
//   node scripts/test-timing.ts --merge seam1-timing.json seam1-timing-1.json ...
//
// Timing is a notice, never a failure: this script always exits 0.

/** The part of vitest's JSON report used here. */
export interface VitestReport {
  testResults: { name: string; startTime: number; endTime: number }[];
  /** Set on a report merged from shards (RP-557): each shard's first start and last end. */
  shards?: { startTime: number; endTime: number }[];
}

export interface Timing {
  /**
   * From the first file starting to the last file ending, so global setup (seeding) is left out.
   * For a merged report, the longest shard's span: the shards run side by side.
   */
  totalMs: number;
  files: { file: string; ms: number }[];
  /** Each shard's span, in shard order, for a merged report. */
  shardsMs?: number[];
}

/** A slowdown above this share of main's total time gets a notice. */
export const slowdownThreshold = 0.25;

/** Repository-relative path, whatever the checkout directory was. */
export function relativeFile(name: string): string {
  const path = name.replaceAll("\\", "/");
  const match = /(?:^|\/)((?:apps|packages|scripts)\/.*)$/.exec(path);
  return match?.[1] ?? path;
}

/** First start to last end of these files; 0 without files. */
function spanOf(results: { startTime: number; endTime: number }[]): { startTime: number; endTime: number } {
  if (results.length === 0) return { startTime: 0, endTime: 0 };
  return { startTime: Math.min(...results.map((r) => r.startTime)), endTime: Math.max(...results.map((r) => r.endTime)) };
}

export function timingOf(report: VitestReport): Timing {
  const files = report.testResults.map((r) => ({ file: relativeFile(r.name), ms: Math.max(0, r.endTime - r.startTime) }));
  if (report.shards) {
    const shardsMs = report.shards.map((s) => Math.max(0, s.endTime - s.startTime));
    return { totalMs: Math.max(0, ...shardsMs), files, shardsMs };
  }
  const { startTime, endTime } = spanOf(report.testResults);
  return { totalMs: Math.max(0, endTime - startTime), files };
}

/**
 * One report from several shards' reports (RP-557): every file of each, and
 * each shard's span, since shards run side by side on separate runners.
 */
export function mergeReports(reports: VitestReport[]): VitestReport {
  return {
    testResults: reports.flatMap((r) => r.testResults),
    shards: reports.map((r) => spanOf(r.testResults)),
  };
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** Percentage change from main, signed, e.g. "+94%". */
export function formatChange(ms: number, mainMs: number): string {
  const pct = Math.round(((ms - mainMs) / mainMs) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export function isSlower(totalMs: number, mainMs: number): boolean {
  return mainMs > 0 && totalMs > mainMs * (1 + slowdownThreshold);
}

export interface Summary {
  markdown: string;
  /** Set when the total is more than 25% above main's. */
  notice?: string;
  /** Set when the total is over the job's fixed budget (RP-558). */
  warning?: string;
}

export interface SummaryOptions {
  /** How many of the slowest files the table lists. */
  top?: number;
  /**
   * The job's fixed time budget. Each ticket adds a little, so no run is ever
   * 25% slower than main while main itself drifts; a budget catches the drift.
   */
  budgetMinutes?: number;
}

export function summarise(title: string, current: Timing, main?: Timing, { top = 10, budgetMinutes }: SummaryOptions = {}): Summary {
  const mainFiles = new Map(main?.files.map((f) => [f.file, f.ms]));
  const bySlowest = [...current.files].sort((a, b) => b.ms - a.ms);
  const slowest = bySlowest.slice(0, top);

  const total =
    main && main.totalMs > 0
      ? `${formatDuration(current.totalMs)}, main ${formatDuration(main.totalMs)} (${formatChange(current.totalMs, main.totalMs)})`
      : `${formatDuration(current.totalMs)} (no run on main to compare with yet)`;
  const lines = [`### ${title}: test time`, ""];

  let warning: string | undefined;
  if (budgetMinutes !== undefined && current.totalMs > budgetMinutes * 60_000) {
    const three = bySlowest.slice(0, 3).map(({ file, ms }) => `${file} (${formatDuration(ms)})`);
    // eslint-disable-next-line rabaed/no-avoid-terms -- test files, in a CI annotation.
    warning = `${title} took ${formatDuration(current.totalMs)}, over its budget of ${budgetMinutes} min. Slowest files: ${three.join(", ")}.`;
    lines.push(`> **Over budget:** ${warning}`, "");
  }
  lines.push(`Total: **${total}**`);
  if (current.shardsMs) {
    const n = current.shardsMs.length;
    lines.push("", `Shards: ${current.shardsMs.map((ms, i) => `${i + 1}/${n} ${formatDuration(ms)}`).join(", ")}`);
  }

  let notice: string | undefined;
  if (main && isSlower(current.totalMs, main.totalMs)) {
    notice =
      `${title} took ${formatDuration(current.totalMs)}, ${formatChange(current.totalMs, main.totalMs)} ` +
      `against ${formatDuration(main.totalMs)} on main (notice above ${slowdownThreshold * 100}%, not a failure).`;
    lines.push("", `> **Slower than main:** ${notice}`);
  }

  // eslint-disable-next-line rabaed/no-avoid-terms -- test files, in the CI job summary.
  lines.push("", `The ${slowest.length} slowest files:`, "", "| File | Time | Main |", "| --- | ---: | ---: |");
  for (const { file, ms } of slowest) {
    const before = mainFiles.get(file);
    lines.push(`| \`${file}\` | ${formatDuration(ms)} | ${before === undefined ? "-" : formatDuration(before)} |`);
  }
  return { markdown: lines.join("\n") + "\n", notice, warning };
}

function readTiming(path: string): Timing {
  return timingOf(JSON.parse(readFileSync(path, "utf8")) as VitestReport);
}

export function run(argv: string[], env: NodeJS.ProcessEnv = process.env): void {
  const arg = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  if (argv[0] === "--merge") {
    const [out, ...shards] = argv.slice(1);
    if (!out || shards.length === 0) throw new Error("usage: test-timing.ts --merge <out.json> <shard.json>...");
    const merged = mergeReports(shards.map((path) => JSON.parse(readFileSync(path, "utf8")) as VitestReport));
    writeFileSync(out, JSON.stringify(merged));
    return;
  }
  const report = argv[0];
  if (!report || report.startsWith("--")) throw new Error("usage: test-timing.ts <report.json> --title <title> [--main <main.json>] [--budget <minutes>]");
  const title = arg("--title") ?? "tests";
  const mainPath = arg("--main");
  const budget = arg("--budget");
  const budgetMinutes = budget === undefined ? undefined : Number(budget);
  if (budgetMinutes !== undefined && !(budgetMinutes > 0)) throw new Error(`--budget needs minutes above 0, got "${budget}"`);

  const current = readTiming(report);
  let main: Timing | undefined;
  if (mainPath) {
    try {
      main = readTiming(mainPath);
    } catch (error) {
      console.log(`::warning::No usable timing from main to compare with: ${(error as Error).message}`);
    }
  }
  const { markdown, notice, warning } = summarise(title, current, main, { budgetMinutes });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown + "\n");
  else console.log(markdown);
  if (warning) console.log(`::warning title=${title} over budget::${warning}`);
  if (notice) console.log(`::notice title=${title} is slower than main::${notice}`);
}

if (import.meta.main) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    // Timing is informational: a broken report must not fail the job.
    console.log(`::warning::Could not summarise test timing: ${(error as Error).message}`);
  }
}
