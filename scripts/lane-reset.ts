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
//   - Docker does not answer (probeDocker first, with its own message: a hang says wait, down says start it);
//   - any verify runs anywhere on the machine (verifies-running.ts), or that cannot be checked;
//   - a running or open Claude session works in a folder that holds the project (its containers'
//     folders or another worktree whose .env names it); this worktree's own session is the owner's;
//   - another worktree's .env names the project (envClaims), or the .env of any live Claude session's
//     folder does (~/.claude/sessions), which protects a second clone's lane.
// What it cannot see: a stopped clone, one with no live Claude session and no container, whose .env names
// the project. The header it prints before the prompt says so.
// Otherwise it asks [y/N] (--yes skips it), looks again, refuses if the containers or volumes are not the
// ones it showed, and removes that project only (removeProject, each docker call with a timeout):
// a project matches by its exact compose name, so rabaed-lane3 never matches rabaed-lane31.
// Exit codes: 0 done or nothing to remove, 1 refused or failed, 2 bad arguments.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { holdReason, systemHolders, systemSessionCheck, type Holders } from "./claude-sessions.ts";
import { confirmOrExit } from "./confirm.ts";
import { DOCKER_PROBE_TIMEOUT_MS, DOCKER_NOT_ANSWERING, probeDocker, type DockerProbe } from "./docker-probe.ts";
import {
  envClaims,
  isValidLane,
  LANE_SCHEME,
  composeProjectOfEnv,
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
import { samePath } from "./paths.ts";
import { listWorktrees } from "./worktrees.ts";

/** How long each docker call of the removal may take (a corrupt volume can be slow, a jammed Docker never answers). */
export const REMOVE_TIMEOUT_MS = 60_000;

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
  /** Whether Docker answers (docker-probe.ts); asked first. */
  probe: () => DockerProbe;
  /** The folders of the live Claude sessions, or undefined when they cannot be listed. */
  sessionCwds: () => string[] | undefined;
  /** One docker call of the removal, killed after timeoutMs (throws on failure or timeout). */
  docker: (args: string[], timeoutMs: number) => string;
  /** Containers, or undefined when Docker did not answer. */
  listContainers: () => Container[] | undefined;
  /** Volumes; throws when Docker did not answer. */
  listVolumes: () => Volume[];
  worktrees: () => { path: string; branch: string | undefined }[];
  readEnv: (dir: string) => string | undefined;
  exists: (dir: string) => boolean;
  holders: () => Holders;
  verifies: () => VerifyCheck;
  /** `{ refused }` is RP-1198's refusal inside removeProject (lane 7, the main checkout's stacks). */
  remove: (stale: StaleProject, options: RemoveProjectOptions) => { volumesKept: string | undefined } | { refused: string | undefined };
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
    return { dockerDown: "volumes" };
  }
  if (containers === undefined) return { dockerDown: "containers" };
  const parts = projectParts(project, containers, volumes);
  const refusals: string[] = [];

  const verifies = volumesKeptReason(d.verifies());
  if (verifies !== undefined) refusals.push(`${verifies}; wait for it to finish (volume removal during a verify hung Docker twice)`);

  const claims: EnvClaim[] = envClaims(d.worktrees(), { cwd: d.cwd, readEnv: d.readEnv, platform: d.platform }).filter((c) => c.project === project);
  for (const c of claims) refusals.push(`another worktree's .env uses ${project}: ${c.path}${c.branch ? ` (${c.branch})` : ""}`);

  // The folders that could hold a session: the project's container folders and the claiming worktrees.
  // This worktree's own folder is left out: its session is the one asking.
  const holders = d.holders();
  const own = (dir: string) => samePath(dir, d.cwd, d.platform);
  const folders = [...new Set([...containers.filter((c) => c.project === project).map((c) => c.workingDir), ...claims.map((c) => c.path)])].filter((dir) => dir !== "" && !own(dir) && d.exists(dir));
  for (const dir of folders) {
    const reason = holdReason(dir, holders);
    if (reason !== undefined) refusals.push(`${project} is held by a Claude session in ${dir}: ${reason}`);
  }

  // Every live Claude session's folder, in this clone or another: a second clone's lane is named in its
  // own .env, which envClaims (this clone's worktrees only) cannot see.
  const cwds = d.sessionCwds();
  if (cwds === undefined) refusals.push("running Claude sessions could not be checked, so a second clone's .env cannot be read");
  else {
    const seen = d.worktrees().map((w) => w.path);
    for (const dir of new Set(cwds)) {
      if (samePath(dir, d.cwd, d.platform) || seen.some((p) => samePath(p, dir, d.platform))) continue;
      if (composeProjectOfEnv(d.readEnv(dir) ?? "") === project) refusals.push(`a live Claude session in ${dir} has a .env naming ${project}`);
    }
  }
  return { parts, refusals };
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

const isTimeout = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string; cause?: unknown } | undefined;
  return e?.code === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(e?.message ?? "") || (e?.cause !== undefined && isTimeout(e.cause));
};

/**
 * Lane 0 is the main checkout's stack: run from the main folder, its own folder is left out of the
 * claim checks, so nothing else would stop it. RP-1198 (#610) adds keptStackReason; swap to it then.
 */
export function mainCheckoutReason(project: string): string | undefined {
  return project === laneProject(0) ? `${project} is the main checkout's stack; lane:reset never removes it` : undefined;
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
  const harness = protectedLaneReason(project) ?? mainCheckoutReason(project);
  if (harness !== undefined) {
    d.error(`lane:reset refused: ${harness}. Nothing was removed.`);
    return 1;
  }
  const refuse = (refusals: string[]): number => {
    d.error(`lane:reset refused for ${project}:`);
    for (const r of refusals) d.error(`  ${r}`);
    d.error("Nothing was removed.");
    return 1;
  };
  const dockerRefusal = (message: string): number => {
    d.error(`lane:reset refused: ${message}. Nothing was removed.`);
    return 1;
  };

  const probe = d.probe();
  if (!probe.ok) return dockerRefusal(probe.message);
  const first = look(lane, d);
  if ("dockerDown" in first) return dockerRefusal(DOCKER_NOT_ANSWERING);
  if (first.refusals.length > 0) return refuse(first.refusals);
  const { parts } = first;
  if (parts.containers.length === 0 && parts.volumes.length === 0) {
    d.log(`${project} has no containers and no volumes: nothing to remove.`);
    return 0;
  }

  d.log(`${project} will lose:`);
  d.log(`  containers: ${parts.containers.join(", ") || "none"}`);
  d.log(`  volumes: ${parts.volumes.join(", ") || "none"}`);
  d.log("Not looked at: lane:reset cannot see a stopped clone with no live Claude session whose .env is for this project; look in other clones by hand.");
  if (!(await d.confirm(`Remove these containers and volumes of ${project}? Their data is gone for good.`))) {
    d.log("Nothing removed.");
    return 0;
  }

  // The second look, after the prompt: a verify or a session may have started while it waited.
  const second = look(lane, d);
  if ("dockerDown" in second) return dockerRefusal(DOCKER_NOT_ANSWERING);
  if (second.refusals.length > 0) return refuse(second.refusals);
  if (!sameList(parts.containers, second.parts.containers) || !sameList(parts.volumes, second.parts.volumes)) {
    d.error(`lane:reset refused: ${project}'s containers or volumes changed since it was shown; run it again. Nothing was removed.`);
    return 1;
  }

  // Each docker call runs with a timeout; what it finished is remembered, to say what was and was not removed.
  const doneContainers: string[] = [];
  let doneVolumes: string[] = [];
  const run = (args: string[]): string => {
    const output = d.docker(args, REMOVE_TIMEOUT_MS);
    if (args[0] === "rm") doneContainers.push(args[args.length - 1]!);
    else if (args[0] === "volume" && args[1] === "rm") doneVolumes = args.slice(2);
    return output;
  };
  try {
    const result = d.remove(second.parts, { volumesKeptBecause: () => volumesKeptReason(d.verifies()), run });
    if ("refused" in result && result.refused !== undefined) {
      d.error(`lane:reset refused: ${result.refused}. Nothing was removed.`);
      return 1;
    }
    const volumesKept = "volumesKept" in result ? result.volumesKept : undefined;
    if (volumesKept !== undefined) {
      d.error(`${project}: containers removed, volumes kept because ${volumesKept}. Run lane:reset again when it is over.`);
      return 1;
    }
  } catch (error) {
    const left = [
      second.parts.containers.filter((c) => !doneContainers.includes(c)).length > 0 ? `containers ${second.parts.containers.filter((c) => !doneContainers.includes(c)).join(", ")}` : undefined,
      second.parts.volumes.filter((v) => !doneVolumes.includes(v)).length > 0 ? `volumes ${second.parts.volumes.filter((v) => !doneVolumes.includes(v)).join(", ")}` : undefined,
    ].filter((x) => x !== undefined);
    const gone = [doneContainers.length > 0 ? `containers ${doneContainers.join(", ")}` : undefined, doneVolumes.length > 0 ? `volumes ${doneVolumes.join(", ")}` : undefined].filter((x) => x !== undefined);
    const why = isTimeout(error) ? `Docker timed out during the removal (${REMOVE_TIMEOUT_MS / 1000} s per call): wait, don't restart it` : `Could not remove ${project}: ${(error as Error).message}`;
    d.error(`${why}. Removed: ${gone.join("; ") || "nothing"}. Not removed: ${left.join("; ") || "nothing"}. Run lane:reset again once Docker answers.`);
    return 1;
  }
  d.log(`Removed ${project}: containers ${second.parts.containers.join(", ") || "none"}; volumes ${second.parts.volumes.join(", ") || "none"}.`);
  d.log(`Start it fresh with: pnpm lane:env ${lane} --force`);
  return 0;
}

/** The real Docker, git and terminal. */
export const realDeps = (yes: boolean): ResetDeps => ({
  cwd: process.cwd(),
  probe: () => probeDocker(),
  sessionCwds: () => {
    const check = systemSessionCheck();
    return check.kind === "ok" ? check.sessions.map((s) => s.cwd) : undefined;
  },
  docker: (args, timeout) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }),
  // A healthy probe means Docker answers within its timeout; the listings wait no longer.
  listContainers: () => listContainers(DOCKER_PROBE_TIMEOUT_MS),
  listVolumes: () => listVolumes(DOCKER_PROBE_TIMEOUT_MS),
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
