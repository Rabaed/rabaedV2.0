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
// is the longest shard's span. Each report's shard number k comes from its
// name, `...-<k>.json`, so a shard with no report shows as missing and never
// relabels the rest:
//
//   node scripts/test-timing.ts --merge seam1-timing.json --of 4 seam1-timing-1.json ...
//
// Timing is a notice, never a failure: from the command line this script always
// exits 0. Misuse (a missing report path, `--merge` without `--of <n>` or with a
// report name lacking a shard number from 1 to n, a `--budget` that is not
// minutes above 0) and an unreadable report make `run` throw; the command line
// prints that as a `::warning` instead of failing the job.

/** The part of vitest's JSON report used here; the other fields are kept as they are. */
export interface VitestReport {
  testResults: { name: string; startTime: number; endTime: number }[];
  success?: boolean;
  [field: string]: unknown;
}

/** One shard's first start and last end. */
export interface ShardSpan {
  shard: number;
  startTime: number;
  endTime: number;
}

/**
 * A report merged from shards (RP-557): vitest's top-level shape, plus `shards`
 * and `shardCount`, which vitest never writes.
 */
export interface MergedReport extends VitestReport {
  /** Each shard that left a report, by its real shard number. */
  shards: ShardSpan[];
  /** How many shards were expected: a number from 1 to this with no span had no report. */
  shardCount: number;
}

export interface Timing {
  /**
   * From the first file starting to the last file ending, so global setup (seeding) is left out.
   * For a merged report, the longest shard's span: the shards run side by side.
   */
  totalMs: number;
  files: { file: string; ms: number }[];
  /** Every expected shard of a merged report, in shard order; `ms` is unset for one with no report. */
  shards?: { shard: number; ms?: number }[];
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

function isMerged(report: VitestReport): report is MergedReport {
  return Array.isArray(report.shards) && typeof report.shardCount === "number";
}

export function timingOf(report: VitestReport): Timing {
  const files = report.testResults.map((r) => ({ file: relativeFile(r.name), ms: Math.max(0, r.endTime - r.startTime) }));
  if (isMerged(report)) {
    const spans = new Map(report.shards.map((s) => [s.shard, Math.max(0, s.endTime - s.startTime)]));
    const shards = Array.from({ length: report.shardCount }, (_, i) => {
      const ms = spans.get(i + 1);
      return ms === undefined ? { shard: i + 1 } : { shard: i + 1, ms };
    });
    return { totalMs: Math.max(0, ...spans.values()), files, shards };
  }
  const { startTime, endTime } = spanOf(report.testResults);
  return { totalMs: Math.max(0, endTime - startTime), files };
}

/**
 * One report from several shards' reports (RP-557), in vitest's top-level
 * shape: every file of each, the `num*` counts summed, `success` only if every
 * shard's is, other fields from the first; plus each shard's span, since shards
 * run side by side on separate runners.
 */
export function mergeReports(shards: { shard: number; report: VitestReport }[], shardCount: number): MergedReport {
  const ordered = [...shards].sort((a, b) => a.shard - b.shard);
  const reports = ordered.map((s) => s.report);
  const counts: Record<string, number> = {};
  for (const report of reports) {
    for (const [field, value] of Object.entries(report)) {
      if (field.startsWith("num") && typeof value === "number") counts[field] = (counts[field] ?? 0) + value;
    }
  }
  return {
    ...reports[0],
    ...counts,
    success: reports.length > 0 && reports.every((r) => r.success === true),
    testResults: reports.flatMap((r) => r.testResults),
    shards: ordered.map(({ shard, report }) => ({ shard, ...spanOf(report.testResults) })),
    shardCount,
  };
}

/** The shard number k in a shard report's name, `...-<k>.json`. */
function shardNumberOf(path: string, shardCount: number): number {
  const match = /-(\d+)\.json$/.exec(path);
  if (!match) throw new Error(`no shard number in "${path}": name each shard report ...-<k>.json`);
  const shard = Number(match[1]);
  if (shard < 1 || shard > shardCount) throw new Error(`shard number ${shard} in "${path}" is not from 1 to ${shardCount}`);
  return shard;
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
  const lines: string[] = [];

  // The very first line of the job summary, the same text as the annotation (RP-558).
  let warning: string | undefined;
  if (budgetMinutes !== undefined && current.totalMs > budgetMinutes * 60_000) {
    const slowestThree = bySlowest.slice(0, 3).map(({ file, ms }) => `${file} ${formatDuration(ms)}`);
    warning = `${title} took ${formatDuration(current.totalMs)}, over its budget of ${budgetMinutes} min. Slowest: ${slowestThree.join(", ")}.`;
    lines.push(warning, "");
  }
  // The budget is named even when the total is under it, so every run shows how close it is (RP-558).
  lines.push(`### ${title}: test time`, "", `Total: **${total}**${budgetMinutes === undefined ? "" : `, budget ${budgetMinutes} min`}`);
  if (current.shards) {
    const n = current.shards.length;
    const each = current.shards.map(({ shard, ms }) => `${shard}/${n} ${ms === undefined ? "missing" : formatDuration(ms)}`);
    lines.push("", `Shards: ${each.join(", ")}`);
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
    const usage = "usage: test-timing.ts --merge <out.json> --of <shards> <name-<k>.json>...";
    const [out, of, count, ...paths] = argv.slice(1);
    const shardCount = Number(count);
    if (!out || of !== "--of" || !Number.isInteger(shardCount) || shardCount < 1 || paths.length === 0) throw new Error(usage);
    const shards = paths.map((path) => ({ shard: shardNumberOf(path, shardCount), report: JSON.parse(readFileSync(path, "utf8")) as VitestReport }));
    const merged = mergeReports(shards, shardCount);
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
