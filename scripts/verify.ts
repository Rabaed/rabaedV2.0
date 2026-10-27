import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { branchClaims } from "./check-claims.ts";
import { branchMix } from "./shared-files.ts";
import { postgresDown, postgresOfEnv, tcpReachable } from "./test-services.ts";
import { acquireLock, lockFile, releaseLock } from "./verify-lock.ts";
import { verifyOptions } from "./verify-options.ts";
import { openLog, verifyOutput } from "./verify-output.ts";
import { failureEnd, finalLine, isSeamStep, runCommand, runStep, selectSteps, startFrom, tail } from "./verify-steps.ts";
import { isRunning } from "./worktrees-stale.ts";

// `pnpm verify` (RP-459): every check an implementer runs before pushing, in one
// command. Stops at the first failing step and names it. Each step is judged by
// its exit code (a seam step that failed only on timeouts gets one re-run of just
// those files, RP-979); a failing step prints the tail of its output, so a setup
// failure shows. Needs the lane's .env (`pnpm lane:env`), and stops before the
// first step when its Postgres doesn't answer; a seam step whose Postgres was
// terminated mid-run ends on one line saying so (RP-994). A branch that mixes root
// shared files with code gets a warning first and again above the last line (RP-993).
// A shared module changed with no open RP-603 claim for the branch's key stops it (RP-1008).
// `--from <step>` starts at that step, and the last line names the steps it left out;
// `--log <file>` writes everything to the file and prints only the last line (RP-1019).

const root = process.cwd();
const pnpm = join(import.meta.dirname, "pnpm.ts");
const tailLines = 40;

const options = verifyOptions(process.argv.slice(2));
if (!options.ok) {
  console.error(options.message);
  process.exit(1);
}
const terminal = { stdout: (text: string) => console.log(text), stderr: (text: string) => console.error(text) };
// To the terminal until the log is open: a refused run must not empty the log of the run that holds the lock.
let out = verifyOutput(terminal);

/** Stops before the first step: `message`, then the last line saying so. */
function stopEarly(message: string, code = 1): never {
  out.error(message);
  out.end(["pnpm verify stopped before its first step."], true);
  process.exit(code);
}

// One verify per worktree, before any other check (RP-996): a second run would share the
// lane's databases and fail both. Released on every exit; Ctrl-C and SIGTERM exit non-zero.
const lock = lockFile(root);
const taken = acquireLock(lock, { pid: process.pid, started: new Date(), command: ["pnpm verify", ...process.argv.slice(2)].join(" ") }, isRunning);
if (!taken.acquired) stopEarly(`${taken.message} Let it finish; if that pid is not a verify run, delete ${lock}.`);
process.on("exit", () => releaseLock(lock, process.pid));
// A last line for an interrupted run too, so a background run's notification still says how it ended.
const interrupted = (signal: string, code: number) => () => {
  out.end([`pnpm verify stopped: interrupted (${signal}).`], true);
  process.exit(code);
};
process.on("SIGINT", interrupted("SIGINT", 130));
process.on("SIGTERM", interrupted("SIGTERM", 143));

try {
  if (options.log !== undefined) out = verifyOutput({ ...terminal, log: openLog(resolve(root, options.log)) });
} catch (error) {
  stopEarly(error instanceof Error ? error.message : String(error));
}
if (taken.tookOver) out.info(`verify ${taken.tookOver}`);

// Rule 3 before anything runs (RP-993): root shared files (the lockfile, say) beside code
// showed only at `pnpm queue`, by the same rule, after the whole branch was built. A warning,
// said again above the last line, not a stop: a feature branch may build on a dependencies-only
// PR that has not merged yet.
let mix: string[] | undefined;
try {
  mix = branchMix(root);
} catch (error) {
  stopEarly(error instanceof Error ? error.message : String(error));
}
const mixWarning = mix && [
  // eslint-disable-next-line rabaed/no-avoid-terms -- git's changed files and `pnpm queue` (GitHub's merge queue), by their own names.
  "Warning: this branch changes root shared file(s) together with other files against origin/main, so `pnpm queue` will refuse it (planning/parallel-sessions.md rule 3):",
  ...mix,
  "(Against an old origin/main, main's own changes count too: `git fetch origin main` first.)",
].join("\n");
if (mixWarning) out.error(`${mixWarning}\n`);

// Rule 12 (RP-1008): a shared module changed with no open RP-603 claim for the branch's key
// stops here, before the build; with no Jira credentials or network it is a warning.
let claimsWarning = "";
try {
  const claims = await branchClaims(root);
  if (!claims.ok) stopEarly(claims.message);
  claimsWarning = claims.message;
} catch (error) {
  stopEarly(error instanceof Error ? error.message : String(error));
}
if (claimsWarning) out.error(`${claimsWarning}\n`);

// The lane's Postgres first (RP-575): a stopped container otherwise showed only at
// test:seam1, after every step before it had run.
const envFile = join(root, ".env");
const postgres = existsSync(envFile) ? postgresOfEnv(readFileSync(envFile, "utf8")) : undefined;
if (!postgres) stopEarly("No Postgres in this worktree's .env: run `pnpm lane:env <n>` first.");
const postgresAnswers = () => tcpReachable(postgres.host, postgres.port);
if (!(await postgresAnswers())) stopEarly(postgresDown(postgres));

const diff = spawnSync("git", ["diff", "--name-only", "origin/main"], { cwd: root, encoding: "utf8" });
if (diff.status !== 0) stopEarly("git diff against origin/main failed; run `git fetch origin main` first.", diff.status ?? 1);
const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
const changed = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean);

const selected = selectSteps(changed);
for (const { name, reason } of selected.skipped) out.info(`skip ${name}: ${reason}`);
// `--from` (RP-1019): the steps before it are left out, and the last line names them.
const resumed = options.from === undefined ? selected : startFrom(selected, options.from);
if ("error" in resumed) stopEarly(resumed.error);
const { steps } = resumed;
const from = "from" in resumed ? resumed.from : undefined;
for (const name of from?.notRun ?? []) out.info(`skip ${name}: before --from ${from?.step}`);

const passed: string[] = [];
for (const { name, script } of steps) {
  const started = Date.now();
  out.info(`run  ${name} ...`);
  let exit = "";
  // A step's name is its pnpm script. runStep calls this with that script, then the test files of a
  // re-run (RP-979: a seam step that failed only on timeouts is re-run once, on just those files,
  // unless its Postgres was terminated or no longer answers, RP-994).
  const outcome = await runStep(
    script,
    (args) => {
      const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      exit = String(result.status ?? result.error?.message);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      out.stepOutput(["pnpm", ...args].join(" "), output);
      return { status: result.error ? 1 : (result.status ?? 1), output };
    },
    postgresAnswers,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.passed) {
    out.info(`ok   ${outcome.label} (${seconds}s)`);
    passed.push(outcome.label);
    continue;
  }
  out.error(`FAIL ${name} (${seconds}s, exit ${exit}${outcome.reran ? ", after one re-run" : ""}). The last ${tailLines} lines it printed:`);
  out.error(tail(outcome.output, tailLines));
  // Then a note for only timeouts or workers that never started (RP-607), and the stop line, which
  // says so when Postgres was terminated or no longer answers (RP-994: Docker stopped mid-run).
  const answers = isSeamStep(name) ? await postgresAnswers() : true;
  out.end(failureEnd(name, outcome.output, answers, runCommand(from)), true);
  process.exit(outcome.status);
}
const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (mixWarning) out.error(`\n${mixWarning}`);
if (claimsWarning) out.error(`\n${claimsWarning}`);
out.end([finalLine({ sha, dirty: status !== "", steps: passed, ...(from ? { from } : {}) })], false);
