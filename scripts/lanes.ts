import { execFileSync } from "node:child_process";
import { connect, createServer } from "node:net";

// Lanes: each worktree's own ports and Docker Compose project (README "Several
// worktrees at once", planning/parallel-sessions.md). Used by lane-env.ts, which
// refuses a lane whose ports are taken, and lanes-prune.ts, which removes the
// rabaed-* compose projects old worktrees left behind (RP-297).

/** Lanes 1..9 are for worktrees; lane 0 (the defaults) is the main folder's. */
export const HIGHEST_LANE = 9;

export type LanePorts = { postgres: number; api: number; admin: number; web: number; mailpit: number; files: number };

const portNames: Record<keyof LanePorts, string> = {
  postgres: "Postgres",
  api: "api",
  admin: "Rabaed Admin",
  web: "web",
  mailpit: "Mailpit",
  files: "file store",
};

/** Lane n's ports: the defaults plus 100n. */
export function lanePorts(n: number): LanePorts {
  return { postgres: 5432 + 100 * n, api: 4000 + 100 * n, admin: 4050 + 100 * n, web: 3000 + 100 * n, mailpit: 8025 + 100 * n, files: 9000 + 100 * n };
}

export const laneProject = (n: number) => `rabaed-lane${n}`;

export type Container = { name: string; state: string; project: string; workingDir: string; ports: number[] };
export type Volume = { name: string; project: string };

const psFormat = '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Ports}}';
const volumeFormat = '{{.Name}}\t{{.Label "com.docker.compose.project"}}';

/** Parses `docker ps -a --format psFormat`. Ports are the host side, e.g. 5632 from "127.0.0.1:5632->5432/tcp". */
export function parseContainers(out: string): Container[] {
  return lines(out).map((line) => {
    const [name = "", state = "", project = "", workingDir = "", ports = ""] = line.split("\t");
    const host = new Set<number>();
    for (const [, from, to] of ports.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
      for (let p = Number(from); p <= Number(to ?? from); p++) host.add(p);
    }
    return { name, state, project, workingDir, ports: [...host] };
  });
}

/** Parses `docker volume ls --format volumeFormat`. */
export function parseVolumes(out: string): Volume[] {
  return lines(out).map((line) => {
    const [name = "", project = ""] = line.split("\t");
    return { name, project };
  });
}

const lines = (out: string) => out.split(/\r?\n/).filter((line) => line.trim() !== "");

/** Whether two paths name the same folder (Docker reports Windows paths as it was given them). */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => {
    const slashed = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
  };
  return a !== "" && b !== "" && norm(a) === norm(b);
}

type ClashInput = {
  containers: Container[];
  takenPorts: ReadonlySet<number>;
  cwd: string;
  platform?: NodeJS.Platform;
  /** --db: the lane's containers may run from another worktree; this one only adds a database on its Postgres. */
  sharedLane?: boolean;
};

/**
 * Why lane n cannot be used from the worktree at cwd: a lane port taken by
 * something other than this worktree's own containers, or its compose project
 * already used from another worktree (it would share that worktree's database).
 */
export function laneClashes(n: number, { containers, takenPorts, cwd, platform, sharedLane }: ClashInput): string[] {
  const own = (c: Container) => samePath(c.workingDir, cwd, platform) || (sharedLane === true && c.project === laneProject(n));
  const clashes: string[] = [];
  for (const [key, port] of Object.entries(lanePorts(n)) as [keyof LanePorts, number][]) {
    if (!takenPorts.has(port)) continue;
    const holders = containers.filter((c) => c.state === "running" && c.ports.includes(port));
    if (holders.some(own)) continue;
    const holder = holders[0];
    clashes.push(
      holder
        ? `${portNames[key]} port ${port} is held by container ${holder.name}${holder.project ? ` (compose project ${holder.project}, from ${holder.workingDir})` : ""}.`
        : `${portNames[key]} port ${port} is held by another process (not a Docker container).`,
    );
  }
  if (sharedLane) return clashes; // --db: the lane's project may belong to another worktree
  const others = [...new Set(containers.filter((c) => c.project === laneProject(n) && !own(c)).map((c) => c.workingDir))];
  if (others.length > 0) {
    clashes.push(`Compose project ${laneProject(n)} already belongs to ${others.join(", ")} (it would share that worktree's database).`);
  }
  return clashes;
}

const MAX_SUFFIX = 40;

/** Why `--db <suffix>` is not usable, or undefined. The name becomes rabaed_<suffix> and rabaed_<suffix>_test. */
export function databaseSuffixError(suffix: string): string | undefined {
  if (!/^[a-z][a-z0-9_]*$/.test(suffix) || suffix.length > MAX_SUFFIX || suffix.endsWith("_test")) {
    return `--db takes a lower-case name of letters, digits and underscores, starting with a letter, at most ${MAX_SUFFIX} characters, not ending in _test (got "${suffix}").`;
  }
  return undefined;
}

/** The .env text with the migrator, app and admin URLs on rabaed_<suffix>. The tests derive rabaed_<suffix>_test from the app URL. */
export function withDatabase(env: string, suffix: string): string {
  let out = env;
  for (const role of ["MIGRATOR", "APP", "ADMIN"]) {
    const key = `DATABASE_${role}_URL`;
    const url = new RegExp(`^(${key}=.*)/rabaed(?=\r?$)`, "m");
    if (!url.test(out)) throw new Error(`${key} in .env.example does not end in /rabaed, so --db cannot point it at rabaed_${suffix}.`);
    out = out.replace(url, `$1/rabaed_${suffix}`);
  }
  return out;
}

/** The first lane from start (wrapping round, never lane 0, which is the main folder's) with no clash. */
export function firstFreeLane(start: number, clashesOf: (n: number) => string[]): number | undefined {
  for (let i = 0; i < HIGHEST_LANE; i++) {
    const n = ((Math.max(start, 1) - 1 + i) % HIGHEST_LANE) + 1;
    if (clashesOf(n).length === 0) return n;
  }
  return undefined;
}

export type StaleProject = { project: string; reason: string; containers: string[]; volumes: string[] };

type StaleInput = {
  containers: Container[];
  volumes: Volume[];
  cwd: string;
  /** COMPOSE_PROJECT_NAME from this worktree's .env, if any. */
  currentProject: string | undefined;
  exists: (dir: string) => boolean;
  platform?: NodeJS.Platform;
};

/**
 * The rabaed-* compose projects to prune: those whose worktrees are all gone,
 * that are not running, or that only have volumes left. Never the current
 * worktree's project.
 */
export function staleProjects({ containers, volumes, cwd, currentProject, exists, platform }: StaleInput): StaleProject[] {
  const projects = [...new Set([...containers, ...volumes].map((x) => x.project).filter((p) => p.startsWith("rabaed-")))].sort();
  const stale: StaleProject[] = [];
  for (const project of projects) {
    const mine = containers.filter((c) => c.project === project);
    if (project === currentProject || mine.some((c) => samePath(c.workingDir, cwd, platform))) continue;
    const dirs = [...new Set(mine.map((c) => c.workingDir))];
    const reason =
      mine.length === 0
        ? "no containers, only volumes"
        : dirs.every((dir) => !exists(dir))
          ? `worktree gone (${dirs.join(", ")})`
          : mine.every((c) => c.state !== "running")
            ? "not running"
            : undefined;
    if (!reason) continue;
    stale.push({ project, reason, containers: mine.map((c) => c.name), volumes: volumes.filter((v) => v.project === project).map((v) => v.name) });
  }
  return stale;
}

/** Whether something holds the port on 127.0.0.1: it cannot be bound there, or something answers on it. */
export async function isPortTaken(port: number): Promise<boolean> {
  const bindable = await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  if (!bindable) return true;
  // A listener on another address (e.g. "::" on Windows) can still leave 127.0.0.1 bindable.
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

/** Every lane port (lanes 0..9) that is taken right now. */
export async function takenLanePorts(): Promise<Set<number>> {
  const ports = Array.from({ length: HIGHEST_LANE + 1 }, (_, n) => Object.values(lanePorts(n))).flat();
  const taken = await Promise.all(ports.map(isPortTaken));
  return new Set(ports.filter((_, i) => taken[i]));
}

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** All containers, or undefined when Docker is not installed or not running. */
export function listContainers(): Container[] | undefined {
  try {
    return parseContainers(docker(["ps", "-a", "--format", psFormat]));
  } catch {
    return undefined;
  }
}

export function listVolumes(): Volume[] {
  return parseVolumes(docker(["volume", "ls", "--format", volumeFormat]));
}

/** Removes a project's containers, volumes and networks (what `docker compose down -v` would, without its compose file). */
export function removeProject(stale: StaleProject): void {
  if (stale.containers.length > 0) docker(["rm", "-f", "-v", ...stale.containers]);
  if (stale.volumes.length > 0) docker(["volume", "rm", ...stale.volumes]);
  const networks = lines(docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${stale.project}`]));
  if (networks.length > 0) docker(["network", "rm", ...networks]);
}
