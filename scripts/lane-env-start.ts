import { spawnSync } from "node:child_process";

// `pnpm lane:env` starts the lane's containers after it writes .env (RP-1169): verifies started on a stack that
// was down (#536, #542, lane 41's first RP-1100 run) because it only wrote the file. The docker call is passed in,
// so what it says in each case is unit-tested without Docker.

/** The command that starts a lane's stack, run from the worktree whose .env was just written. */
export const startCommand = (project: string): string => `docker compose -p ${project} up -d --wait`;

/** One `docker compose` run: its exit code (null when it could not start) and what it printed. */
export type ComposeRun = { status: number | null; output: string; error?: string };

export type StartDeps = {
  /** Whether Docker answers (lane-env already listed the containers, or couldn't). */
  dockerRunning: boolean;
  /** Runs `docker` with these arguments in the worktree. */
  compose: (args: string[]) => ComposeRun;
};

export type StartResult = { started: boolean; lines: string[] };

/**
 * Starts the stack of `project` and says what happened: started, or plainly that it was not and the exact command to
 * run. `reason` is why a caller skips it (a `--db` worktree shares a lane's stack, which belongs to the lane's session).
 */
export function startStack(project: string, { dockerRunning, compose }: StartDeps, reason?: string): StartResult {
  const command = startCommand(project);
  if (reason !== undefined) return { started: false, lines: [`The containers were NOT started: ${reason} To start them: ${command}`] };
  if (!dockerRunning) return { started: false, lines: [`The containers were NOT started: Docker is not running. Start Docker Desktop, then run: ${command}`] };
  const args = ["compose", "-p", project, "up", "-d", "--wait"];
  const run = compose(args);
  if (run.status === 0) return { started: true, lines: [`Started the containers of ${project} and waited until they are healthy (${command}).`] };
  const why = run.error ?? run.output.trim().split("\n").slice(-6).join("\n");
  return {
    started: false,
    lines: [`The containers were NOT started: \`${command}\` failed${run.status === null ? "" : ` (exit ${run.status})`}.`, ...(why === "" ? [] : [why]), `Fix that, then run: ${command}`],
  };
}

/** Docker in the current folder, for real; five minutes is room for a first image pull and the health checks. */
export const systemCompose = (args: string[]): ComposeRun => {
  const done = spawnSync("docker", args, { encoding: "utf8", timeout: 300_000, windowsHide: true });
  return { status: done.status, output: `${done.stdout ?? ""}${done.stderr ?? ""}`, ...(done.error ? { error: done.error.message } : {}) };
};
