import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { holdReason, type Holders } from "./claude-sessions.ts";
import { samePath } from "./paths.ts";
import { lockPid } from "./worktrees-stale.ts";

// Lanes: each worktree's own ports and Docker Compose project (README "Several
// worktrees at once", planning/parallel-sessions.md). Used by lane-env.ts, which
// refuses a lane whose ports are taken, and lanes-prune.ts, which removes the
// rabaed-* compose projects old worktrees left behind (RP-297).

// A lane number is two digits mL (RP-602): m the Main session (1–5), L = 0 for the Main
// itself, 1–4 for its lanes A–D. Lane 0 (the defaults) is the main folder's. The single-digit
// lanes 1–9 are legacy: they keep working until no worktree uses them (lane m and lane m0
// have the same ports, so Mains 1–5 keep theirs).

/** The lanes 1–9 of the old scheme, still accepted while worktrees on them drain. */
const LEGACY_LANES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Whether n is a lane number: 0, a legacy 1–9, or mL with m 1–5 and L 0–4. */
export const isValidLane = (n: number): boolean =>
  Number.isInteger(n) && (n >= 0 && n <= 9 ? true : n >= 10 && n <= 54 && n % 10 <= 4);

/** Every valid lane, ascending. */
export const VALID_LANES: readonly number[] = Array.from({ length: 55 }, (_, n) => n).filter(isValidLane);

/** What lane:env and lanes:prune say when a lane number is not one. */
export const LANE_SCHEME = "lanes are 0 (the main folder), mL with m = Main 1–5 and L = 0 for the Main, 1–4 for lanes A–D (e.g. 32 = Main 3, lane B), or a legacy 1–9";

/** The lane with the same ports under the other scheme: legacy m and m0, for m 1–5. */
export function twinLane(n: number): number | undefined {
  if (n >= 1 && n <= 5) return 10 * n;
  if (n >= 10 && n <= 50 && n % 10 === 0) return n / 10;
  return undefined;
}

export type LanePorts = { postgres: number; api: number; admin: number; web: number; mailpit: number; files: number };

const portNames: Record<keyof LanePorts, string> = {
  postgres: "Postgres",
  api: "api",
  admin: "Rabaed Admin",
  web: "web",
  mailpit: "Mailpit",
  files: "file store",
};

/** Lane n's ports: the defaults plus 10n (plus 100n for the legacy lanes 0–9, so lane m0 = lane m). */
export function lanePorts(n: number): LanePorts {
  const step = n < 10 ? 100 * n : 10 * n;
  return { postgres: 5432 + step, api: 4000 + step, admin: 4050 + step, web: 3000 + step, mailpit: 8025 + step, files: 9000 + step };
}

export const laneProject = (n: number) => `rabaed-lane${n}`;

/**
 * The lanes nothing frees, takes over or removes (RP-1101): lane 7 holds Main 7's Round 0 harness
 * data (live UAT moved to Vercel, ADR 0026). lane:env --free never offers it, --force never takes
 * it over, and no prune removes it or its worktree.
 */
const PROTECTED: Record<string, string> = {
  "rabaed-lane7": "lane 7 holds Main 7's UAT harness data; nothing frees, takes over or prunes it (ask Main 7)",
};

/** Why nothing frees, takes over or removes this compose project, or undefined. */
export const protectedLaneReason = (project: string | undefined): string | undefined => (project === undefined ? undefined : PROTECTED[project]);

/** The compose projects that can hold lane n's ports: its own, and its twin's (legacy m and m0, RP-605). */
export function laneProjects(n: number): string[] {
  const twin = twinLane(n);
  return twin === undefined ? [laneProject(n)] : [laneProject(n), laneProject(twin)];
}

/** The lane whose compose project is `project` (`rabaed-lane32` → 32), or undefined. */
export const laneOfProject = (project: string): number | undefined => {
  const m = /^rabaed-lane(\d+)$/.exec(project);
  return m ? Number(m[1]) : undefined;
};

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

/** A worktree whose .env names a rabaed-* compose project (RP-1007): it holds that lane, even with its containers stopped or gone. */
export type EnvClaim = { path: string; branch: string | undefined; project: string };

/** A folder's .env text, or undefined when it has none (or the folder is gone). */
export function readWorktreeEnv(dir: string): string | undefined {
  const file = join(dir, ".env");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** The worktrees other than cwd whose .env names a rabaed-* compose project, read through readEnv (RP-1007). */
export function envClaims(
  worktrees: { path: string; branch: string | undefined }[],
  { cwd, readEnv, platform }: { cwd: string; readEnv: (dir: string) => string | undefined; platform?: NodeJS.Platform },
): EnvClaim[] {
  return worktrees.flatMap((w) => (samePath(w.path, cwd, platform) ? [] : claimOf(w, composeProjectOfEnv(readEnv(w.path) ?? ""))));
}

/** The worktree's claim when its .env's project is a rabaed-* one: none, or one. */
export const claimOf = (w: { path: string; branch: string | undefined }, project: string | undefined): EnvClaim[] =>
  project?.startsWith("rabaed-") ? [{ path: w.path, branch: w.branch, project }] : [];

type ClashInput = {
  containers: Container[];
  takenPorts: ReadonlySet<number>;
  cwd: string;
  platform?: NodeJS.Platform;
  /** The caller has its own database (lane:env --db), so other worktrees' containers of this lane's compose project are not a clash. */
  ownDatabase?: boolean;
  /** The other worktrees' .env claims (envClaims, RP-1007): one naming the lane's project, or its twin's, holds the lane. */
  claims?: EnvClaim[];
};

/**
 * Why lane n cannot be used from the worktree at cwd: a lane port taken by
 * something other than this worktree's own containers, its compose project
 * already used from another worktree (it would share that worktree's database),
 * or named in another worktree's .env (RP-1007: its stack may only be stopped).
 */
export function laneClashes(n: number, { containers, takenPorts, cwd, platform, ownDatabase, claims = [] }: ClashInput): string[] {
  // A --db run shares the lane's stack, under either project of its ports (RP-605).
  const own = (c: Container) => samePath(c.workingDir, cwd, platform) || (ownDatabase === true && laneProjects(n).includes(c.project));
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
  // Legacy lane m and lane m0 have the same ports: the other's containers, even stopped, would clash on start.
  const twin = twinLane(n);
  const twins = twin === undefined ? [] : [...new Set(containers.filter((c) => c.project === laneProject(twin) && !own(c)).map((c) => c.workingDir))];
  if (twin !== undefined && twins.length > 0) {
    clashes.push(`Compose project ${laneProject(twin)} (lane ${twin} has the same ports as lane ${n}) belongs to ${twins.join(", ")}.`);
  }
  // A --db run shares its own session's lane, so a claim on it is not a clash (as with its containers).
  if (ownDatabase !== true) {
    const named = [...others, ...twins];
    for (const claim of claims) {
      if (!laneProjects(n).includes(claim.project) || samePath(claim.path, cwd, platform)) continue;
      if (named.some((dir) => samePath(dir, claim.path, platform))) continue;
      clashes.push(`Compose project ${claim.project} is in the .env of ${claim.path} (on ${claim.branch ?? "a detached HEAD"}): that worktree holds the lane even with its containers stopped.`);
    }
  }
  return clashes;
}

/**
 * The order lane:env --free tries lanes in from start. From mL: the same Main's lanes m1–m4
 * from L (wrapping round), then the other Mains' lanes A–D; never a Main's own m0 or lane 0.
 * From a legacy lane (or 0): lanes 1–9 from it, wrapping round, then every Main's lanes A–D (RP-605).
 * Never a protected lane (lane 7, RP-1101).
 */
export function freeLaneOrder(start: number): number[] {
  const lanesAD = VALID_LANES.filter((n) => n >= 10 && n % 10 !== 0);
  const rotate = (lanes: number[], from: number) => [...lanes.slice(from), ...lanes.slice(0, from)];
  const unprotected = (lanes: number[]) => lanes.filter((n) => protectedLaneReason(laneProject(n)) === undefined);
  if (start < 10) return unprotected([...rotate(LEGACY_LANES, Math.max(start, 1) - 1), ...lanesAD]);
  const main = Math.floor(start / 10);
  const own = lanesAD.filter((n) => Math.floor(n / 10) === main);
  return unprotected([...rotate(own, Math.max(start % 10, 1) - 1), ...lanesAD.filter((n) => Math.floor(n / 10) !== main)]);
}

/**
 * The clashes lane:env --free sees for the lane asked for: a protected lane always clashes (RP-1101),
 * even with no container or .env claim on it (only Main 7's volumes left), so --free moves on.
 * A plain `lane:env 7` is Main 7's own and is not refused here.
 */
export function freeLaneClashes(n: number, clashes: string[]): string[] {
  const refusal = protectedLaneReason(laneProject(n));
  return refusal === undefined ? clashes : [...clashes, `${refusal}.`];
}

/** The first lane in freeLaneOrder(start) with no clash. */
export function firstFreeLane(start: number, clashesOf: (n: number) => string[]): number | undefined {
  return freeLaneOrder(start).find((n) => clashesOf(n).length === 0);
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

/** A key's value in an .env file's text; the value may be quoted. */
export const envValue = (env: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m").exec(env)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;

/** COMPOSE_PROJECT_NAME in an .env file's text; the value may be quoted. */
export const composeProjectOfEnv = (env: string): string | undefined => envValue(env, "COMPOSE_PROJECT_NAME");

/** The lane a .env's compose project names (`rabaed-lane5` → `5`); "" for any other. */
export const laneOf = (env: string): string => /^rabaed-lane(\w+)$/.exec(composeProjectOfEnv(env) ?? "")?.[1] ?? "";

/** A worktree of this clone, as lanes:prune --merged sees it. */
export type WorktreeLane = {
  path: string;
  branch: string | undefined;
  /** It is finished against origin/main: its branch, or its detached HEAD (RP-601), by worktrees.ts isFinished (merged, or never committed to and nothing holds it). */
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
  /** The running and desktop Claude sessions (claude-sessions.ts systemHolders; RP-956, RP-612). */
  holders: Holders;
  platform?: NodeJS.Platform;
};

/** A project chooseMerged would have pruned as merged, kept because a session holds the worktree at path. */
export type KeptProject = { project: string; path: string; reason: string };

/** Every one of the paths a session holds, with why (claude-sessions.ts holdReason); RP-1170: all of them, not the first. */
const allHeld = (paths: string[], holders: Holders): { path: string; reason: string }[] =>
  paths.flatMap((path) => {
    const reason = holdReason(path, holders);
    return reason === undefined ? [] : [{ path, reason }];
  });

/**
 * The rabaed-* compose projects (lanes:prune --merged) whose containers all come from
 * worktrees whose branch is merged into origin/main. A project stays while any worktree
 * that is not merged names it in its .env (it shares the lane, e.g. lane:env --db), and the
 * current worktree's project always stays. Projects whose worktree is gone are staleProjects'.
 * A project that would go, but one of whose worktrees a running Claude session is in (RP-956)
 * or whose Claude desktop session is open (RP-612), or when they cannot be checked, is kept
 * instead, with every holder and why (RP-1170). mergedBlockers says what keeps the others.
 */
export function chooseMerged({ containers, volumes, worktrees, cwd, currentProject, holders, platform }: MergedInput): {
  merged: StaleProject[];
  kept: KeptProject[];
} {
  const projects = [...new Set(containers.map((c) => c.project).filter((p) => p.startsWith("rabaed-")))].sort();
  const merged: StaleProject[] = [];
  const kept: KeptProject[] = [];
  for (const project of projects) {
    const mine = containers.filter((c) => c.project === project);
    if (project === currentProject || mine.some((c) => samePath(c.workingDir, cwd, platform))) continue;
    if (worktrees.some((w) => !w.merged && w.project === project)) continue;
    const dirs = [...new Set(mine.map((c) => c.workingDir))];
    // Each container's folder must be a merged worktree of this clone.
    const owners = dirs.flatMap((dir) => worktrees.filter((w) => w.merged && samePath(w.path, dir, platform)).slice(0, 1));
    if (owners.length < dirs.length) continue;
    // RP-1007: the merged worktrees whose .env names the project hold it too, while a session holds them.
    const claimants = worktrees.filter((w) => w.merged && w.project === project && !owners.includes(w));
    const held = allHeld(
      [...owners, ...claimants].map((w) => w.path),
      holders,
    );
    if (held.length > 0) {
      kept.push(...held.map((h) => ({ project, ...h })));
      continue;
    }
    const named = owners.map((w) => `${w.branch ?? "a detached HEAD"} at ${w.path}`).join(", ");
    merged.push({
      project,
      reason: `branch merged into origin/main (${named})`,
      containers: mine.map((c) => c.name),
      volumes: volumes.filter((v) => v.project === project).map((v) => v.name),
    });
  }
  return { merged, kept };
}

/**
 * What keeps chooseMerged from picking a project (RP-1170: lanes:prune --merged --lane 42 refused eight
 * times, naming one subagent worktree each time): every worktree that is not merged and names it in
 * its .env, and every folder a container of it comes from that is no merged worktree of this clone.
 * Empty when nothing of these keeps it (a session may still: chooseMerged's kept).
 */
export function mergedBlockers(project: string, { containers, worktrees, platform }: { containers: Container[]; worktrees: WorktreeLane[]; platform?: NodeJS.Platform }): KeptProject[] {
  const blockers: KeptProject[] = worktrees
    .filter((w) => !w.merged && w.project === project)
    .map((w) => ({ project, path: w.path, reason: `not merged into origin/main (on ${w.branch ?? "a detached HEAD"}), and its .env has ${project}` }));
  const seen = new Set<string>();
  for (const c of containers.filter((x) => x.project === project)) {
    if (seen.has(c.workingDir) || worktrees.some((w) => samePath(w.path, c.workingDir, platform))) continue;
    seen.add(c.workingDir);
    blockers.push({ project, path: c.workingDir, reason: `${c.name} comes from it, and it is no merged worktree of this clone` });
  }
  return blockers;
}

/**
 * lanes:prune's stale candidates split by the other worktrees' .env claims (RP-1007): a project
 * a worktree that still exists names in its .env stays, though it is not running or has only
 * volumes left, as that worktree's lane database; kept names every such worktree (RP-1170).
 */
export function keptByClaims(candidates: StaleProject[], claims: EnvClaim[]): { prune: StaleProject[]; kept: KeptProject[] } {
  const prune: StaleProject[] = [];
  const kept: KeptProject[] = [];
  for (const candidate of candidates) {
    const mine = claims.filter((c) => c.project === candidate.project);
    if (mine.length === 0) prune.push(candidate);
    for (const claim of mine) kept.push({ project: candidate.project, path: claim.path, reason: `its .env names ${claim.project} (on ${claim.branch ?? "a detached HEAD"}), so the lane is still in use` });
  }
  return { prune, kept };
}

/** lanes:prune --lane N refuses (exits 1) when a claim kept lane N's project and --merged did not pick it after all (RP-1007). */
export const laneKeptByClaim = (lane: number | undefined, claimed: KeptProject[], merged: StaleProject[]): boolean =>
  lane !== undefined && claimed.some((k) => k.project === laneProject(lane)) && !merged.some((m) => m.project === laneProject(lane));

/**
 * A worktree whose .env names project now but did not when the list was made (lanes:prune reads
 * the .env files again just before each removal, RP-1007: lane:env may have run since the prompt).
 */
export const newClaimant = (project: string, listed: EnvClaim[], now: EnvClaim[], platform?: NodeJS.Platform): EnvClaim | undefined =>
  now.find((c) => c.project === project && !listed.some((l) => l.project === project && samePath(l.path, c.path, platform)));

/** What a compose project's last check reads, just before removing it (projectInUseNow). */
export type ProjectNow = {
  /** Every other existing worktree's .env claim, read again (envClaims). */
  claims: EnvClaim[];
  /** The containers, listed again; undefined when Docker did not answer. */
  containers: Container[] | undefined;
  /** The connections to the project's running db container's Postgres (postgresConnections); undefined when it has none running. */
  postgres: { container: string; connections: PostgresConnections } | undefined;
};

/** How many connections a Postgres has to the lane databases, or why it could not be asked. */
export type PostgresConnections = { count: number } | { unanswered: string };

type InUseInput = {
  /** The .env claims as listed before the prompt. */
  listedClaims: EnvClaim[];
  /** The containers as listed before the prompt. */
  listedContainers: Container[];
  now: ProjectNow;
  /** Whether a folder exists now (the removed worktrees' folders do not count). */
  exists: (dir: string) => boolean;
  platform?: NodeJS.Platform;
};

/**
 * Why a compose project chosen for removal stays after all, judged just before removing it
 * (RP-1073): the prune can take minutes between reading the .env files and removing a stack,
 * and a session may run lane:env or start the lane meanwhile. In order: a worktree's .env
 * names it now; Docker did not answer; one of its containers runs now from a folder that
 * exists, and that container did not run from there at listing; something is connected to
 * its Postgres, or Postgres could not be asked. Undefined when it still goes.
 */
export function projectInUseNow(project: string, { listedClaims, listedContainers, now, exists, platform }: InUseInput): string | undefined {
  const claimant = newClaimant(project, listedClaims, now.claims, platform);
  if (claimant !== undefined) return `the .env of ${claimant.path} (on ${claimant.branch ?? "a detached HEAD"}) holds it now`;
  if (now.containers === undefined) return "Docker did not answer when it was checked again";
  const ranBefore = (c: Container) => listedContainers.some((l) => l.name === c.name && l.state === "running" && samePath(l.workingDir, c.workingDir, platform));
  const started = now.containers.find((c) => c.project === project && c.state === "running" && exists(c.workingDir) && !ranBefore(c));
  if (started !== undefined) return `a container of it runs from ${started.workingDir} now (${started.name})`;
  if (now.postgres === undefined) return undefined;
  const { container, connections } = now.postgres;
  // A db that never answers would keep its stack on every run: a stopped one is judged without asking it.
  if ("unanswered" in connections) return `its Postgres (${container}) could not be asked who is connected (${connections.unanswered}); \`docker stop ${container}\` and re-run if the lane is unused`;
  const n = connections.count;
  return n > 0 ? `${n} connection${n === 1 ? "" : "s"} to its Postgres (${container}) now; stop what uses it (\`pnpm servers:stop --yes\` in its worktree) and re-run` : undefined;
}

/** lanes:prune --lane N: only lane N's compose project among the candidates (all of them without --lane). */
export const onlyLane = (projects: StaleProject[], lane: number | undefined): StaleProject[] =>
  lane === undefined ? projects : projects.filter((p) => p.project === laneProject(lane));

/** The lanes:prune command that frees lane n alone (RP-505), with --merged when the holder's branch is merged. */
export const pruneCommand = (lane: number, { merged }: { merged: boolean }): string => `pnpm lanes:prune${merged ? " --merged" : ""} --lane ${lane}`;

/**
 * The worktrees (other than cwd) holding lane n, as laneClashes counts them: its compose
 * project's containers, or a running container on one of its ports. With ownDatabase
 * (lane:env --db), the lane's own compose project is shared, not held.
 */
export function laneHolders(n: number, { containers, cwd, platform, ownDatabase }: Omit<ClashInput, "takenPorts">): string[] {
  const ports = new Set(Object.values(lanePorts(n)));
  const projects = laneProjects(n);
  const holding = containers.filter((c) =>
    projects.includes(c.project) ? ownDatabase !== true : c.state === "running" && c.ports.some((p) => ports.has(p)),
  );
  return [...new Set(holding.map((c) => c.workingDir).filter((dir) => dir !== "" && !samePath(dir, cwd, platform)))];
}

type AdviceInput = {
  /** The worktrees of this clone: at least the holders and those whose .env names lane n's project. merged is only read when hasOriginMain. */
  worktrees: WorktreeLane[];
  /** origin/main is fetched, so merged can be trusted. */
  hasOriginMain: boolean;
  cwd: string;
  /** The containers laneHolders looked at: a holder with only the twin lane's project is freed by pruning that lane. */
  containers: Container[];
  platform?: NodeJS.Platform;
};

/**
 * lane:env's line for each worktree holding lane n (laneHolders): whether its branch is merged
 * into origin/main, and how to free the lane. A merged holder's lane is freed by
 * `lanes:prune --merged --lane n`, unless a worktree that is not merged names the lane's
 * project in its .env: chooseMerged keeps the project then, so prune would free nothing.
 * The line then names that worktree and does not suggest prune. A holder whose containers are
 * all the twin lane's (legacy m for m0, or m0 for m) is freed by pruning the twin (RP-605).
 */
export function holderAdvice(n: number, holders: string[], { worktrees, hasOriginMain, cwd, containers, platform }: AdviceInput): string[] {
  const twin = twinLane(n);
  return holders.map((dir) => {
    const held = new Set(containers.filter((c) => samePath(c.workingDir, dir, platform)).map((c) => laneOfProject(c.project)));
    const lane = twin !== undefined && held.has(twin) && !held.has(n) ? twin : n;
    const claimants = worktrees.filter((w) => !w.merged && w.project === laneProject(lane));
    const w = worktrees.find((x) => samePath(x.path, dir, platform));
    if (!w) return `  ${dir} is not a worktree of this clone (or is gone): \`${pruneCommand(lane, { merged: false })}\` frees the lane.`;
    const on = w.branch ?? "a detached HEAD";
    if (!hasOriginMain) return `  ${dir} is on ${on}; run \`git fetch origin main\` to see whether it is merged.`;
    if (!w.merged) return `  ${dir} is on ${on}, not merged into origin/main yet: its session may still need the lane.`;
    if (claimants.length === 0) return `  ${dir} is on ${on}, already merged into origin/main: free the lane with \`${pruneCommand(lane, { merged: true })}\`, then re-run.`;
    const kept = `  ${dir} is on ${on}, already merged into origin/main, but lanes:prune keeps ${laneProject(lane)}`;
    if (claimants.some((c) => samePath(c.path, cwd, platform))) return `${kept}: this worktree's own .env has it. \`pnpm lane:env ${n} --force\` takes the lane over.`;
    const sharers = claimants.map((c) => `${c.path} (on ${c.branch ?? "a detached HEAD"}, not merged)`).join(", ");
    return `${kept} while ${sharers} has it in its .env: that worktree still shares the lane. Take a free lane instead.`;
  });
}

/** A worktree of this clone, as lane:env --force sees a holder of the lane (RP-500). */
export type TakeoverWorktree = {
  path: string;
  branch: string | undefined;
  /** It is finished against origin/main: its branch, or its detached HEAD (RP-601), by worktrees.ts isFinished. */
  merged: boolean;
  /** Finished although its branch has had no commit of its own (RP-585); the takeover line says why it counts. */
  neverCommitted?: boolean;
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
  /** Whether the pid is another session that still runs (lane:env: worktrees.ts systemLiveness().pidLive, RP-585; default: none is). */
  pidRunning?: (pid: number) => boolean;
  /** The running and desktop Claude sessions (claude-sessions.ts systemHolders; RP-956, RP-612): a holder one holds is never taken over. */
  holders: Holders;
  platform?: NodeJS.Platform;
};

/**
 * What lane:env --force may take over for lane n: the containers of its compose project
 * that belong to worktrees which are gone, or merged into origin/main and clean. The
 * volumes stay: once these containers are removed the new worktree's `docker compose up`
 * recreates them under its own folder in the same project and reuses the database.
 * All or nothing: a holder that is not merged, has uncommitted changes (or whose status
 * cannot be read), is locked by a process that still runs, has a running Claude session in it (RP-956), has an
 * open Claude desktop session (or one that cannot be checked, RP-612), or is a folder git does not
 * list refuses the whole takeover (refused names each, with why). So does a worktree that
 * is not merged (other than cwd) naming the lane's project in its .env: it shares the lane.
 * The twin lane's project (legacy m for m0, or m0 for m) counts as the lane's, as it holds the
 * same ports; its volumes stay too, but lane n's project starts with a database of its own (RP-605).
 * A worktree that only names the lane in its .env, with no container of it (RP-1007), is judged
 * like a holder: once it is merged, clean and held by no session its claim is released (nothing
 * is removed, and its .env is left as it is).
 * A protected lane (lane 7, RP-1101) is never taken over: refused names why.
 */
export function chooseTakeover(
  n: number,
  { containers, worktrees, cwd, exists = () => false, pidRunning = () => false, holders, platform }: TakeoverInput,
): { takeOver: Container[]; from: string[]; refused: string[]; released: string[] } {
  const projects = laneProjects(n);
  const refusal = projects.map(protectedLaneReason).find((reason) => reason !== undefined);
  if (refusal !== undefined) return { takeOver: [], from: [], refused: [`lane:env --force refused: ${refusal}.`], released: [] };
  const mine = containers.filter((c) => projects.includes(c.project) && !samePath(c.workingDir, cwd, platform));
  const from: string[] = [];
  const refused: string[] = [];
  const released: string[] = [];
  const claimants = worktrees.filter((w) => w.exists && w.project !== undefined && projects.includes(w.project) && !samePath(w.path, cwd, platform));
  for (const dir of new Set(mine.map((c) => c.workingDir))) {
    const w = worktrees.find((x) => samePath(x.path, dir, platform));
    const on = w?.branch ?? "a detached HEAD";
    if (!w) {
      if (exists(dir)) refused.push(`${dir} is not a worktree of this clone.`);
      else from.push(`${dir} (gone)`);
    } else if (!w.exists) from.push(`${dir} (gone)`);
    else {
      const why = holderRefusal(w, { pidRunning, holders });
      if (why !== undefined) refused.push(why);
      else if (w.neverCommitted) from.push(`${dir} (${on}, never committed to: its tip is in origin/main, it is clean and unlocked, and no process holds it)`);
      else from.push(`${dir} (${on}, merged into origin/main)`);
    }
  }
  for (const w of claimants) {
    const on = w.branch ?? "a detached HEAD";
    const holdsContainers = mine.some((c) => samePath(c.workingDir, w.path, platform));
    if (!w.merged) {
      refused.push(`${w.path} is on ${on}, not merged into origin/main yet, and has ${w.project} in its .env.`);
      continue;
    }
    if (holdsContainers) {
      released.push(w.path);
      continue;
    }
    const why = holderRefusal(w, { pidRunning, holders });
    if (why !== undefined) refused.push(why);
    else {
      released.push(w.path);
      from.push(`${w.path} (${on}, merged into origin/main; ${w.project} is in its .env)`);
    }
  }
  return refused.length > 0 ? { takeOver: [], from: [], refused, released: [] } : { takeOver: mine, from, refused, released };
}

/** Why lane:env --force may not take a lane from this existing worktree (chooseTakeover's checks, in order), or undefined. */
function holderRefusal(w: TakeoverWorktree, { pidRunning, holders }: { pidRunning: (pid: number) => boolean; holders: Holders }): string | undefined {
  const on = w.branch ?? "a detached HEAD";
  const pid = lockPid(w.locked);
  const held = holdReason(w.path, holders);
  if (pid !== undefined && pidRunning(pid)) return `${w.path} is locked by a session that is still running (pid ${pid}).`;
  if (held !== undefined) return `${w.path} is on ${on} and ${held}.`;
  if (w.statusError !== undefined) return `${w.path} is on ${on}; its uncommitted changes could not be checked (${w.statusError}).`;
  if (w.dirty) return `${w.path} is on ${on} and has uncommitted changes.`;
  if (!w.merged) return `${w.path} is on ${on}, not merged into origin/main yet.`;
  return undefined;
}

/** Whether a worktree has a container of lane n's compose project (or its twin's); its folder is then checked before a takeover. */
export const holdsLaneProject = (n: number, containers: Container[], dir: string, platform?: NodeJS.Platform): boolean =>
  containers.some((c) => laneProjects(n).includes(c.project) && samePath(c.workingDir, dir, platform));

/**
 * laneClashes for lane n once the containers `removed` are gone: their containers and the ports they held no longer count,
 * nor do the .env claims of the worktrees `released` (chooseTakeover's, RP-1007).
 */
export function clashesAfterRemoval(n: number, input: ClashInput, removed: Container[], released: string[] = []): string[] {
  const freed = new Set(removed.flatMap((c) => c.ports));
  return laneClashes(n, {
    ...input,
    containers: input.containers.filter((c) => !removed.includes(c)),
    takenPorts: new Set([...input.takenPorts].filter((p) => !freed.has(p))),
    claims: (input.claims ?? []).filter((claim) => !released.some((path) => samePath(path, claim.path, input.platform))),
  });
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
export function parsePruneArgs(args: string[]): { merged: boolean; yes: boolean; dryRun: boolean; lane?: number } | undefined {
  const options: { merged: boolean; yes: boolean; dryRun: boolean; lane?: number } = { merged: false, yes: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--merged") options.merged = true;
    else if (a === "--yes") options.yes = true;
    else if (a === "--dry-run") options.dryRun = true;
    else if (a === "--lane") {
      const lane = Number(args[++i]);
      if (!isValidLane(lane)) return undefined;
      options.lane = lane;
    } else return undefined;
  }
  return options;
}

/** lanes:drop-dbs's options, or undefined for an unknown argument. --lane N limits it to lane N's Postgres, as lanes:prune --lane N does (RP-535). */
export function parseDropDbsArgs(args: string[]): { yes: boolean; lane?: number } | undefined {
  const options: { yes: boolean; lane?: number } = { yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--yes") options.yes = true;
    else if (a === "--lane") {
      const lane = Number(args[++i]);
      if (!isValidLane(lane)) return undefined;
      options.lane = lane;
    } else return undefined;
  }
  return options;
}

export type LaneEnvArgs = { lane: number; force: boolean; free: boolean; db: string | undefined };

const LANE_ENV_USAGE = "Usage: pnpm lane:env <n> [--force] [--free] [--db <suffix>]   (one lane per worktree; suffix: lowercase letters and digits, e.g. rp322)";

/** lane:env's arguments, or the refusal to print. --free alone starts at lane 11 (Main 1, lane A), never a legacy lane. */
export function parseLaneEnvArgs(args: string[]): LaneEnvArgs | { error: string } {
  const force = args.includes("--force");
  const free = args.includes("--free");
  const dbAt = args.indexOf("--db");
  const db = dbAt === -1 ? undefined : args[dbAt + 1];
  const positional = args.filter((a, i) => !a.startsWith("--") && !(dbAt !== -1 && i === dbAt + 1));
  const lane = positional.length === 0 && free ? 11 : Number(positional[0]);
  if (positional.length > 1 || args.some((a) => a.startsWith("--") && !["--force", "--free", "--db"].includes(a)) || (dbAt !== -1 && !isValidDbSuffix(db))) {
    return { error: LANE_ENV_USAGE };
  }
  if (!isValidLane(lane)) return { error: `${positional[0] ?? ""} is not a lane: ${LANE_SCHEME}.\n${LANE_ENV_USAGE}` };
  return { lane, force, free, db };
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

/** Every port of a valid lane that is taken right now. */
export async function takenLanePorts(): Promise<Set<number>> {
  const ports = [...new Set(VALID_LANES.flatMap((n) => Object.values(lanePorts(n))))];
  const taken = await Promise.all(ports.map(isPortTaken));
  return new Set(ports.filter((_, i) => taken[i]));
}

const docker = (args: string[], timeout?: number) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });

/** All containers, or undefined when Docker is not installed or not running (or, with timeout ms, did not answer in time). */
export function listContainers(timeout?: number): Container[] | undefined {
  try {
    return parseContainers(docker(["ps", "-a", "--format", psFormat], timeout));
  } catch {
    return undefined;
  }
}

/** All volumes; with timeout ms, throws when Docker does not answer in time (RP-1096). */
export function listVolumes(timeout?: number): Volume[] {
  return parseVolumes(docker(["volume", "ls", "--format", volumeFormat], timeout));
}

/**
 * Connections to the lane databases (rabaed*; the app, its tests and the dev servers use only those),
 * not counting the asking one. One to the `postgres` database, such as a psql by hand, is not counted.
 */
const CONNECTIONS_SQL = "select count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() and datname like 'rabaed%'";

/** A stuck container or daemon must not hang the prune: each Docker call of the last check waits this long at most. */
const RECHECK_TIMEOUT_MS = 30_000;

/** How many connections the db container's Postgres has now (CONNECTIONS_SQL), or why it could not be asked. */
export function postgresConnections(container: string, run: (container: string, sql: string) => string[] = (c, sql) => psql(c, sql, RECHECK_TIMEOUT_MS)): PostgresConnections {
  try {
    const out = run(container, CONNECTIONS_SQL).join("\n").trim();
    return /^\d+$/.test(out) ? { count: Number(out) } : { unanswered: `psql answered "${out}"` };
  } catch (error) {
    return { unanswered: (error as { stderr?: string }).stderr?.trim() || (error as Error).message };
  }
}

/**
 * What projectInUseNow judges a project on, read now (RP-1073): the .env claims of the worktrees
 * other than cwd whose folder exists, the containers, and its running db container's connections.
 */
export function readProjectNow(project: string, { worktrees, cwd }: { worktrees: { path: string; branch: string | undefined }[]; cwd: string }): ProjectNow {
  const claims = envClaims(
    worktrees.filter((w) => existsSync(w.path)),
    { cwd, readEnv: readWorktreeEnv },
  );
  const containers = listContainers(RECHECK_TIMEOUT_MS);
  const db = containers && dbContainers(containers).find((c) => c.project === project);
  return { claims, containers, postgres: db && { container: db.name, connections: postgresConnections(db.name) } };
}

const pause = new Int32Array(new SharedArrayBuffer(4));
/** Blocks this thread for ms milliseconds (the clean-up scripts run Docker and git synchronously). */
export const sleepSync = (ms: number): void => void Atomics.wait(pause, 0, 0, ms);

/** How removeProject runs Docker; injected in tests. */
export type RemoveProjectOptions = {
  /** Remove the containers and the network only. */
  keepVolumes?: boolean;
  /**
   * Why no volume may go now (RP-1170, rule 4: a verify runs anywhere on the machine; verifies-running.ts
   * volumesKeptReason(verifiesRunningNow())), read just before; undefined lets them go. Required, so no caller
   * skips the check; it is passed in because this file, which CI runs, imports only CI's own scripts (ci-green.ts).
   */
  volumesKeptBecause: () => string | undefined;
  run?: (args: string[]) => string;
  wait?: (ms: number) => void;
};

/** RP-1170: twice on 2026-10-30 a `docker rm -f` failed with this, and went through when run again. */
const NO_EXIT_EVENT = /did not receive an exit event/i;
const KILL_TRIES = 3;
const KILL_PAUSE_MS = 5000;

/**
 * Removes a project's containers, volumes and networks (what `docker compose down -v` would, without
 * its compose file). The containers go one at a time (RP-1170): one whose kill got no exit event is
 * tried again, three times in all with a pause between; one already gone counts as removed; any other
 * failure stops it, naming which containers went. keepVolumes, or a verify running anywhere on the
 * machine (volumesKeptBecause, asked just before; bulk volume removal during verifies hung Docker
 * twice), leaves every volume, anonymous ones too; volumesKept then says why.
 */
export function removeProject(
  stale: StaleProject,
  { keepVolumes = false, volumesKeptBecause, run = docker, wait = sleepSync }: RemoveProjectOptions,
): { volumesKept: string | undefined } {
  // Every caller already keeps lane 7 (RP-1101); refused here too, so no future one can reach it.
  const harness = protectedLaneReason(stale.project);
  if (harness !== undefined) throw new Error(`${stale.project} not removed: ${harness}.`);
  const kept = keepVolumes ? "asked to keep them" : volumesKeptBecause();
  keepVolumes = kept !== undefined;
  const removed: string[] = [];
  for (const [i, name] of stale.containers.entries()) {
    for (let attempt = 1; ; attempt++) {
      try {
        run(["rm", "-f", ...(keepVolumes ? [] : ["-v"]), name]);
        break;
      } catch (error) {
        const reason = (error as { stderr?: string }).stderr?.trim() || String(error);
        if (/no such container/i.test(reason)) break;
        if (NO_EXIT_EVENT.test(reason) && attempt < KILL_TRIES) {
          wait(KILL_PAUSE_MS);
          continue;
        }
        const tries = NO_EXIT_EVENT.test(reason) ? ` after ${KILL_TRIES} tries` : "";
        throw new Error(`Could not remove container ${name}${tries} (${reason}). Removed: ${removed.join(", ") || "none"}. Not removed: ${stale.containers.slice(i).join(", ")}.`, { cause: error });
      }
    }
    removed.push(name);
  }
  if (!keepVolumes && stale.volumes.length > 0) run(["volume", "rm", ...stale.volumes]);
  const networks = lines(run(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${stale.project}`]));
  if (networks.length > 0) run(["network", "rm", ...networks]);
  return { volumesKept: kept };
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

const SUFFIXED_DB = /^rabaed_([a-z][a-z0-9]*)(_test(_reset)?)?$/;

/**
 * The per-worktree databases (rabaed_<suffix>, rabaed_<suffix>_test and the reset test's
 * rabaed_<suffix>_test_reset, RP-949, as lane:env --db makes them) that no existing worktree
 * names in its .env. Never rabaed, rabaed_test or any other name. inUse: the database names from the .env files of the worktrees that still exist.
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

/** The `db` service containers of the running rabaed-* compose projects; with lane, only that lane's project (lanes:drop-dbs --lane N, RP-535). */
export const dbContainers = (containers: Container[], lane?: number): Container[] =>
  containers.filter((c) => c.state === "running" && c.project.startsWith("rabaed") && /-db-\d+$/.test(c.name) && (lane === undefined || c.project === laneProject(lane)));

/** Runs SQL as the superuser inside a db container and returns one value per line; with timeout, waits that many ms at most. */
export function psql(container: string, sql: string, timeout?: number): string[] {
  return lines(docker(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql], timeout));
}
