// The Docker volumes `pnpm test:stories:linux` keeps Linux node_modules in (RP-1120):
// rabaed-stories-<worktreeHash>-<folder>, one set of about 12 per worktree, named by
// test-stories-linux.ts's volumeName, so one rule names them. worktrees:prune and
// worktrees:clean remove the set of each worktree they remove, and worktrees:prune also
// the orphaned sets: those whose hash matches no worktree git lists with its folder present.
//
// A set whose worktree still exists, the main checkout's included, is never removed: its hash
// is checked against every spelling of every such worktree's path (git prints forward slashes,
// the stories script hashes the path as Node resolved it). A volume a container uses, running
// or stopped, is skipped and named, and `docker volume rm` is never forced: Docker refuses a
// volume in use, and that refusal is named too.
import { execFileSync } from "node:child_process";
import { STORIES_VOLUME_PREFIX, worktreeHash } from "./test-stories-linux.ts";

const HASH = new RegExp(`^${STORIES_VOLUME_PREFIX}([0-9a-f]{8})-.`);

/** A stories volume's worktree hash; undefined for any other volume (a lane's, lane 7's included). */
export const storiesHashOf = (volume: string): string | undefined => HASH.exec(volume)?.[1];

/**
 * The spellings a worktree's path may have had when the stories script hashed it: on Windows git's
 * forward slashes, Node's backslashes, either drive letter case, and all lowercase; elsewhere the
 * path as it is. Keeping a set is checked against all of them, so a respelling never removes a live set.
 */
export function pathSpellings(path: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [path.length > 1 ? path.replace(/\/+$/, "") : path];
  const back = path.replace(/\//g, "\\").replace(/(?<!^[a-z]:)\\+$/i, "");
  const forward = back.replace(/\\/g, "/");
  const drives = (p: string) => (/^[a-z]:/i.test(p) ? [p[0]!.toUpperCase() + p.slice(1), p[0]!.toLowerCase() + p.slice(1)] : [p]);
  return [...new Set([path, back, forward, back.toLowerCase(), forward.toLowerCase()].flatMap(drives))];
}

const hashesOf = (paths: string[], platform: NodeJS.Platform) => new Set(paths.flatMap((p) => pathSpellings(p, platform).map(worktreeHash)));

/** One worktree's stories volumes among `volumes`, for listing it before the prompt. */
export const storiesVolumesOf = (path: string, volumes: string[], platform: NodeJS.Platform = process.platform): string[] => {
  const hashes = hashesOf([path], platform);
  return volumes.filter((v) => hashes.has(storiesHashOf(v) ?? ""));
};

export interface StoriesFacts {
  /** The volumes Docker lists; any that are not stories volumes are ignored. */
  volumes: string[];
  /** The worktrees git lists whose folder exists now, the main checkout included. Their sets are kept. */
  existing: string[];
  /** The containers using each volume, as parseVolumeMounts reads them. */
  mountedBy: Map<string, string[]>;
  /** Every set whose hash matches no existing worktree (worktrees:prune). */
  orphans?: boolean;
  /** The paths of the worktrees just removed: their sets go (worktrees:clean, and worktrees:prune). */
  gone?: string[];
  /** Only these volumes may go: those listed before the prompt. */
  only?: Set<string>;
  platform?: NodeJS.Platform;
}

export type VolumeInUse = { volume: string; containers: string[] };

/** The stories volumes to remove, and those skipped because a container uses them. */
export function chooseStoriesVolumes({ volumes, existing, mountedBy, orphans = false, gone = [], only, platform = process.platform }: StoriesFacts): { remove: string[]; inUse: VolumeInUse[] } {
  const kept = hashesOf(existing, platform);
  const goneHashes = hashesOf(gone, platform);
  const remove: string[] = [];
  const inUse: VolumeInUse[] = [];
  for (const volume of volumes) {
    const hash = storiesHashOf(volume);
    if (hash === undefined || kept.has(hash) || (only && !only.has(volume))) continue;
    if (!orphans && !goneHashes.has(hash)) continue;
    const containers = mountedBy.get(volume) ?? [];
    if (containers.length > 0) inUse.push({ volume, containers });
    else remove.push(volume);
  }
  return { remove, inUse };
}

/** Volumes grouped by worktree hash, in first-seen order: one set per worktree. */
export function storiesSets(volumes: string[]): { hash: string; volumes: string[] }[] {
  const sets = new Map<string, string[]>();
  for (const volume of volumes) {
    const hash = storiesHashOf(volume);
    if (hash !== undefined) sets.set(hash, [...(sets.get(hash) ?? []), volume]);
  }
  return [...sets].map(([hash, list]) => ({ hash, volumes: list }));
}

/** "36 volumes in 3 sets". */
export const describeCount = (volumes: string[]): string => {
  const sets = storiesSets(volumes).length;
  return `${volumes.length} volume${volumes.length === 1 ? "" : "s"} in ${sets} set${sets === 1 ? "" : "s"}`;
};

/** A skipped volume, for the kept list: what and why. */
export const inUseLine = (v: VolumeInUse) => ({ what: `stories volume ${v.volume}`, reason: `used by ${v.containers.join(", ")}` });

const PS_FORMAT = "{{.Names}}\t{{.State}}\t{{.Mounts}}";

/** Parses `docker ps -a --no-trunc --format PS_FORMAT`: each volume's containers, as "name (state)". */
export function parseVolumeMounts(out: string): Map<string, string[]> {
  const mountedBy = new Map<string, string[]>();
  for (const line of out.split(/\r?\n/)) {
    const [name = "", state = "", mounts = ""] = line.split("\t");
    if (name.trim() === "") continue;
    for (const mount of mounts.split(",").map((m) => m.trim())) {
      if (mount !== "") mountedBy.set(mount, [...(mountedBy.get(mount) ?? []), `${name} (${state})`]);
    }
  }
  return mountedBy;
}

export type VolumeRemoval = { removed: string[]; refused: { volume: string; reason: string }[] };

/** Splits `docker volume rm` output: the names it printed went; the rest stay, with Docker's reason. */
export function parseRemoval(asked: string[], stdout: string, stderr: string): VolumeRemoval {
  const printed = new Set(stdout.split(/\r?\n/).map((l) => l.trim()));
  const errors = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const removed = asked.filter((v) => printed.has(v));
  const refused = asked
    .filter((v) => !printed.has(v))
    .map((volume) => {
      const named = errors.map((l) => new RegExp(`remove ${volume}: (.+)$`).exec(l)?.[1]).find((r) => r !== undefined);
      return { volume, reason: named ?? errors[0] ?? "not removed" };
    });
  return { removed, refused };
}

/** A stuck Docker must not hang a clean-up: a listing waits this long at most, a removal of one set twice that. */
const LIST_TIMEOUT_MS = 15_000;
const docker = (args: string[], timeout = LIST_TIMEOUT_MS) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });

/** "Docker did not answer" for the kept list: where the stories volumes stay and what removes them later. */
export const DOCKER_SILENT = "Docker did not answer: stories volumes not removed (run `pnpm worktrees:prune` later).";

/** The stories volumes among the names of every volume Docker lists. */
export const storiesVolumesIn = (names: string[]): string[] => names.filter((v) => storiesHashOf(v) !== undefined);

/** The stories volumes Docker lists, or undefined when Docker does not answer. */
export function listStoriesVolumes(): string[] | undefined {
  try {
    return docker(["volume", "ls", "-q", "--filter", `name=${STORIES_VOLUME_PREFIX}`])
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((v) => storiesHashOf(v) !== undefined);
  } catch {
    return undefined;
  }
}

/** Each volume's containers, stopped ones too, or undefined when Docker does not answer. */
export function listVolumeMounts(): Map<string, string[]> | undefined {
  try {
    return parseVolumeMounts(docker(["ps", "-a", "--no-trunc", "--format", PS_FORMAT]));
  } catch {
    return undefined;
  }
}

/** The Docker calls removeStoriesVolumesNow makes; injected so tests run on fake output. */
export interface StoriesDocker {
  list(): string[] | undefined;
  mountedBy(): Map<string, string[]> | undefined;
  remove(volumes: string[]): VolumeRemoval;
}

const realDocker: StoriesDocker = { list: listStoriesVolumes, mountedBy: listVolumeMounts, remove: removeStoriesVolumes };

/**
 * Removes the stories volumes in scope, judged on what Docker lists now and `existing` (the worktrees
 * git lists now whose folder exists), after the worktrees themselves went. `kept` lines name a volume a
 * container uses, by the listing or by Docker's own refusal; `errors` are Docker's other refusals.
 */
export function removeStoriesVolumesNow(
  scope: Pick<StoriesFacts, "orphans" | "gone" | "only">,
  existing: string[],
  docker: StoriesDocker = realDocker,
  platform: NodeJS.Platform = process.platform,
): { removed: string[]; kept: string[]; errors: string[] } {
  const volumes = docker.list();
  const mountedBy = volumes && docker.mountedBy();
  if (!volumes || !mountedBy) return { removed: [], kept: [DOCKER_SILENT], errors: [] };
  const { remove, inUse } = chooseStoriesVolumes({ ...scope, volumes, existing, mountedBy, platform });
  const kept = inUse.map((v) => `Kept stories volume ${v.volume}: used by ${v.containers.join(", ")}.`);
  if (remove.length === 0) return { removed: [], kept, errors: [] };
  const { removed, refused } = docker.remove(remove);
  const errors: string[] = [];
  for (const r of refused) {
    if (/in use/i.test(r.reason)) kept.push(`Kept stories volume ${r.volume}: ${r.reason}.`);
    else errors.push(`Could not remove stories volume ${r.volume}: ${r.reason}`);
  }
  return { removed, kept, errors };
}

/** Removes the volumes, one `docker volume rm` per set (never -f), and says which went and which Docker refused. */
export function removeStoriesVolumes(volumes: string[]): VolumeRemoval {
  const result: VolumeRemoval = { removed: [], refused: [] };
  for (const set of storiesSets(volumes)) {
    let removal: VolumeRemoval;
    try {
      removal = parseRemoval(set.volumes, docker(["volume", "rm", ...set.volumes], 2 * LIST_TIMEOUT_MS), "");
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      removal = parseRemoval(set.volumes, e.stdout ?? "", e.stderr || e.message || "");
    }
    result.removed.push(...removal.removed);
    result.refused.push(...removal.refused);
  }
  return result;
}
