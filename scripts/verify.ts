import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { branchClaims } from "./check-claims.ts";
import { dockerStop, probeDocker } from "./docker-probe.ts";
import { composeProjectOfEnv, envValue, readWorktreeEnv } from "./lanes.ts";
import { mergeRefusal, readMergeState } from "./merge-in-progress.ts";
import { samePath } from "./paths.ts";
import { branchMix } from "./shared-files.ts";
import { postgresDown, postgresOfEnv, tcpReachable } from "./test-services.ts";
import { filesProblem, healthStop, listServiceStates, stackHealthProblems, type HealthDeps } from "./verify-health.ts";
import { laneDatabaseRefusal } from "./verify-lane-db.ts";
import { processAncestors, processStart } from "./process-start.ts";
import { acquireLock, liveHolder, lockFile, releaseLock, type LockHolder, type Processes } from "./verify-lock.ts";
import { machineDir, machineLockFile, oldSlotsOf, removePlaces, waitForTurn } from "./verify-queue.ts";
import { verifyOptions } from "./verify-options.ts";
import { verifyOverlap } from "./verify-overlap.ts";
import { prHeadRefusal, realPrBodySeam, writeVerifyLine } from "./verify-pr-body.ts";
import { openLog, verifyOutput } from "./verify-output.ts";
import { failureEnd, finalLine, headMoved, isSeamStep, runCommand, runStep, selectSteps, startFrom, tail, type StepRun } from "./verify-steps.ts";
import { snapshotHash, systemFileHash, systemGit, treeChanged, treeSnapshot, watchTree } from "./verify-tree.ts";
import { isRunning } from "./worktrees-stale.ts";
import { listWorktrees } from "./worktrees.ts";

// `pnpm verify` (RP-459): every check an implementer runs before pushing, in one
// command. Stops at the first failing step and names it. Each step is judged by
// its exit code (a seam step that failed only on timeouts gets one re-run of just
// those files, RP-979); a failing step prints the tail of its output, so a setup
// failure shows. Needs the lane's .env (`pnpm lane:env`), and stops before the
// first step when its Postgres doesn't answer; a seam step whose Postgres was
// terminated mid-run ends on one line saying so (RP-994). A branch that mixes root
// shared files with code gets a warning first and again above the last line (RP-993).
// Open PRs that change the same files get a warning before the first step and above the last line (RP-1191); it never stops the run.
// A shared module changed with no open RP-603 claim for the branch's key stops it (RP-1008),
// and so does a merge in progress (MERGE_HEAD), naming its conflicted files (RP-1101).
// Before the first step it checks Docker, the db and rustfs (Postgres only when no seam step runs) and stops with what is down, then
// waits its turn in the machine-wide verify line: one full verify runs on the machine at a time (RP-1197; was one per Main, RP-1096).
// `--pr <n>` writes the stamped last line into PR n's body after a full, clean run, and refuses unless HEAD is the PR's head (RP-1171).
// `--from <step>` starts at that step, and the last line names the steps it left out;
// `--log <file>` writes everything to the file and prints only the last line (RP-1019).
// HEAD moving during the run (a pull, Auto-fix merging main) stops it after that step, with no verify line (RP-1103).
// RP-1169: so does the working tree changing (verify-tree.ts: the tracked and untracked files that differ from HEAD), checked
// after every step, once more after waiting for its turn, and every 15 s during a step, which is killed at once
// (a merge by the app's base-branch sync half-done). A live verify in another worktree on the same lane database (same
// compose project or Postgres port) stops it before the first step (verify-lane-db.ts).

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

// RP-1197: Docker not answering stops the run here, before it queues for the lock, so a jammed Docker never holds a place in line (RP-1099).
const dockerProbe = probeDocker();
const dockerStopped = dockerStop(dockerProbe, "any");
if (dockerStopped !== undefined) stopEarly(dockerStopped);

// One verify per worktree, before any other check (RP-996): a second run would share the
// lane's databases and fail both. Released on every exit; Ctrl-C and SIGTERM exit non-zero.
// Both locks record this process's OS start time and check a holder's, so a pid Windows reused is not taken for a live run (RP-1136).
const processes: Processes = { isAlive: isRunning, startOf: processStart, ancestors: [process.ppid, ...processAncestors(process.ppid)] };
const pidStarted = processStart(process.pid);
const lock = lockFile(root);
const self: LockHolder = { pid: process.pid, started: new Date(), pidStarted, command: ["pnpm verify", ...process.argv.slice(2)].join(" ") };
const taken = acquireLock(lock, self, processes);
if (!taken.acquired) stopEarly(`${taken.message} Let it finish.`);
process.on("exit", () => releaseLock(lock, process.pid));
// A last line for an interrupted run too, so a background run's notification still says how it ended.
// The step running now, killed with the run: it has a process group of its own off Windows, so Ctrl-C does not reach it.
let runningChild: ReturnType<typeof spawn> | undefined;
const interrupted = (signal: string, code: number) => () => {
  if (runningChild) killTree(runningChild);
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

// Never on a half-done merge (RP-1101): Auto-fix twice left one, a file still conflicted.
const merging = mergeRefusal(readMergeState(root), "pnpm verify");
if (merging !== undefined) stopEarly(merging);

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

// The commit this run verifies (RP-1103): HEAD is checked against it after every step, and the last line names it.
const readHead = () => {
  const done = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return done.status === 0 ? done.stdout.trim() : "";
};
const startedOn = readHead();

// `--pr <n>` (RP-1171): refuse before the long run when HEAD is not the PR's head, as a line for another commit
// would not pass the verify gate; the line is written into the PR's body at the end.
const prBody = options.pr === undefined ? undefined : realPrBodySeam(root);
if (options.pr !== undefined && prBody) {
  try {
    const refusal = prHeadRefusal(options.pr, startedOn, prBody.pullHead(options.pr));
    if (refusal) stopEarly(refusal);
  } catch (error) {
    stopEarly(`pnpm verify --pr ${options.pr}: could not read the PR's head: ${error instanceof Error ? error.message.trim() : String(error)}`);
  }
}
// And the working tree (RP-1169): HEAD stays put under a merge --no-commit or the app's base-branch sync half-done.
const git = systemGit(root);
const fileHash = systemFileHash(root);
// Not the run's own --log file, which grows as it runs.
const ownLog = options.log === undefined ? [] : [relative(root, resolve(root, options.log)).replaceAll("\\", "/")];
const readTree = () => treeSnapshot(git, fileHash, ownLog);
const startedTree = readTree();
if (startedTree) out.info(`working tree ${snapshotHash(startedTree)} (${startedTree.size} changed path${startedTree.size === 1 ? "" : "s"})`);
/** Why the run must stop: HEAD or the working tree is no longer what it started on; undefined while it is. */
const moved = (): string | undefined => headMoved(startedOn, readHead()) ?? treeChanged(startedTree, readTree());
/** The same during a step, but a HEAD that can't be read right now (a failed spawn under load) is not a move. */
const movedMidStep = (): string | undefined => {
  const head = readHead();
  return head === "" ? treeChanged(startedTree, readTree()) : (headMoved(startedOn, head) ?? treeChanged(startedTree, readTree()));
};
// Polled during a step, so a merge in the middle of a 20-minute suite stops it at once and not after it.
const watchEveryMs = 15_000;

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

// The lane's stack first (RP-575, RP-1096): Docker answers, the db and rustfs containers run
// healthy, and both answer. A stopped or jammed one otherwise showed only at test:seam1, after
// every step before it had run, or as seam suites timing out after hours.
const envFile = join(root, ".env");
const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const postgres = postgresOfEnv(envText);
if (!postgres) stopEarly("No Postgres in this worktree's .env: run `pnpm lane:env <n>` first.");
// One verify per lane database (RP-1169): another worktree's live verify on the same compose project or port stops this one.
// The git folder's worktree list is the only place to find them; without it nothing is checked, as before.
try {
  const others = listWorktrees(root)
    .filter((worktree) => !samePath(worktree.path, root))
    .map((worktree) => ({ path: worktree.path, env: readWorktreeEnv(worktree.path), holder: liveHolder(lockFile(worktree.path), self, processes) }));
  const sharedDatabase = laneDatabaseRefusal(envText, others, self);
  if (sharedDatabase !== undefined) stopEarly(sharedDatabase);
} catch (error) {
  out.error(`Could not check the other worktrees for a verify on this lane's database (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`);
}
const postgresAnswers = () => tcpReachable(postgres.host, postgres.port);
const project = composeProjectOfEnv(envText) ?? "rabaed";
const health: HealthDeps = {
  project,
  listServices: () => listServiceStates(project),
  postgres,
  dbAnswers: postgresAnswers,
  filesEndpoint: envValue(envText, "FILE_STORE_ENDPOINT"),
  filesProblem: (endpoint) => filesProblem(endpoint),
};
const checkHealth = async () => {
  const problems = await stackHealthProblems(health);
  if (problems.length > 0) stopEarly(healthStop(project, problems));
};
// Only the seam steps use the containers and the file store; without one, Postgres answering is enough (as before RP-1096).
const needsStack = steps.some(({ name }) => isSeamStep(name));
const checkStack = async () => {
  if (needsStack) await checkHealth();
  else if (!(await postgresAnswers())) stopEarly(postgresDown(postgres));
};
await checkStack();

// One full verify at a time on the whole machine (RP-1197, which replaces RP-1096's one per Main): a run waits
// its turn in a line in a folder outside every clone and prints its place. Held to the last step, released on every exit.
const line = machineDir();
process.on("exit", () => {
  releaseLock(machineLockFile(line), process.pid);
  removePlaces(line, process.pid);
});
// With --log the waiting lines go to the terminal too, so a run that waits is not silent there; the last line is still verify's.
const reportWait = (line: string) => {
  out.info(line);
  if (options.log !== undefined) terminal.stderr(line);
};
const turn = await waitForTurn(
  line,
  { pid: process.pid, started: new Date(), pidStarted, command: `pnpm verify in ${root}`, lane: postgres.lane, pr: options.pr, worktree: root },
  { processes, now: Date.now, sleep: (ms) => new Promise((done) => setTimeout(done, ms)), report: reportWait, oldSlots: oldSlotsOf(root) },
);
if (turn.tookOver) out.info(`verify ${turn.tookOver}`);
if (turn.waitedMs > 0) {
  out.info(`Got the machine's verify turn after ${Math.round(turn.waitedMs / 60_000)} min.`);
  // The stack may have gone down while this run waited.
  await checkStack();
  // And the branch may have moved: the run starts on what it waited with, not on what it began as.
  const waitedMove = moved();
  if (waitedMove !== undefined) stopEarly(`${runCommand(from)} stopped before its first step: ${waitedMove}`);
}

// Open PRs that change this branch's files (RP-1191, scripts/verify-overlap.ts): a warning, here and again above the last
// line, never a stop. A conflict with a PR that merges first voids the verify line this run is about to write. After the
// refusals and the wait for the slot, so a run that stops early or waited hours does not print a stale one; the working
// tree is already watched (startedTree), so an edit made during the look still stops the run after the first step.
const overlaps = await verifyOverlap(root);
if (overlaps) out.error(`${overlaps}\n`);

/** Kills a step's whole process tree: pnpm starts vitest and the like, so the child alone is not enough. */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** One `pnpm <args>` in the worktree, run async so the poll can fire while it runs; everything it printed, stdout then stderr. */
function runPnpm(args: string[], onSpawn: (child: ReturnType<typeof spawn>) => void): Promise<StepRun & { exit: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [pnpm, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    onSpawn(child);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const output = () => `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`;
    child.on("error", (error) => (runningChild = undefined, done({ status: 1, output: output(), exit: error.message })));
    child.on("close", (code) => (runningChild = undefined, done({ status: code ?? 1, output: output(), exit: String(code) })));
  });
}

const passed: string[] = [];
for (const { name, script } of steps) {
  const started = Date.now();
  out.info(`run  ${name} ...`);
  let exit = "";
  // A step's name is its pnpm script. runStep calls this with that script, then the test files of a
  // re-run (RP-979: a seam step that failed only on timeouts is re-run once, on just those files,
  // unless its Postgres was terminated or no longer answers, RP-994).
  // The poll (RP-1169): HEAD or the working tree changing while the step runs kills it and ends the run at once.
  let changedMidStep: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  const stopWatching = watchTree({
    check: movedMidStep,
    onChange: (message) => {
      changedMidStep = message;
      if (child) killTree(child);
    },
    everyMs: watchEveryMs,
    setTimer: (tick, ms) => setInterval(tick, ms),
    clearTimer: (timer) => clearInterval(timer as NodeJS.Timeout),
  });
  const outcome = await runStep(
    script,
    async (args) => {
      if (changedMidStep !== undefined) return { status: 1, output: "" };
      const result = await runPnpm(args, (started) => (child = runningChild = started));
      exit = String(result.exit);
      out.stepOutput(["pnpm", ...args].join(" "), result.output);
      return { status: result.status, output: result.output };
    },
    postgresAnswers,
  );
  stopWatching();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  // A pull or Auto-fix's merge of main mid-run (RP-1103): stop now, with no line to paste.
  const stopReason = changedMidStep ?? moved();
  if (outcome.passed) {
    out.info(`ok   ${outcome.label} (${seconds}s)`);
    passed.push(outcome.label);
    if (stopReason !== undefined) {
      out.end([`${runCommand(from)} stopped after ${name}: ${stopReason}`], true);
      process.exit(1);
    }
    continue;
  }
  out.error(`FAIL ${name} (${seconds}s, exit ${exit}${outcome.reran ? ", after one re-run" : ""}). The last ${tailLines} lines it printed:`);
  out.error(tail(outcome.output, tailLines));
  // The failure may come from the move rather than the diff: say so instead of the usual stop line.
  if (stopReason !== undefined) {
    out.end([`${runCommand(from)} stopped at ${name}: ${stopReason}`], true);
    process.exit(outcome.status || 1);
  }
  // Then a note for only timeouts or workers that never started (RP-607), and the stop line, which
  // says so when Postgres was terminated or no longer answers (RP-994: Docker stopped mid-run).
  const answers = isSeamStep(name) ? await postgresAnswers() : true;
  out.end(failureEnd(name, outcome.output, answers, runCommand(from)), true);
  process.exit(outcome.status);
}
const sha = startedOn === "" ? "" : spawnSync("git", ["rev-parse", "--short", startedOn], { cwd: root, encoding: "utf8" }).stdout.trim();
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (mixWarning) out.error(`\n${mixWarning}`);
if (claimsWarning) out.error(`\n${claimsWarning}`);
if (overlaps) out.error(`\n${overlaps}`);
const last = finalLine({ sha, dirty: status !== "", steps: passed, ...(from ? { from } : {}) });
if (options.pr !== undefined && prBody) {
  // A full, clean run on the PR's head only (writeVerifyLine checks the stamp and the head again, the PR may have been pushed to meanwhile).
  const written = writeVerifyLine(options.pr, last, startedOn, prBody);
  if (!written.ok) {
    out.error(`${written.message}\nThe line, to paste by hand:\n${last}`);
    out.end([`pnpm verify --pr ${options.pr} stopped: the line was not written to the PR body.`], true);
    process.exit(1);
  }
  out.info(`pnpm verify --pr ${options.pr}: ${written.replaced ? "replaced the verify line in" : "added the verify line to"} PR #${options.pr}'s body.`);
}
out.end([last], false);
