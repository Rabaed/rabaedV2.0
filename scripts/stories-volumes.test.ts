import { describe, expect, it } from "vitest";
import { chooseStoriesVolumes, parseRemoval, parseVolumeMounts, pathSpellings, removeStoriesVolumes, removeStoriesVolumesNow, storiesHashOf, storiesSets, storiesVolumesIn, storiesVolumesOf, type StoriesDocker } from "./stories-volumes.ts";
import { worktreeHash } from "./stories-hash.ts";
import { volumeName } from "./test-stories-linux.ts";
import { parseWorktrees } from "./worktrees.ts";

// RP-1120: `pnpm test:stories:linux` keeps Linux node_modules in rabaed-stories-<hash>-<folder> volumes,
// one set per worktree. worktrees:prune and worktrees:clean remove the sets of worktrees that are gone,
// and never a set whose worktree still exists, nor a volume a container uses.

// What `git worktree list --porcelain` prints on Windows: forward slashes.
const gitOut = `worktree G:/Rabaed Contech
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree G:/Rabaed Contech/.claude/worktrees/live
HEAD 2222222222222222222222222222222222222222
branch refs/heads/RP-1-live
`;
const existing = parseWorktrees(gitOut).map((w) => w.path);

// What the stories script names them: it hashes the root as Node resolves it, with backslashes.
const mainRoot = "G:\\Rabaed Contech";
const live = "G:\\Rabaed Contech\\.claude\\worktrees\\live";
const gone = "G:\\Rabaed Contech\\.claude\\worktrees\\gone";
const setOf = (root: string) => [".", "packages/ui", "apps/web"].map((folder) => volumeName(root, folder));

const volumes = [...setOf(mainRoot), ...setOf(live), ...setOf(gone), "rabaed-lane7_pgdata", "rabaed-lane42_pgdata"];
const noMounts = new Map<string, string[]>();

describe("storiesHashOf", () => {
  it("reads a stories volume's worktree hash, and nothing from any other volume", () => {
    expect(storiesHashOf(volumeName(live, "packages/ui"))).toBe(worktreeHash(live));
    expect(storiesHashOf("rabaed-lane7_pgdata")).toBeUndefined();
    expect(storiesHashOf("rabaed-stories-xyz-root")).toBeUndefined();
  });
});

describe("pathSpellings", () => {
  it("covers git's forward slashes, Node's backslashes and either drive letter case on Windows", () => {
    const spellings = pathSpellings("G:/Rabaed Contech/.claude/worktrees/live", "win32");
    expect(spellings).toContain(live);
    expect(spellings).toContain("g:\\Rabaed Contech\\.claude\\worktrees\\live");
    expect(spellings).toContain("G:/Rabaed Contech/.claude/worktrees/live");
  });

  it("keeps the path as it is elsewhere", () => {
    expect(pathSpellings("/home/a/rabaed/", "linux")).toEqual(["/home/a/rabaed"]);
  });
});

describe("chooseStoriesVolumes", () => {
  it("keeps an existing worktree's set, the main checkout's included, and removes a gone worktree's (orphaned)", () => {
    const choice = chooseStoriesVolumes({ volumes, existing, mountedBy: noMounts, orphans: true, platform: "win32" });
    expect(choice.remove).toEqual(setOf(gone));
    expect(choice.inUse).toEqual([]);
  });

  it("never names a lane's own volumes, lane 7's included", () => {
    const choice = chooseStoriesVolumes({ volumes, existing: [], mountedBy: noMounts, orphans: true, platform: "win32" });
    expect(choice.remove).not.toContain("rabaed-lane7_pgdata");
    expect(choice.remove).not.toContain("rabaed-lane42_pgdata");
  });

  it("removes only the sets of the worktrees just removed without orphans", () => {
    const other = "G:\\Rabaed Contech\\.claude\\worktrees\\other";
    const choice = chooseStoriesVolumes({ volumes: [...volumes, ...setOf(other)], existing, mountedBy: noMounts, gone: ["G:/Rabaed Contech/.claude/worktrees/gone"], platform: "win32" });
    expect(choice.remove).toEqual(setOf(gone));
  });

  it("never removes a gone path's set while a worktree with that path exists again", () => {
    const choice = chooseStoriesVolumes({ volumes, existing, mountedBy: noMounts, gone: ["G:/Rabaed Contech/.claude/worktrees/live"], platform: "win32" });
    expect(choice.remove).toEqual([]);
  });

  it("skips and names a volume a container uses, and removes the rest of its set", () => {
    const busy = volumeName(gone, "packages/ui");
    const mountedBy = parseVolumeMounts(`rabaed-stories-run\trunning\t${volumeName(gone, ".")},${busy},/run/desktop/mnt/host/g/Rabaed Contech
rabaed-lane42-db-1\trunning\trabaed-lane42_pgdata
`);
    const choice = chooseStoriesVolumes({ volumes, existing, mountedBy, orphans: true, platform: "win32" });
    expect(choice.inUse).toEqual([
      { volume: volumeName(gone, "."), containers: ["rabaed-stories-run (running)"] },
      { volume: busy, containers: ["rabaed-stories-run (running)"] },
    ]);
    expect(choice.remove).toEqual([volumeName(gone, "apps/web")]);
  });

  it("can be limited to the volumes listed before the prompt", () => {
    const listed = new Set([volumeName(gone, ".")]);
    const choice = chooseStoriesVolumes({ volumes, existing, mountedBy: noMounts, orphans: true, only: listed, platform: "win32" });
    expect(choice.remove).toEqual([volumeName(gone, ".")]);
  });
});

describe("removeStoriesVolumesNow", () => {
  const fakeDocker = (over: Partial<StoriesDocker> = {}) => {
    const asked: string[][] = [];
    const docker: StoriesDocker = {
      list: () => volumes,
      mountedBy: () => noMounts,
      remove: (list) => {
        asked.push(list);
        return { removed: list, refused: [] };
      },
      ...over,
    };
    return { docker, asked };
  };

  it("removes a gone worktree's set, read again from Docker and git now, and keeps an existing one's", () => {
    const { docker, asked } = fakeDocker();
    const result = removeStoriesVolumesNow({ orphans: true }, existing, docker, "win32");
    expect(asked).toEqual([setOf(gone)]);
    expect(result).toEqual({ removed: setOf(gone), kept: [], errors: [] });
  });

  it("keeps a volume a container started using since the prompt, and one Docker refuses as in use, without failing", () => {
    const busy = volumeName(gone, ".");
    const { docker } = fakeDocker({
      mountedBy: () => new Map([[busy, ["rabaed-stories-run (running)"]]]),
      remove: (list) => ({ removed: list.slice(1), refused: [{ volume: list[0]!, reason: "volume is in use - [abc]" }] }),
    });
    const result = removeStoriesVolumesNow({ orphans: true }, existing, docker, "win32");
    expect(result.kept).toEqual([`Kept stories volume ${busy}: used by rabaed-stories-run (running).`, `Kept stories volume ${volumeName(gone, "packages/ui")}: volume is in use - [abc].`]);
    expect(result.removed).toEqual([volumeName(gone, "apps/web")]);
    expect(result.errors).toEqual([]);
  });

  it("reports any other refusal as an error", () => {
    const { docker } = fakeDocker({ remove: (list) => ({ removed: [], refused: list.map((volume) => ({ volume, reason: "no space" })) }) });
    expect(removeStoriesVolumesNow({ gone: [gone] }, existing, docker, "win32").errors).toHaveLength(3);
  });

  it("removes nothing when Docker does not answer", () => {
    const { docker, asked } = fakeDocker({ list: () => undefined });
    expect(removeStoriesVolumesNow({ orphans: true }, existing, docker, "win32").kept).toEqual(["Docker did not answer: stories volumes not removed (run `pnpm worktrees:prune` later)."]);
    expect(asked).toEqual([]);
  });
});

describe("storiesVolumesIn", () => {
  it("keeps only the stories volumes of everything Docker lists", () => {
    expect(storiesVolumesIn(volumes)).toEqual([...setOf(mainRoot), ...setOf(live), ...setOf(gone)]);
  });
});

describe("storiesVolumesOf", () => {
  it("finds a worktree's set by git's spelling of its path", () => {
    expect(storiesVolumesOf("G:/Rabaed Contech/.claude/worktrees/gone", volumes, "win32")).toEqual(setOf(gone));
  });
});

describe("storiesSets", () => {
  it("groups volumes by worktree hash", () => {
    expect(storiesSets([...setOf(gone), ...setOf(live)])).toEqual([
      { hash: worktreeHash(gone), volumes: setOf(gone) },
      { hash: worktreeHash(live), volumes: setOf(live) },
    ]);
  });
});

describe("parseVolumeMounts", () => {
  it("reads volumes from `docker ps -a --no-trunc` Mounts, stopped containers too", () => {
    const mountedBy = parseVolumeMounts("a\texited\tv1,v2\nb\trunning\tv2\nc\trunning\t\n");
    expect(mountedBy.get("v1")).toEqual(["a (exited)"]);
    expect(mountedBy.get("v2")).toEqual(["a (exited)", "b (running)"]);
  });
});

describe("parseRemoval", () => {
  it("splits `docker volume rm` output into removed and refused, never forcing", () => {
    const stderr = "Error response from daemon: remove v2: volume is in use - [abc123]\n";
    expect(parseRemoval(["v1", "v2"], "v1\n", stderr)).toEqual({ removed: ["v1"], refused: [{ volume: "v2", reason: "volume is in use - [abc123]" }] });
  });

  it("names Docker's whole message when it names no volume", () => {
    expect(parseRemoval(["v1"], "", "Cannot connect to the Docker daemon\n")).toEqual({ removed: [], refused: [{ volume: "v1", reason: "Cannot connect to the Docker daemon" }] });
  });
});

describe("stories volumes and running verifies (RP-1170: 361 of 372 removals timed out during verifies and hung Docker's volume API)", () => {
  it("removes none while a verify runs anywhere, and says so", () => {
    const asked: string[][] = [];
    const docker: StoriesDocker = { list: () => volumes, mountedBy: () => noMounts, remove: (list) => (asked.push(list), { removed: list, refused: [] }), busy: () => "a verify runs (pid 7, in G:/x)" };
    expect(removeStoriesVolumesNow({ orphans: true }, existing, docker, "win32")).toEqual({
      removed: [],
      kept: ["Stories volumes not removed: a verify runs (pid 7, in G:/x); run `pnpm worktrees:prune` again once no verify runs."],
      errors: [],
    });
    expect(asked).toEqual([]);
  });

  it("removes one set at a time with a pause between, and stops at the first timeout", () => {
    const calls: string[][] = [];
    const waits: number[] = [];
    const sets = [...setOf(gone), ...setOf(live), ...setOf(mainRoot)];
    const run = (args: string[]) => {
      calls.push(args);
      if (calls.length === 2) throw Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" });
      return args.slice(2).join("\n");
    };
    const result = removeStoriesVolumes(sets, { run, wait: (ms) => waits.push(ms) });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(result.removed).toHaveLength(3);
    expect(result.refused).toHaveLength(3);
    expect(result.refused[0]!.reason).toBe("Docker did not answer (spawnSync docker ETIMEDOUT)");
    expect(result.notTried).toHaveLength(3);
  });

  it("names the volumes it did not try in one line", () => {
    const docker: StoriesDocker = {
      list: () => volumes,
      mountedBy: () => noMounts,
      remove: (list) => ({ removed: [], refused: [{ volume: list[0]!, reason: "Docker did not answer (ETIMEDOUT)" }], notTried: list.slice(1) }),
      busy: () => undefined,
    };
    expect(removeStoriesVolumesNow({ orphans: true }, existing, docker, "win32").errors).toEqual([
      `Could not remove stories volume ${volumeName(gone, ".")}: Docker did not answer (ETIMEDOUT)`,
      "2 stories volumes not tried: Docker stopped answering, so they wait for the next `pnpm worktrees:prune`.",
    ]);
  });
});
