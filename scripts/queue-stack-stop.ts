import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { composeProjectOfEnv, listContainers, protectedLaneReason, readWorktreeEnv, type Container } from "./lanes.ts";
import { processStart } from "./process-start.ts";
import { describeServer, findServers } from "./servers.ts";
import { describeHolder, liveHolder, lockFile, type LockHolder } from "./verify-lock.ts";
import { isRunning } from "./worktrees-stale.ts";
import { listWorktrees } from "./worktrees.ts";

// RP-1170: once `pnpm queue` has queued a PR, the lane's stack has done its job: the queue runs CI, not
// the lane. On 2026-10-31 idle stacks held Docker at its cap of 8 while #539 waited. So queue-pr.ts stops
// the stack of the worktree on the PR's branch, with `docker stop`: the containers stay, and so do the
// volumes (its database), and `docker compose up` starts them again if the queue drops the PR. It leaves the
// stack running when another worktree's .env has it (a subagent with --db, the lane's next ticket), a verify
// or a dev server uses it, or it is lane 7's (Main 7's harness). It never fails the queue: a stop that
// Docker refuses is a warning.

/** What chooseStackStop judges, read by stopQueuedStack's caller (realStopInput) or a test. */
export type StopInput = {
  pr: number;
  /** The PR's head branch. */
  branch: string;
  /** Every worktree of this clone, with COMPOSE_PROJECT_NAME from its .env. */
  worktrees: { path: string; branch: string | undefined; project: string | undefined }[];
  containers: Container[];
  /** The live verify holding a worktree's lock, or undefined. */
  verifyIn: (path: string) => LockHolder | undefined;
  /** The worktree's running dev servers, described. */
  serversIn: (path: string) => string[];
  platform?: NodeJS.Platform;
};

export type StopDecision = { stop: { project: string; containers: string[]; path: string } | undefined; lines: string[] };

/** Which containers to stop, or why none (lines). */
export function chooseStackStop({ branch, worktrees, containers, verifyIn, serversIn }: StopInput): StopDecision {
  const none = (...lines: string[]): StopDecision => ({ stop: undefined, lines });
  const own = worktrees.find((w) => w.branch === branch);
  if (own === undefined) return none(`No worktree of this clone is on ${branch}: no stack stopped.`);
  const project = own.project;
  if (project === undefined || !project.startsWith("rabaed-")) return none(`${own.path}'s .env has no stack: none stopped.`);
  const left = (why: string) => `Stack ${project} left running: ${why}.`;
  const harness = protectedLaneReason(project);
  if (harness !== undefined) return none(left(harness));
  const sharers = worktrees.filter((w) => w !== own && w.project === project);
  if (sharers.length > 0) return none(...sharers.map((w) => left(`the .env of ${w.path} (on ${w.branch ?? "a detached HEAD"}) has it too`)));
  const verify = verifyIn(own.path);
  if (verify !== undefined) return none(left(`a verify runs in ${own.path} (${describeHolder(verify)})`));
  const servers = serversIn(own.path);
  if (servers.length > 0) return none(left(`${own.path} runs a dev server (${servers.join("; ")}); \`pnpm servers:stop --yes\` there, then \`docker compose stop\``));
  const running = containers.filter((c) => c.project === project && c.state === "running").map((c) => c.name);
  if (running.length === 0) return none(`Stack ${project} is already stopped.`);
  return { stop: { project, containers: running, path: own.path }, lines: [] };
}

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

/** Stops the containers chooseStackStop picks (`docker stop`, so nothing is removed); the lines to print. Never throws. */
export function stopQueuedStack(input: StopInput, run: (args: string[]) => string = docker): string[] {
  const { stop, lines } = chooseStackStop(input);
  if (stop === undefined) return lines;
  try {
    run(["stop", ...stop.containers]);
  } catch (error) {
    const why = (error as { stderr?: string }).stderr?.trim() || (error as Error).message;
    return [`Warning: could not stop ${stop.project} (${why}); the PR is queued all the same. Run \`docker compose stop\` in ${stop.path}.`];
  }
  return [
    // eslint-disable-next-line rabaed/no-avoid-terms -- GitHub's merge queue, by its own name
    `Stopped ${stop.project}'s containers to free a Docker slot; its volumes stay. If the queue drops PR #${input.pr}, start them again in ${stop.path} with \`docker compose up -d --wait db mailpit files\`.`,
  ];
}

/** The real facts for the PR's branch: git's worktrees, their .env files, Docker's containers, the verify locks and dev servers. Throws when git or Docker cannot be read. */
export function realStopInput(pr: number, branch: string): StopInput {
  const listed = listWorktrees();
  const worktrees = listed.map((w) => ({ path: w.path, branch: w.branch, project: existsSync(w.path) ? composeProjectOfEnv(readWorktreeEnv(w.path) ?? "") : undefined }));
  const containers = listContainers(30_000);
  if (containers === undefined) throw new Error("Docker did not answer");
  // eslint-disable-next-line rabaed/no-avoid-terms -- the `pnpm queue` command, by its own name
  const self: LockHolder = { pid: process.pid, started: new Date(), command: "pnpm queue" };
  return {
    pr,
    branch,
    worktrees,
    containers,
    verifyIn: (path) => liveHolder(lockFile(path), self, { isAlive: isRunning, startOf: processStart, ancestors: [] }),
    serversIn: (path) =>
      findServers(
        path,
        listed.map((w) => w.path),
      ).map(describeServer),
  };
}
