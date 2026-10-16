import { migrationsDir } from "./migrations.ts";

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

/**
 * When `step` (a seam suite) failed only on timeouts or worker start-up, the message `pnpm verify`
 * adds: likely machine load, the timed-out tests, and the command to rerun only their files.
 * Undefined for any other failure. It never makes the step pass.
 */
export function loadFailure(step: string, output: string): string | undefined {
  if (!step.startsWith("test:seam")) return undefined;
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
  if (!loadSeen) return undefined;
  const rerun = `pnpm ${step}${[...files].map((file) => ` ${file}`).join("")}`;
  return [
    `${step} failed only on timeouts or worker start-up: likely machine load (other test runs on this machine), not this diff.`,
    ...(timedOut.size > 0 ? ["Timed out:", ...[...timedOut].map((name) => `  ${name}`)] : []),
    `Rerun ${files.size > 0 ? "only them" : "the step"} when the machine is quieter: ${rerun}`,
    "The step still failed: verify does not pass it on its own.",
  ].join("\n");
}

/** The last `count` lines of `output`. */
export function tail(output: string, count: number): string {
  return output.trimEnd().split("\n").slice(-count).join("\n");
}
