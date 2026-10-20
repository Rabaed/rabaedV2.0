import { migrationsDir } from "./migrations.ts";
import { startServices } from "./test-services.ts";

// Which checks `pnpm verify` (RP-459) runs for a diff. Pure, so it is unit-tested.

export type Step = { name: string; script: string };
export type Skipped = { name: string; reason: string };

const storyFolders = ["packages/ui/", "apps/web/"];

const step = (name: string): Step => ({ name, script: name });

/** The steps for the files changed against origin/main, in run order, and the steps left out. */
export function selectSteps(changed: string[]): { steps: Step[]; skipped: Skipped[] } {
  const files = changed.map((file) => file.replaceAll("\\", "/"));
  const migrationChanged = files.some((file) => file.startsWith(`${migrationsDir}/`));
  const uiChanged = files.some((file) => storyFolders.some((folder) => file.startsWith(folder)));

  const steps: Step[] = [];
  const skipped: Skipped[] = [];
  if (migrationChanged) steps.push(step("check:migrations"));
  // eslint-disable-next-line rabaed/no-avoid-terms -- the database-schema migration files, named as the check script names them.
  else skipped.push({ name: "check:migrations", reason: "no migration changed against origin/main" });
  steps.push(step("lint"), step("typecheck"), step("test:unit"), step("test:seam1"), step("test:seam2"));
  if (uiChanged) steps.push(step("test:stories"));
  else skipped.push({ name: "test:stories", reason: "nothing changed in packages/ui or apps/web" });
  return { steps, skipped };
}

/** The line `pnpm verify` ends with when every step passed: the verified commit, "dirty" if the tree has uncommitted changes (RP-563). */
export function finalLine({ sha, dirty, steps }: { sha: string; dirty: boolean; steps: string[] }): string {
  return `pnpm verify passed on ${sha === "" ? "unknown commit" : sha}${dirty ? " (dirty: uncommitted changes)" : ""}: ${steps.join(", ")}.`;
}

// A seam step that fails only on timeouts or a worker that never started (RP-607): what
// several lanes' test runs on one machine at once look like, never a cause verify can see
// in the diff. Every other error line (an AssertionError, a TypeError, ...) is a real failure.
const loadErrors = [/^Error: (Test|Hook) timed out in \d+ms/, /^Error: \[vitest-pool\]: (Worker \w+ emitted error|Timeout starting|Failed to start)/, /^Error: Worker exited unexpectedly .*during starting state/];
const errorLine = /^(?:[A-Z]\w*)?(Error|Exception)\b[^:]*:/;
const failHeader = /^FAIL\s+(?:\|[^|]+\|\s+)?(\S+\.test\.\w+)(?:\s+>\s+(.+?))?(?:\s+\[.*\])?$/;
// eslint-disable-next-line no-control-regex -- colour codes, should a run print them.
const ansi = /\x1b\[[0-9;]*m/g;

// Postgres's code for a connection it terminated (RP-994), as when Docker stops in the middle of a
// seam run: the tests then fail on that, never on the diff. node-postgres prints it as a lower-case
// "error:", which errorLine does not count, so timeouts beside it would otherwise read as load.
// Only a line the termination itself raised counts: the error's own line, Postgres's FATAL line, or
// the `code: '57P01'` of an error object Vitest prints. A failing test's assertion diff (`"code":
// "57P01"`), code frame (`63| …`) or comment that names it is not a termination (pool-error.test.ts
// terminates a backend on purpose).
const terminatedLines = [/^(?:\w*error|FATAL):?\s+terminating connection due to administrator command/i, /^FATAL:?\s+57P01\b/, /^code: '57P01',?$/];
const postgresTerminated = (output: string) =>
  output
    .replace(ansi, "")
    .split("\n")
    .some((line) => terminatedLines.some((pattern) => pattern.test(line.trim())));

/** What a seam step's output shows when it failed only on timeouts or worker start-up: the test files and tests named. Undefined for any other failure, a terminated Postgres too. */
function readLoadFailure(step: string, output: string): { files: Set<string>; timedOut: Set<string> } | undefined {
  if (!step.startsWith("test:seam") || postgresTerminated(output)) return undefined;
  const timedOut = new Set<string>();
  const files = new Set<string>();
  let headers: { file: string; name: string }[] = [];
  let loadSeen = false;
  for (const raw of output.replace(ansi, "").split("\n")) {
    const line = raw.trim().replace(/^Caused by: /, "");
    const header = failHeader.exec(line);
    if (header) {
      headers.push({ file: header[1]!, name: header[2] ? `${header[1]} > ${header[2]}` : header[1]! });
      continue;
    }
    if (!errorLine.test(line)) continue;
    if (!loadErrors.some((pattern) => pattern.test(line))) return undefined;
    loadSeen = true;
    for (const { file, name } of headers) {
      files.add(file);
      if (/timed out/.test(line)) timedOut.add(name);
    }
    headers = [];
  }
  return loadSeen ? { files, timedOut } : undefined;
}

/**
 * When `step` (a seam suite) failed only on timeouts or worker start-up, the message `pnpm verify`
 * adds: likely machine load, the timed-out tests, and the command to rerun only their files.
 * Undefined for any other failure. It never makes the step pass (`runStep` re-runs the files once).
 */
export function loadFailure(step: string, output: string): string | undefined {
  const load = readLoadFailure(step, output);
  if (!load) return undefined;
  const { files, timedOut } = load;
  const rerun = `pnpm ${step}${[...files].map((file) => ` ${file}`).join("")}`;
  return [
    `${step} failed only on timeouts or worker start-up: likely machine load (other test runs on this machine), not this diff.`,
    ...(timedOut.size > 0 ? ["Timed out:", ...[...timedOut].map((name) => `  ${name}`)] : []),
    `Rerun ${files.size > 0 ? "only them" : "the step"} when the machine is quieter: ${rerun}`,
    "The step still failed.",
  ].join("\n");
}

/**
 * What `pnpm verify` prints after a failed step's tail, ending with the line naming where it stopped.
 * For a seam step whose output holds a 57P01 error line, or whose Postgres no longer answers (`postgresAnswers`
 * false), that last line says Postgres was terminated (RP-994), and no load note comes before it:
 * timeouts against a terminated Postgres are not machine load.
 */
export function failureEnd(step: string, output: string, postgresAnswers: boolean): string[] {
  const stopped = `pnpm verify stopped at ${step}`;
  if (!step.startsWith("test:seam")) return [`${stopped}.`];
  const evidence = postgresTerminated(output) ? "57P01" : postgresAnswers ? undefined : "it no longer answers";
  if (evidence) return [`${stopped}: Postgres was terminated (${evidence}), Docker may have stopped. Restart it (${startServices}) and run pnpm verify again.`];
  const load = loadFailure(step, output);
  return [...(load ? [load] : []), `${stopped}.`];
}

/** One run of a step: its exit code and everything it printed. */
export type StepRun = { status: number; output: string };

export type StepOutcome = { passed: true; label: string } | { passed: false; status: number; output: string; reran: boolean };

/**
 * Runs `step` through `run` (called with the step's script, then the test files to run, if any) and
 * judges it. A seam step that failed only on timeouts or worker start-up, with its test files named
 * (RP-979), is re-run once: only those files, same script (so the same Vitest project). If they pass
 * the step passes, its label saying so; if they fail again, or anything failed other than a timeout,
 * the step has failed, and a real failure is never re-run. Nor is a step whose Postgres was
 * terminated (a 57P01 error line in its output) or no longer answers (`postgresAnswers`, RP-994): the first
 * output, which names it, is kept.
 */
export async function runStep(step: string, run: (args: string[]) => StepRun, postgresAnswers: () => Promise<boolean> = async () => true): Promise<StepOutcome> {
  const first = run([step]);
  if (first.status === 0) return { passed: true, label: step };
  const files = [...(readLoadFailure(step, first.output)?.files ?? [])];
  if (files.length === 0 || !(await postgresAnswers())) return { passed: false, ...first, reran: false };
  const second = run([step, ...files]);
  if (second.status !== 0) return { passed: false, ...second, reran: true };
  return { passed: true, label: `${step} (re-ran ${files.length} timed-out file${files.length === 1 ? "" : "s"})` };
}

/** The last `count` lines of `output`. */
export function tail(output: string, count: number): string {
  return output.trimEnd().split("\n").slice(-count).join("\n");
}
