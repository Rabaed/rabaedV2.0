// The veraPDF containers the record tests start (RP-1122): veraPdfDockerSession
// (apps/worker/src/record/verapdf.ts) names each rabaed-verapdf-<worktree hash>-<pid>-<n> and
// labels it rabaed.verapdf=<worktree hash>. A test that is killed or times out never runs its
// afterAll, so its container stays until its bounded sleep ends (an hour). `pnpm lanes:prune`
// removes those whose test process (the pid in the name) no longer runs, after the same
// confirmation as its compose projects, and lists them with --dry-run.
//
// Kept, and named: a container whose process still runs, one whose name carries no pid, and
// any of a worktree that holds lane 7 (Main 7's harness).
//
// The pid is a host pid, checked on the machine running the prune. A session started from another
// pid namespace on the same Docker (WSL, a Linux container) would look gone; none is started so today.
//
// RP-1198: removeVeraPdfContainer refuses on its own, before any Docker call, a container of lane 7's worktree
// or of the main checkout (stories-volumes.ts guardedHashes), and any name that is not a veraPDF container's.
import { execFileSync } from "node:child_process";
import { isRefused, type Refused } from "./removal-guard.ts";
import { guardedHashes, readGuarded } from "./stories-volumes.ts";

export const VERAPDF_LABEL = "rabaed.verapdf";

export type VeraPdfContainer = { name: string; hash: string; pid: number | undefined; state: string; age: string };
export type KeptContainer = { what: string; reason: string };
/** A container whose test process is gone. */
export type GoneContainer = VeraPdfContainer & { pid: number };

const NAME = /^rabaed-verapdf-[0-9a-f]{8}-(\d+)-\d+$/;
const psFormat = `{{.Names}}\t{{.Label "${VERAPDF_LABEL}"}}\t{{.State}}\t{{.RunningFor}}`;

/** Parses `docker ps -a --filter label=rabaed.verapdf --format psFormat`. */
export function parseVeraPdfContainers(stdout: string): VeraPdfContainer[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [name = "", hash = "", state = "", age = ""] = line.split("\t");
      const pid = NAME.exec(name)?.[1];
      return { name, hash, pid: pid === undefined ? undefined : Number(pid), state, age };
    });
}

/** The containers to remove (their test process is gone), and those kept, with why. */
export function chooseVeraPdfContainers({
  containers,
  alive,
  protectedHashes,
}: {
  containers: VeraPdfContainer[];
  alive: (pid: number) => boolean;
  protectedHashes: Map<string, string>;
}): { remove: GoneContainer[]; kept: KeptContainer[] } {
  const remove: GoneContainer[] = [];
  const kept: KeptContainer[] = [];
  for (const c of containers) {
    const guarded = protectedHashes.get(c.hash);
    if (guarded !== undefined) kept.push({ what: c.name, reason: guarded });
    else if (c.pid === undefined) kept.push({ what: c.name, reason: "no pid after its worktree hash (renamed?), so whether its test still runs is not known" });
    else if (alive(c.pid)) kept.push({ what: c.name, reason: `its test process (pid ${c.pid}) still runs` });
    else remove.push({ ...c, pid: c.pid });
  }
  return { remove, kept };
}

/** The labelled veraPDF containers Docker lists, or undefined when Docker does not answer. */
export function listVeraPdfContainers(timeout?: number): VeraPdfContainer[] | undefined {
  try {
    return parseVeraPdfContainers(execFileSync("docker", ["ps", "-a", "--filter", `label=${VERAPDF_LABEL}`, "--format", psFormat], { encoding: "utf8", timeout }));
  } catch {
    return undefined;
  }
}

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * Removes one container (it only sleeps; nothing in it is kept). RP-1198: refuses, running nothing, a name
 * that is not a veraPDF container's, and one of lane 7's worktree or the main checkout (guarded: this clone's
 * guardedHashes, read here unless given).
 */
export function removeVeraPdfContainer(name: string, { run = docker, guarded }: { run?: (args: string[]) => string; guarded?: Map<string, string> } = {}): Refused | undefined {
  const hash = /^rabaed-verapdf-([0-9a-f]{8})-/.exec(name)?.[1];
  if (hash === undefined) return { refused: `${name} not removed: it is not a veraPDF container.` };
  const hashes = readGuarded(() => guarded ?? guardedHashes(), `${name} not removed`);
  if (isRefused(hashes)) return hashes;
  const why = hashes.get(hash);
  if (why !== undefined) return { refused: `${name} not removed: ${why}.` };
  run(["rm", "-f", name]);
  return undefined;
}
