import { execFileSync } from "node:child_process";
import { connect, createServer } from "node:net";
import { samePath } from "./paths.ts";
import { lockPid } from "./worktrees-stale.ts";

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

type ClashInput = {
  containers: Container[];
  takenPorts: ReadonlySet<number>;
  cwd: string;
  platform?: NodeJS.Platform;
  /** The caller has its own database (lane:env --db), so other worktrees' containers of this lane's compose project are not a clash. */
  ownDatabase?: boolean;
};

/**
 * Why lane n cannot be used from the worktree at cwd: a lane port taken by
 * something other than this worktree's own containers, or its compose project
 * already used from another worktree (it would share that worktree's database).
 */
export function laneClashes(n: number, { containers, takenPorts, cwd, platform, ownDatabase }: ClashInput): string[] {
  const own = (c: Container) => samePath(c.workingDir, cwd, platform) || (ownDatabase === true && c.project === laneProject(n));
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
  const others = [...new Set(containers.filter((c) => c.project === laneProject(n) && !own(c)).map((c) => c.workingDir))];
  if (others.length > 0) {
    clashes.push(`Compose project ${laneProject(n)} already belongs to ${others.join(", ")} (it would share that worktree's database).`);
  }
  return clashes;
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

/** COMPOSE_PROJECT_NAME in an .env file's text; the value may be quoted. */
export const composeProjectOfEnv = (env: string): string | undefined =>
  /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(env)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;

/** A worktree of this clone, as lanes:prune --merged sees it. */
export type WorktreeLane = {
  path: string;
  branch: string | undefined;
  /** Its branch is merged into origin/main (worktrees.ts branchMerged). */
  merged: boolean;
  /** COMPOSE_PROJECT_NAME from its .env, if any. */
  project: string | undefined;
};

type MergedInput = {
  containers: Container[];
  volumes: Volume[];
  worktrees: WorktreeLane[];
  cwd: string;
  currentProject: string | undefined;
  platform?: NodeJS.Platform;
};

/**
 * The rabaed-* compose projects (lanes:prune --merged) whose containers all come from
 * worktrees whose branch is merged into origin/main. A project stays while any worktree
 * that is not merged names it in its .env (it shares the lane, e.g. lane:env --db), and the
 * current worktree's project always stays. Projects whose worktree is gone are staleProjects'.
 */
export function mergedProjects({ containers, volumes, worktrees, cwd, currentProject, platform }: MergedInput): StaleProject[] {
  const worktreeAt = (dir: string) => worktrees.find((w) => samePath(w.path, dir, platform));
  const projects = [...new Set(containers.map((c) => c.project).filter((p) => p.startsWith("rabaed-")))].sort();
  const merged: StaleProject[] = [];
  for (const project of projects) {
    const mine = containers.filter((c) => c.project === project);
    if (project === currentProject || mine.some((c) => samePath(c.workingDir, cwd, platform))) continue;
    if (worktrees.some((w) => !w.merged && w.project === project)) continue;
    const holders = [...new Set(mine.map((c) => c.workingDir))].map(worktreeAt);
    if (holders.some((w) => !w?.merged)) continue;
    const named = holders.map((w) => `${w!.branch} at ${w!.path}`).join(", ");
    merged.push({
      project,
      reason: `branch merged into origin/main (${named})`,
      containers: mine.map((c) => c.name),
      volumes: volumes.filter((v) => v.project === project).map((v) => v.name),
    });
  }
  return merged;
}

/**
 * The worktrees (other than cwd) holding lane n, as laneClashes counts them: its compose
 * project's containers, or a running container on one of its ports. With ownDatabase
 * (lane:env --db), the lane's own compose project is shared, not held.
 */
export function laneHolders(n: number, { containers, cwd, platform, ownDatabase }: Omit<ClashInput, "takenPorts">): string[] {
  const ports = new Set(Object.values(lanePorts(n)));
  const holding = containers.filter((c) =>
    ownDatabase === true && c.project === laneProject(n) ? false : c.project === laneProject(n) || (c.state === "running" && c.ports.some((p) => ports.has(p))),
  );
  return [...new Set(holding.map((c) => c.workingDir).filter((dir) => dir !== "" && !samePath(dir, cwd, platform)))];
}

/** A worktree of this clone, as lane:env --force sees a holder of the lane (RP-500). */
export type TakeoverWorktree = {
  path: string;
  branch: string | undefined;
  /** Its branch is merged into origin/main (worktrees.ts branchMerged). */
  merged: boolean;
  /** Uncommitted changes, untracked files outside ignored paths included. */
  dirty: boolean;
  /** Why git status could not be read; the worktree then counts as having uncommitted changes. */
  statusError?: string;
  /** Its folder is still on disk. */
  exists: boolean;
  /** The lock reason (the app names the owning session's pid in it), or undefined when not locked. */
  locked?: string | undefined;
  /** COMPOSE_PROJECT_NAME from its .env, if any. */
  project?: string | undefined;
};

type TakeoverInput = {
  containers: Container[];
  worktrees: TakeoverWorktree[];
  cwd: string;
  /** Whether a folder exists; decides for a holder git does not list (default: none does, so it is gone). */
  exists?: (dir: string) => boolean;
  /** Whether a process with the pid runs (default: none does). */
  pidRunning?: (pid: number) => boolean;
  platform?: NodeJS.Platform;
};

/**
 * What lane:env --force may take over for lane n: the containers of its compose project
 * that belong to worktrees which are gone, or merged into origin/main and clean. The
 * volumes stay: once these containers are removed the new worktree's `docker compose up`
 * recreates them under its own folder in the same project and reuses the database.
 * All or nothing: a holder that is not merged, has uncommitted changes (or whose status
 * cannot be read), is locked by a process that still runs, or is a folder git does not
 * list refuses the whole takeover (refused names each, with why). So does a worktree that
 * is not merged (other than cwd) naming the lane's project in its .env: it shares the lane.
 */
export function chooseTakeover(
  n: number,
  { containers, worktrees, cwd, exists = () => false, pidRunning = () => false, platform }: TakeoverInput,
): { takeOver: Container[]; from: string[]; refused: string[] } {
  const mine = containers.filter((c) => c.project === laneProject(n) && !samePath(c.workingDir, cwd, platform));
  const from: string[] = [];
  const refused: string[] = [];
  for (const dir of new Set(mine.map((c) => c.workingDir))) {
    const w = worktrees.find((x) => samePath(x.path, dir, platform));
    const on = w?.branch ?? "a detached HEAD";
    const pid = lockPid(w?.locked);
    if (!w) {
      if (exists(dir)) refused.push(`${dir} is not a worktree of this clone.`);
      else from.push(`${dir} (gone)`);
    } else if (!w.exists) from.push(`${dir} (gone)`);
    else if (pid !== undefined && pidRunning(pid)) refused.push(`${dir} is locked by a session that is still running (pid ${pid}).`);
    else if (w.statusError !== undefined) refused.push(`${dir} is on ${on}; its uncommitted changes could not be checked (${w.statusError}).`);
    else if (w.dirty) refused.push(`${dir} is on ${on} and has uncommitted changes.`);
    else if (!w.merged) refused.push(`${dir} is on ${on}, not merged into origin/main yet.`);
    else from.push(`${dir} (${w.branch}, merged into origin/main)`);
  }
  if (mine.length > 0) {
    for (const w of worktrees) {
      if (!w.merged && w.project === laneProject(n) && !samePath(w.path, cwd, platform)) {
        refused.push(`${w.path} is on ${w.branch ?? "a detached HEAD"}, not merged into origin/main yet, and has ${laneProject(n)} in its .env.`);
      }
    }
  }
  return refused.length > 0 ? { takeOver: [], from: [], refused } : { takeOver: mine, from, refused };
}

/** Whether a worktree has a container of lane n's compose project; its folder is then checked before a takeover. */
export const holdsLaneProject = (n: number, containers: Container[], dir: string, platform?: NodeJS.Platform): boolean =>
  containers.some((c) => c.project === laneProject(n) && samePath(c.workingDir, dir, platform));

/** laneClashes for lane n once the containers `removed` are gone: their containers and the ports they held no longer count. */
export function clashesAfterRemoval(n: number, input: ClashInput, removed: Container[]): string[] {
  const freed = new Set(removed.flatMap((c) => c.ports));
  return laneClashes(n, { ...input, containers: input.containers.filter((c) => !removed.includes(c)), takenPorts: new Set([...input.takenPorts].filter((p) => !freed.has(p))) });
}

/**
 * Removes containers but not their volumes (docker rm -f, without -v), one at a time:
 * lane:env --force's takeover. When one fails it stops and throws, naming which
 * containers are removed and which are not.
 */
export function releaseContainers(containers: Container[], run: (args: string[]) => string = docker): void {
  const ids = containers.map((c) => c.name);
  for (const [i, id] of ids.entries()) {
    try {
      run(["rm", "-f", id]);
    } catch (error) {
      const reason = (error as { stderr?: string }).stderr?.trim() || String(error);
      throw new Error(`Could not remove container ${id} (${reason}). Removed: ${ids.slice(0, i).join(", ") || "none"}. Not removed: ${ids.slice(i).join(", ")}.`, { cause: error });
    }
  }
}

/** lanes:prune's options, or undefined for an unknown argument. --dry-run only lists. */
export function parsePruneArgs(args: string[]): { merged: boolean; yes: boolean; dryRun: boolean } | undefined {
  if (args.some((a) => !["--merged", "--yes", "--dry-run"].includes(a))) return undefined;
  return { merged: args.includes("--merged"), yes: args.includes("--yes"), dryRun: args.includes("--dry-run") };
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

/** A --db suffix: lowercase letters and digits, starting with a letter, and not "test" (rabaed_test is the shared test database). */
export const isValidDbSuffix = (suffix: string | undefined): suffix is string => suffix !== undefined && /^[a-z][a-z0-9]*$/.test(suffix) && suffix !== "test";

/**
 * The .env text for lane n from .env.example: its ports and compose project, and with
 * db the three database URLs naming rabaed_<db> (seam suites then use rabaed_<db>_test).
 */
export function laneEnv(example: string, lane: number, db?: string): string {
  const { postgres: pg, api, admin, web, mailpit, files } = lanePorts(lane);
  const env = example
    .replace(/^COMPOSE_PROJECT_NAME=.*$/m, `COMPOSE_PROJECT_NAME=${laneProject(lane)}`)
    .replace(/^POSTGRES_PORT=.*$/m, `POSTGRES_PORT=${pg}`)
    .replace(/^PORT=.*$/m, `PORT=${web}`)
    .replace(/^API_PORT=.*$/m, `API_PORT=${api}`)
    .replace(/^ADMIN_PORT=.*$/m, `ADMIN_PORT=${admin}`)
    .replace(/^WEB_URL=.*$/m, `WEB_URL=http://lane${lane}.localhost:${web}`)
    .replace(/^MAILPIT_PORT=.*$/m, `MAILPIT_PORT=${mailpit}`)
    .replace(/^FILE_STORE_PORT=.*$/m, `FILE_STORE_PORT=${files}`)
    .replace(/^FILE_STORE_ENDPOINT=http:\/\/127\.0\.0\.1:9000$/m, `FILE_STORE_ENDPOINT=http://127.0.0.1:${files}`)
    .replace(/^MAIL_CATCHER_URL=http:\/\/127\.0\.0\.1:8025$/m, `MAIL_CATCHER_URL=http://127.0.0.1:${mailpit}`)
    .replace(/@localhost:5432\//g, `@localhost:${pg}/`)
    .replace(/^API_URL=http:\/\/127\.0\.0\.1:4000$/m, `API_URL=http://127.0.0.1:${api}`);
  return db === undefined ? env : env.replace(/^(DATABASE_(?:MIGRATOR|APP|ADMIN)_URL=.*\/)rabaed$/gm, `$1rabaed_${db}`);
}

const SUFFIXED_DB = /^rabaed_([a-z][a-z0-9]*)(_test)?$/;

/**
 * The per-worktree databases (rabaed_<suffix> and rabaed_<suffix>_test, as lane:env --db
 * makes them) that no existing worktree names in its .env. Never rabaed, rabaed_test or any
 * other name. inUse: the database names from the .env files of the worktrees that still exist.
 */
export function orphanDatabases(names: string[], inUse: ReadonlySet<string>): string[] {
  return names
    .filter((name) => {
      const m = SUFFIXED_DB.exec(name);
      return m !== null && m[1] !== "test" && !inUse.has(`rabaed_${m[1]}`);
    })
    .sort();
}

/** The database name in a Postgres URL, e.g. rabaed_rp322 for postgres://u:p@localhost:5832/rabaed_rp322. */
export const databaseOfUrl = (url: string): string | undefined => /\/([^/?]+)(?:\?.*)?$/.exec(url)?.[1];

/** The databases an .env file's DATABASE_MIGRATOR_URL, DATABASE_APP_URL and DATABASE_ADMIN_URL name; a value may be quoted. */
export function databasesOfEnv(env: string): string[] {
  const names: string[] = [];
  for (const [, value = ""] of env.matchAll(/^DATABASE_(?:MIGRATOR|APP|ADMIN)_URL=(.*)$/gm)) {
    const name = databaseOfUrl(value.trim().replace(/^(["'])(.*)\1$/, "$2"));
    if (name) names.push(name);
  }
  return names;
}

/**
 * The databases some worktree still uses: those named in the .env of any of dirs
 * (the existing worktrees of this clone). readEnv returns a folder's .env text,
 * or undefined when it has none.
 */
export function databasesInUse(dirs: string[], readEnv: (dir: string) => string | undefined): Set<string> {
  return new Set(dirs.flatMap((dir) => databasesOfEnv(readEnv(dir) ?? "")));
}

/**
 * Splits orphan databases into those to drop and those to keep because something
 * is connected to them right now (pg_stat_activity), such as a worktree of another
 * clone or a test run. connections: the number of connections per database.
 */
export function dropOrKeep(orphans: string[], connections: ReadonlyMap<string, number>): { drop: string[]; busy: { name: string; connections: number }[] } {
  const drop: string[] = [];
  const busy: { name: string; connections: number }[] = [];
  for (const name of orphans) {
    const n = connections.get(name) ?? 0;
    if (n > 0) busy.push({ name, connections: n });
    else drop.push(name);
  }
  return { drop, busy };
}

/** Parses `datname|count` lines (psql -At) into connections per database. */
export function parseConnections(lines: string[]): Map<string, number> {
  return new Map(lines.map((line) => line.split("|")).map(([name = "", count = "0"]) => [name, Number(count)] as const));
}

/** The `db` service containers of the running rabaed-* compose projects. */
export const dbContainers = (containers: Container[]): Container[] => containers.filter((c) => c.state === "running" && c.project.startsWith("rabaed") && /-db-\d+$/.test(c.name));

/** Runs SQL as the superuser inside a db container and returns one value per line. */
export function psql(container: string, sql: string): string[] {
  return lines(docker(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql]));
}
