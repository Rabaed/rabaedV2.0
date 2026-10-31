// `pnpm lanes [--main N]` (RP-1170): every rabaed-* stack with its lane, Main, worktrees, PR and its
// state, whether a verify runs, and how long it has been idle (lane-rows.ts), under a line with the
// running stacks against the cap. It only reads: Docker, git, gh and the verify locks.
// Until its package.json line lands: node scripts/lanes-status.ts [--main N].
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { formatRows, laneRows, parseLanesArgs } from "./lane-rows.ts";
import { composeProjectOfEnv, listContainers, listVolumes, readWorktreeEnv, type Volume } from "./lanes.ts";
import { maxStacks, runningStacks } from "./machine-load.ts";
import { processStart } from "./process-start.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";
import { liveHolder, lockFile, type LockHolder, type Processes } from "./verify-lock.ts";
import { isRunning, readActivity } from "./worktrees-stale.ts";
import { listWorktrees } from "./worktrees.ts";

const options = parseLanesArgs(process.argv.slice(2));
if ("error" in options) {
  console.error(options.error);
  process.exit(1);
}

const containers = listContainers(DOCKER_TIMEOUT_MS);
let volumes: Volume[] | undefined;
try {
  volumes = containers && listVolumes(DOCKER_TIMEOUT_MS);
} catch {
  volumes = undefined;
}
if (!containers || !volumes) {
  console.error(`Docker is not answering (no answer in ${DOCKER_TIMEOUT_MS / 1000} s): it is stopped or jammed. Tell your Main; do not restart it yourself.`);
  process.exit(1);
}

const worktrees = listWorktrees().map((w) => ({ path: w.path, branch: w.branch, project: existsSync(w.path) ? composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") : undefined }));
let prs: { number: number; headRefName: string; state: string; isDraft: boolean }[] = [];
let prWarning: string | undefined;
try {
  prs = JSON.parse(execFileSync("gh", ["pr", "list", "--state", "all", "--limit", "300", "--json", "number,headRefName,state,isDraft"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch {
  prWarning = "gh could not list the PRs: the PR column is empty.";
}
const processes: Processes = { isAlive: isRunning, startOf: processStart, ancestors: [] };
const self: LockHolder = { pid: process.pid, started: new Date(), command: "pnpm lanes" };

const rows = laneRows({
  containers,
  volumes,
  worktrees,
  prs,
  verifyOf: (path) => liveHolder(lockFile(path), self, processes),
  activityOf: (path) => {
    const a = readActivity(path);
    const times = [a?.lastCommit, a?.newestChange].filter((t): t is number => t !== undefined);
    return times.length === 0 ? undefined : Math.max(...times);
  },
  exists: existsSync,
  now: Date.now(),
  main: options.main,
});
console.log(`Running stacks: ${runningStacks(containers).length} of ${maxStacks(process.env)}.`);
if (rows.length === 0 && options.main !== undefined) console.log(`No rabaed-* stacks for Main ${options.main}.`);
else for (const line of formatRows(rows)) console.log(line);
if (prWarning) console.log(prWarning);
