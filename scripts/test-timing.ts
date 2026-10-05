import { appendFileSync, readFileSync } from "node:fs";

// Summarises a vitest JSON report for the job summary of a seam job (RP-321):
// the slowest test files and the total test time, beside the latest run on main.
// Slowing a seam shows only as the 5-second test limit firing in unrelated
// files, so a number on the PR points at the cause sooner (RP-299 retro).
//
//   node scripts/test-timing.ts <report.json> --title "seam 1" [--main main.json]
//
// Timing is a notice, never a failure: this script always exits 0.

/** The part of vitest's JSON report used here. */
export interface VitestReport {
  testResults: { name: string; startTime: number; endTime: number }[];
}

export interface Timing {
  /** From the first file starting to the last file ending, so global setup (seeding) is left out. */
  totalMs: number;
  files: { file: string; ms: number }[];
}

/** A slowdown above this share of main's total time gets a notice. */
export const slowdownThreshold = 0.25;

/** Repository-relative path, whatever the checkout directory was. */
export function relativeFile(name: string): string {
  const path = name.replaceAll("\\", "/");
  const match = /(?:^|\/)((?:apps|packages|scripts)\/.*)$/.exec(path);
  return match?.[1] ?? path;
}

export function timingOf(report: VitestReport): Timing {
  const files = report.testResults.map((r) => ({ file: relativeFile(r.name), ms: Math.max(0, r.endTime - r.startTime) }));
  if (report.testResults.length === 0) return { totalMs: 0, files };
  const start = Math.min(...report.testResults.map((r) => r.startTime));
  const end = Math.max(...report.testResults.map((r) => r.endTime));
  return { totalMs: Math.max(0, end - start), files };
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
}

export function summarise(title: string, current: Timing, main?: Timing, top = 10): Summary {
  const mainFiles = new Map(main?.files.map((f) => [f.file, f.ms]));
  const slowest = [...current.files].sort((a, b) => b.ms - a.ms).slice(0, top);

  const total =
    main && main.totalMs > 0
      ? `${formatDuration(current.totalMs)}, main ${formatDuration(main.totalMs)} (${formatChange(current.totalMs, main.totalMs)})`
      : `${formatDuration(current.totalMs)} (no run on main to compare with yet)`;
  const lines = [`### ${title}: test time`, "", `Total: **${total}**`];

  let notice: string | undefined;
  if (main && isSlower(current.totalMs, main.totalMs)) {
    notice =
      `${title} took ${formatDuration(current.totalMs)}, ${formatChange(current.totalMs, main.totalMs)} ` +
      `against ${formatDuration(main.totalMs)} on main (notice above ${slowdownThreshold * 100}%, not a failure).`;
    lines.push("", `> **Slower than main:** ${notice}`);
  }

  lines.push("", `The ${slowest.length} slowest files:`, "", "| File | Time | Main |", "| --- | ---: | ---: |");
  for (const { file, ms } of slowest) {
    const before = mainFiles.get(file);
    lines.push(`| \`${file}\` | ${formatDuration(ms)} | ${before === undefined ? "-" : formatDuration(before)} |`);
  }
  return { markdown: lines.join("\n") + "\n", notice };
}

function readTiming(path: string): Timing {
  return timingOf(JSON.parse(readFileSync(path, "utf8")) as VitestReport);
}

export function run(argv: string[], env: NodeJS.ProcessEnv = process.env): void {
  const arg = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const report = argv[0];
  if (!report || report.startsWith("--")) throw new Error("usage: test-timing.ts <report.json> --title <title> [--main <main.json>]");
  const title = arg("--title") ?? "tests";
  const mainPath = arg("--main");

  const current = readTiming(report);
  let main: Timing | undefined;
  if (mainPath) {
    try {
      main = readTiming(mainPath);
    } catch (error) {
      console.log(`::warning::No usable timing from main to compare with: ${(error as Error).message}`);
    }
  }
  const { markdown, notice } = summarise(title, current, main);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown + "\n");
  else console.log(markdown);
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
