// The veraPDF containers the record tests start (RP-1122): veraPdfDockerSession
// (apps/worker/src/record/verapdf.ts) names each rabaed-verapdf-<worktree hash>-<pid>-<n> and
// labels it rabaed.verapdf=<worktree hash>. A test that is killed or times out never runs its
// afterAll, so its container stays until its bounded sleep ends (an hour). `pnpm lanes:prune`
// removes those whose test process (the pid in the name) no longer runs, after the same
// confirmation as its compose projects, and lists them with --dry-run.
//
// Kept, and named: a container whose process still runs, one whose name carries no pid, and
// any of a worktree that holds lane 7 (Main 7's harness).
import { execFileSync } from "node:child_process";
import { protectedLaneReason } from "./lanes.ts";
import { pathSpellings } from "./stories-volumes.ts";
import { worktreeHash } from "./test-stories-linux.ts";

export const VERAPDF_LABEL = "rabaed.verapdf";

export type VeraPdfContainer = { name: string; hash: string; pid: number | undefined; state: string; age: string };
export type KeptContainer = { what: string; reason: string };
/** A container whose test process is gone. */
export type Orphan = VeraPdfContainer & { pid: number };

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

/** The worktree hashes whose containers are never removed, with why: those of the worktrees holding lane 7. */
export function protectedHashes(worktrees: { path: string; project: string | undefined }[], platform: NodeJS.Platform = process.platform): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const w of worktrees) {
    const reason = protectedLaneReason(w.project);
    if (reason !== undefined) for (const spelling of pathSpellings(w.path, platform)) hashes.set(worktreeHash(spelling), reason);
  }
  return hashes;
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
}): { remove: Orphan[]; kept: KeptContainer[] } {
  const remove: Orphan[] = [];
  const kept: KeptContainer[] = [];
  for (const c of containers) {
    const guarded = protectedHashes.get(c.hash);
    if (guarded !== undefined) kept.push({ what: c.name, reason: guarded });
    else if (c.pid === undefined) kept.push({ what: c.name, reason: "no pid after rabaed-verapdf-<hash>- (renamed?), so whether its test still runs is not known" });
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

/** Removes one container (it only sleeps; nothing in it is kept). */
export function removeVeraPdfContainer(name: string): void {
  execFileSync("docker", ["rm", "-f", name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
