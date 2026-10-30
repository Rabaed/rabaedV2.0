import { laneProjects, protectedLaneReason, type Container, type Volume } from "./lanes.ts";

// Machine load (RP-1096). On 2026-10-29 the machine ran 68 containers, about 19 lane databases
// and 98% CPU: seam suites timed out after 3+ hours and rustfs died ("init retry budget exhausted").
// - `pnpm lane:env` warns near the cap of running stacks and refuses at it (stackCap);
// - `pnpm lanes:prune --stale` lists stopped stacks, dead containers and stray containers (staleReport),
//   and removes nothing.
// Lane 7 (Main 7's UAT harness data) counts as a running stack, and is never named as one to stop.

/** How many rabaed stacks may run at once on this machine, unless RABAED_MAX_STACKS says otherwise. The owner sets it. */
export const DEFAULT_MAX_STACKS = 8;
export const MAX_STACKS_ENV = "RABAED_MAX_STACKS";

/** The cap: RABAED_MAX_STACKS when set, else DEFAULT_MAX_STACKS. Throws on a value that is not a whole number from 1. */
export function maxStacks(env: Record<string, string | undefined>): number {
  const value = env[MAX_STACKS_ENV];
  if (value === undefined || value === "") return DEFAULT_MAX_STACKS;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${MAX_STACKS_ENV} "${value}" is not a whole number from 1; unset it for the default ${DEFAULT_MAX_STACKS}.`);
  return Number(value);
}

/** A rabaed compose project (`rabaed` for the main folder, `rabaed-laneN` for a lane). */
const isRabaedProject = (project: string) => project === "rabaed" || project.startsWith("rabaed-");

export type RunningStack = { project: string; dirs: string[] };

/** Each rabaed compose project with at least one running container, with the folders it was started from. */
export function runningStacks(containers: Container[]): RunningStack[] {
  const projects = [...new Set(containers.filter((c) => c.state === "running" && isRabaedProject(c.project)).map((c) => c.project))].sort();
  return projects.map((project) => ({ project, dirs: [...new Set(containers.filter((c) => c.project === project).map((c) => c.workingDir))] }));
}

const describeStack = ({ project, dirs }: RunningStack) =>
  `${project} (${dirs.join(", ") || "no folder"}${protectedLaneReason(project) === undefined ? "" : "; Main 7's, never stop it"})`;

export type CapVerdict = { level: "ok" } | { level: "warn" | "refuse"; message: string };

/**
 * Whether lane n's stack fits under the cap of `max` running stacks. The lane's own stack (and its
 * twin's, which shares its ports) is not another one: rewriting a lane's .env, or a --db run on it,
 * adds none. Warns when it would leave one slot or none, refuses when the cap is already reached.
 */
export function stackCap(n: number, containers: Container[], max: number): CapVerdict {
  const own = laneProjects(n);
  const others = runningStacks(containers).filter((s) => !own.includes(s.project));
  const list = others.map((s) => `  - ${describeStack(s)}`).join("\n");
  const help = [
    "`pnpm lanes:prune --stale` lists stopped stacks and stray containers. Ask your Main which finished lane can stop its stack",
    "(`docker compose stop` in that lane's worktree); never stop lane 7 (Main 7's harness data).",
  ].join(" ");
  if (others.length >= max) {
    return {
      level: "refuse",
      message: [`${others.length} stacks are running, the cap is ${max} (${MAX_STACKS_ENV}), so lane ${n} would be one too many:`, list, help].join("\n"),
    };
  }
  if (others.length >= max - 2) {
    const slots = max - others.length - 1;
    return {
      level: "warn",
      message: [`lane ${n} makes ${others.length + 1} of ${max} running stacks (${MAX_STACKS_ENV}); ${slots === 0 ? "no slot is" : "one slot is"} left after it. Running now:`, list, help].join("\n"),
    };
  }
  return { level: "ok" };
}

type StaleReportInput = { containers: Container[]; volumes: Volume[]; exists: (dir: string) => boolean; max: number };

const MAIN_7 = "; Main 7's, never stop or prune it";

/**
 * The read-only report of `pnpm lanes:prune --stale`: running stacks against the cap, stacks with no
 * container running, running stacks with a container that is not (a dead db or rustfs), projects
 * with only volumes left, and containers of no rabaed compose project (`docker run` leftovers).
 */
export function staleReport({ containers, volumes, exists, max }: StaleReportInput): string[] {
  const projects = [...new Set(containers.map((c) => c.project).filter(isRabaedProject))].sort();
  const stopped: string[] = [];
  const dead: string[] = [];
  for (const project of projects) {
    const mine = containers.filter((c) => c.project === project);
    const notRunning = mine.filter((c) => c.state !== "running");
    if (notRunning.length === 0) continue;
    // A container with no working_dir label names no folder, so it is not "gone".
    const dirs = [...new Set(mine.map((c) => c.workingDir))].map((dir) => (dir === "" ? "no folder" : exists(dir) ? dir : `${dir}, folder gone`)).join("; ");
    const line = `  - ${project} (${dirs}): ${notRunning.map((c) => `${c.name} ${c.state}`).join(", ")}${protectedLaneReason(project) === undefined ? "" : MAIN_7}`;
    (notRunning.length === mine.length ? stopped : dead).push(line);
  }
  const withContainers = new Set(projects);
  const volumeOnly = [...new Set(volumes.map((v) => v.project).filter((p) => isRabaedProject(p) && !withContainers.has(p)))]
    .sort()
    .map((p) => `  - ${p}: ${volumes.filter((v) => v.project === p).map((v) => v.name).join(", ")}${protectedLaneReason(p) === undefined ? "" : MAIN_7}`);
  const stray = containers.filter((c) => !isRabaedProject(c.project)).map((c) => `  - ${c.name} ${c.state}${c.project ? ` (compose project ${c.project})` : ""}`);
  const running = runningStacks(containers);
  const lines = [`Running stacks: ${running.length} of the cap ${max} (${MAX_STACKS_ENV}).`, ...running.map((s) => `  - ${describeStack(s)}`)];
  const section = (title: string, rows: string[]) => (rows.length === 0 ? [] : [title, ...rows]);
  const found = [
    ...section("Stopped stacks (no container running):", stopped),
    ...section("Running stacks with a container that is not running:", dead),
    ...section("Projects with only volumes left:", volumeOnly),
    ...section("Stray containers (no rabaed compose project):", stray),
  ];
  if (found.length === 0) lines.push("No stopped stacks, dead containers, volume-only projects or stray containers.");
  lines.push(...found);
  lines.push("Nothing was removed. `pnpm lanes:prune --dry-run` shows what lanes:prune would remove; ask the stack's Main before stopping or removing anything.");
  return lines;
}
