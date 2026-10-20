import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { branchClaims } from "./check-claims.ts";
import { branchMix } from "./shared-files.ts";
import { postgresDown, postgresOfEnv, tcpReachable } from "./test-services.ts";
import { acquireLock, lockFile, releaseLock } from "./verify-lock.ts";
import { failureEnd, finalLine, isSeamStep, runStep, selectSteps, tail } from "./verify-steps.ts";
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

const root = process.cwd();
const pnpm = join(import.meta.dirname, "pnpm.ts");
const tailLines = 40;

// One verify per worktree, before any other check (RP-996): a second run would share the
// lane's databases and fail both. Released on every exit; Ctrl-C and SIGTERM exit non-zero.
const lock = lockFile(root);
const taken = acquireLock(lock, { pid: process.pid, started: new Date(), command: ["pnpm verify", ...process.argv.slice(2)].join(" ") }, isRunning);
if (!taken.acquired) {
  console.error(`${taken.message} Let it finish; if that pid is not a verify run, delete ${lock}.`);
  process.exit(1);
}
if (taken.tookOver) console.log(`verify ${taken.tookOver}`);
process.on("exit", () => releaseLock(lock, process.pid));
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// Rule 3 before anything runs (RP-993): root shared files (the lockfile, say) beside code
// showed only at `pnpm queue`, by the same rule, after the whole branch was built. A warning,
// said again above the last line, not a stop: a feature branch may build on a dependencies-only
// PR that has not merged yet.
let mix: string[] | undefined;
try {
  mix = branchMix(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const mixWarning = mix && [
  // eslint-disable-next-line rabaed/no-avoid-terms -- git's changed files and `pnpm queue` (GitHub's merge queue), by their own names.
  "Warning: this branch changes root shared file(s) together with other files against origin/main, so `pnpm queue` will refuse it (planning/parallel-sessions.md rule 3):",
  ...mix,
  "(Against an old origin/main, main's own changes count too: `git fetch origin main` first.)",
].join("\n");
if (mixWarning) console.error(`${mixWarning}\n`);

// Rule 12 (RP-1008): a shared module changed with no open RP-603 claim for the branch's key
// stops here, before the build; with no Jira credentials or network it is a warning.
let claimsWarning = "";
try {
  const claims = await branchClaims(root);
  if (!claims.ok) {
    console.error(claims.message);
    process.exit(1);
  }
  claimsWarning = claims.message;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (claimsWarning) console.error(`${claimsWarning}\n`);

// The lane's Postgres first (RP-575): a stopped container otherwise showed only at
// test:seam1, after every step before it had run.
const envFile = join(root, ".env");
const postgres = existsSync(envFile) ? postgresOfEnv(readFileSync(envFile, "utf8")) : undefined;
if (!postgres) {
  console.error("No Postgres in this worktree's .env: run `pnpm lane:env <n>` first.");
  process.exit(1);
}
const postgresAnswers = () => tcpReachable(postgres.host, postgres.port);
if (!(await postgresAnswers())) {
  console.error(postgresDown(postgres));
  process.exit(1);
}

const diff = spawnSync("git", ["diff", "--name-only", "origin/main"], { cwd: root, encoding: "utf8" });
if (diff.status !== 0) {
  console.error("git diff against origin/main failed; run `git fetch origin main` first.");
  process.exit(diff.status ?? 1);
}
const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
const changed = [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean);

const { steps, skipped } = selectSteps(changed);
for (const { name, reason } of skipped) console.log(`skip ${name}: ${reason}`);

const passed: string[] = [];
for (const { name, script } of steps) {
  const started = Date.now();
  console.log(`run  ${name} ...`);
  let exit = "";
  // A step's name is its pnpm script. runStep calls this with that script, then the test files of a
  // re-run (RP-979: a seam step that failed only on timeouts is re-run once, on just those files,
  // unless its Postgres was terminated or no longer answers, RP-994).
  const outcome = await runStep(
    script,
    (args) => {
      const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      exit = String(result.status ?? result.error?.message);
      return { status: result.error ? 1 : (result.status ?? 1), output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    },
    postgresAnswers,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.passed) {
    console.log(`ok   ${outcome.label} (${seconds}s)`);
    passed.push(outcome.label);
    continue;
  }
  console.error(`FAIL ${name} (${seconds}s, exit ${exit}${outcome.reran ? ", after one re-run" : ""}). Tail of its output:`);
  console.error(tail(outcome.output, tailLines));
  // Then a note for only timeouts or workers that never started (RP-607), and the stop line, which
  // says so when Postgres was terminated or no longer answers (RP-994: Docker stopped mid-run).
  const answers = isSeamStep(name) ? await postgresAnswers() : true;
  for (const line of failureEnd(name, outcome.output, answers)) console.error(`\n${line}`);
  process.exit(outcome.status);
}
const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (mixWarning) console.error(`\n${mixWarning}`);
if (claimsWarning) console.error(`\n${claimsWarning}`);
console.log(`\n${finalLine({ sha, dirty: status !== "", steps: passed })}`);
