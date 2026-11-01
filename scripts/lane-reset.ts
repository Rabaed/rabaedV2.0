// `pnpm lane:reset <n> [--yes]` (RP-1197, item 4): removes ONE lane's compose project (rabaed-lane<n>)
// containers and volumes, so `pnpm lane:env <n> --force` starts it fresh. It exists because on
// 2026-10-31 lane 33's Postgres volume was corrupt (RP-1166) and the only cure was `docker volume rm`,
// which auto mode refuses to run as a loose command. This is one command with its guards built in, so
// the owner can allow-list `node scripts/lane-reset.ts` instead of Docker itself.
//
//   node scripts/lane-reset.ts <n> [--yes]
//
// It lists the project's volumes, refuses (before any prompt) when:
//   - the lane is protected (lane 7 is Main 7's harness, lanes.ts protectedLaneReason);
//   - Docker does not answer;
//   - any verify runs anywhere on the machine (verifies-running.ts), or that cannot be checked;
//   - a running or open Claude session works in a folder that holds the project (its containers'
//     folders or another worktree whose .env names it); this worktree's own session is the owner's;
//   - another worktree's .env names the project (envClaims).
// Otherwise it asks [y/N] (--yes skips it), looks again, and removes that project only (removeProject):
// a project matches by its exact compose name, so rabaed-lane3 never matches rabaed-lane31.
// Exit codes: 0 done or nothing to remove, 1 refused or failed, 2 bad arguments.
import { existsSync } from "node:fs";
import { holdReason, systemHolders, type Holders } from "./claude-sessions.ts";
import { confirmOrExit } from "./confirm.ts";
import {
  envClaims,
  isValidLane,
  LANE_SCHEME,
  laneProject,
  listContainers,
  listVolumes,
  protectedLaneReason,
  readWorktreeEnv,
  removeProject,
  type Container,
  type EnvClaim,
  type RemoveProjectOptions,
  type StaleProject,
  type Volume,
} from "./lanes.ts";
import { verifiesRunningNow, volumesKeptReason, type VerifyCheck } from "./verifies-running.ts";
import { DOCKER_TIMEOUT_MS } from "./verify-health.ts";
import { listWorktrees } from "./worktrees.ts";

const USAGE = "Usage: pnpm lane:reset <n> [--yes]   (removes lane n's containers and volumes; nothing else)";

/** lane:reset's arguments, or the message to print. */
export function parseLaneResetArgs(args: string[]): { lane: number; yes: boolean } | { error: string } {
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1 || args.some((a) => a.startsWith("--") && a !== "--yes")) return { error: USAGE };
  const lane = Number(positional[0]);
  if (!/^\d+$/.test(positional[0]!) || !isValidLane(lane)) return { error: `${positional[0]} is not a lane: ${LANE_SCHEME}.\n${USAGE}` };
  return { lane, yes: args.includes("--yes") };
}

/** What the project holds: its containers and volumes, by its exact compose project name. */
export function projectParts(project: string, containers: Container[], volumes: Volume[]): StaleProject {
  return {
    project,
    reason: "lane:reset",
    containers: containers.filter((c) => c.project === project).map((c) => c.name),
    volumes: volumes.filter((v) => v.project === project).map((v) => v.name),
  };
}

/** Everything lane:reset reads or does outside this file; faked in tests. */
export type ResetDeps = {
  cwd: string;
  /** Containers, or undefined when Docker did not answer. */
  listContainers: () => Container[] | undefined;
  /** Volumes; throws when Docker did not answer. */
  listVolumes: () => Volume[];
  worktrees: () => { path: string; branch: string | undefined }[];
  readEnv: (dir: string) => string | undefined;
  exists: (dir: string) => boolean;
  holders: () => Holders;
  verifies: () => VerifyCheck;
  remove: (stale: StaleProject, options: RemoveProjectOptions) => { volumesKept: string | undefined };
  /** Resolves true to go on; false to stop (the real one exits itself on no). */
  confirm: (question: string) => Promise<boolean>;
  log: (line: string) => void;
  error: (line: string) => void;
  platform?: NodeJS.Platform;
};

type Look = { parts: StaleProject; refusals: string[] } | { dockerDown: string };

/** One look at the machine: the project's parts, and every reason not to remove it. */
function look(lane: number, d: ResetDeps): Look {
  const project = laneProject(lane);
  const containers = d.listContainers();
  let volumes: Volume[];
  try {
    volumes = d.listVolumes();
  } catch {
    return { dockerDown: "no answer for the volume list" };
  }
  if (containers === undefined) return { dockerDown: "no answer for the container list" };
  const parts = projectParts(project, containers, volumes);
  const refusals: string[] = [];

  const verifies = volumesKeptReason(d.verifies());
  if (verifies !== undefined) refusals.push(`${verifies}; wait for it to finish (volume removal during a verify hung Docker twice)`);

  const claims: EnvClaim[] = envClaims(d.worktrees(), { cwd: d.cwd, readEnv: d.readEnv, platform: d.platform }).filter((c) => c.project === project);
  for (const c of claims) refusals.push(`another worktree's .env uses ${project}: ${c.path}${c.branch ? ` (${c.branch})` : ""}`);

  // The folders that could hold a session: the project's container folders and the claiming worktrees.
  // This worktree's own folder is left out: its session is the one asking.
  const holders = d.holders();
  const own = (dir: string) => dir.replace(/[\\/]+$/, "").toLowerCase() === d.cwd.replace(/[\\/]+$/, "").toLowerCase();
  const folders = [...new Set([...containers.filter((c) => c.project === project).map((c) => c.workingDir), ...claims.map((c) => c.path)])].filter((dir) => dir !== "" && !own(dir) && d.exists(dir));
  for (const dir of folders) {
    const reason = holdReason(dir, holders);
    if (reason !== undefined) refusals.push(`${project} is held by a Claude session in ${dir}: ${reason}`);
  }
  return { parts, refusals };
}

/** Runs lane:reset; returns the exit code. */
export async function resetLane(args: string[], d: ResetDeps): Promise<number> {
  const parsed = parseLaneResetArgs(args);
  if ("error" in parsed) {
    d.error(parsed.error);
    return 2;
  }
  const { lane } = parsed;
  const project = laneProject(lane);
  const harness = protectedLaneReason(project);
  if (harness !== undefined) {
    d.error(`lane:reset refused: ${harness}.`);
    return 1;
  }
  const refuse = (refusals: string[]): number => {
    d.error(`lane:reset refused for ${project}:`);
    for (const r of refusals) d.error(`  ${r}`);
    d.error("Nothing was removed.");
    return 1;
  };
  const dockerRefusal = (why: string): number => {
    d.error(`lane:reset refused: Docker is not answering (${why}, ${DOCKER_TIMEOUT_MS / 1000} s): it is stopped or jammed. Tell your Main; do not restart it yourself. Nothing was removed.`);
    return 1;
  };

  const first = look(lane, d);
  if ("dockerDown" in first) return dockerRefusal(first.dockerDown);
  if (first.refusals.length > 0) return refuse(first.refusals);
  const { parts } = first;
  if (parts.containers.length === 0 && parts.volumes.length === 0) {
    d.log(`${project} has no containers and no volumes: nothing to remove.`);
    return 0;
  }

  d.log(`${project} will lose:`);
  d.log(`  containers: ${parts.containers.join(", ") || "none"}`);
  d.log(`  volumes: ${parts.volumes.join(", ") || "none"}`);
  if (!(await d.confirm(`Remove these containers and volumes of ${project}? Their data is gone for good.`))) {
    d.log("Nothing removed.");
    return 0;
  }

  // The second look, after the prompt: a verify or a session may have started while it waited.
  const second = look(lane, d);
  if ("dockerDown" in second) return dockerRefusal(second.dockerDown);
  if (second.refusals.length > 0) return refuse(second.refusals);

  try {
    const { volumesKept } = d.remove(second.parts, { volumesKeptBecause: () => volumesKeptReason(d.verifies()) });
    if (volumesKept !== undefined) {
      d.error(`${project}: containers removed, volumes kept because ${volumesKept}. Run lane:reset again when it is over.`);
      return 1;
    }
  } catch (error) {
    d.error(`Could not remove ${project}: ${(error as Error).message}`);
    return 1;
  }
  d.log(`Removed ${project}: containers ${second.parts.containers.join(", ") || "none"}; volumes ${second.parts.volumes.join(", ") || "none"}.`);
  d.log(`Start it fresh with: pnpm lane:env ${lane} --force`);
  return 0;
}

/** The real Docker, git and terminal. */
export const realDeps = (yes: boolean): ResetDeps => ({
  cwd: process.cwd(),
  listContainers: () => listContainers(DOCKER_TIMEOUT_MS),
  listVolumes: () => listVolumes(DOCKER_TIMEOUT_MS),
  worktrees: () => listWorktrees().filter((w) => existsSync(w.path)),
  readEnv: readWorktreeEnv,
  exists: existsSync,
  holders: () => systemHolders(),
  verifies: () => verifiesRunningNow(),
  remove: removeProject,
  confirm: async (question) => {
    await confirmOrExit(question, { yes, verb: "remove", done: "removed" });
    return true;
  },
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});

if (import.meta.main) {
  const args = process.argv.slice(2);
  process.exit(await resetLane(args, realDeps(args.includes("--yes"))));
}
