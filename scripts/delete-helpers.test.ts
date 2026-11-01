import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as lanes from "./lanes.ts";
import { samePath } from "./paths.ts";
import * as storiesVolumes from "./stories-volumes.ts";
import { STORIES_VOLUME_PREFIX, worktreeHash } from "./stories-hash.ts";
import * as veraPdf from "./verapdf-containers.ts";
import * as worktreeRemoval from "./worktree-removal.ts";
import type { RemoveTarget } from "./worktree-removal.ts";
import * as worktreesPruning from "./worktrees-pruning.ts";
import * as worktrees from "./worktrees.ts";

// RP-1198, item 1: every exported helper in scripts/ that removes or deletes something refuses on its
// own: lane 7's (Main 7's harness data), the main checkout's, and a folder outside .claude/worktrees/.
// It never trusts its caller to have checked: each case below passes the facts a careless caller
// would (no project, a wrong main root, nothing held) and expects `{ refused }` with nothing run.
// A new exported remover (by its name) that is in neither list below fails the first test.

/** Exported names that sound like they remove something: whole camelCase words at the start, or one at the end. */
const REMOVER = /^(remove|delete|rd|release|drop|prune|stop)(?![a-z])|(Remove|Delete|Prune|Drop)$/;

/** The ones that delete no worktree, folder, branch, stack, volume or database, each with why. */
const REMOVES_NOTHING: Record<string, string> = {
  "lanes-lock.ts:removeStale": "a lane lock file, only when the holder it names is gone (its own pid check)",
  "verify-lock.ts:releaseLock": "the verify lock file, only when this pid holds it",
  "lanes.ts:dropOrKeep": "pure: splits orphan databases into those to drop and the busy ones",
  "lanes.ts:dropDbsPostgres": "pure: lanes:drop-dbs's Postgres containers, lane 7's left out",
  "lanes.ts:pruneCommand": "pure: the lanes:prune command line for a lane",
  "lane-done-plan.ts:releaseLines": "pure: the RP-603 RELEASE text",
  "reviewed-label.ts:dropLabelOnPush": "a PR's `reviewed` label on GitHub",
  "worktrees.ts:fetchPrune": "`git fetch --prune origin`: remote-tracking refs only",
  "worktrees.ts:pruneWorktrees": "`git worktree prune`: git's records of worktrees whose folder is already gone",
  "worktrees-pruning.ts:choosePrune": "pure: worktrees:prune's choice",
  "servers.ts:stopCommand": "pure: the command that stops a dev server",
  "servers.ts:stopServers": "stops this clone's dev server processes; deletes nothing",
  "queue-stack-stop.ts:stopQueuedStack": "stops (never removes) a lane's containers, never lane 7's",
  "queue-stack-stop.ts:stopAfterEnqueue": "calls stopQueuedStack",
};

/** Every `file:name` exported from a non-test script under scripts/ whose name matches REMOVER, read from the source. */
function exportedRemovers(): string[] {
  const dir = import.meta.dirname;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((file) =>
      [...readFileSync(join(dir, file), "utf8").matchAll(/^export (?:async )?(?:function\*?\s*|const |let )([A-Za-z0-9_$]+)/gm)]
        .map((m) => m[1]!)
        .filter((name) => REMOVER.test(name))
        .map((name) => `${file}:${name}`),
    )
    .sort();
}

/**
 * A throwaway clone in the system temp folder: `main` (the main checkout, its .git a directory, on main),
 * lane 7's worktree `main/.claude/worktrees/agent-lane7` (its .env names rabaed-lane7, on RP-7-harness),
 * and a plain folder `outside` that git does not list, beside the clone.
 */
type Fixture = { tmp: string; main: string; lane7: string; outside: string };

const git = (args: string[], cwd: string) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeFixture(): Fixture {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "rabaed-delete-helpers-")));
  const main = join(tmp, "main clone");
  mkdirSync(main);
  git(["init", "-q", "-b", "main"], main);
  writeFileSync(join(main, "a.txt"), "a");
  git(["add", "a.txt"], main);
  git(["commit", "-q", "-m", "first"], main);
  writeFileSync(join(main, ".env"), "COMPOSE_PROJECT_NAME=rabaed\n");
  const lane7 = join(main, ".claude", "worktrees", "agent-lane7");
  git(["worktree", "add", "-q", "-b", "RP-7-harness", lane7], main);
  // Committed, so the worktree is clean: git's own remove would take it, and only the helper's refusal keeps it.
  writeFileSync(join(lane7, ".env"), "COMPOSE_PROJECT_NAME=rabaed-lane7\n");
  git(["add", ".env"], lane7);
  git(["commit", "-q", "-m", "lane 7"], lane7);
  const outside = join(tmp, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "keep");
  return { tmp, main, lane7, outside };
}

/** Whether everything the fixture made is still there. */
function intact(f: Fixture): boolean {
  const branches = git(["branch", "--format=%(refname:short)"], f.main).split(/\r?\n/);
  return existsSync(join(f.main, "a.txt")) && existsSync(join(f.lane7, ".env")) && existsSync(join(f.outside, "keep.txt")) && branches.includes("main") && branches.includes("RP-7-harness");
}

/** A runner that records each command and answers nothing; the reads a helper may make on its own are listed apart. */
function recorder() {
  const ran: string[] = [];
  const run = (command: string, args: string[]) => {
    ran.push([command, ...args].join(" "));
    return "";
  };
  return { ran, run, removing: () => ran.filter((line) => !READS.includes(line)) };
}

/** Commands a helper may run to read facts for its own refusal; they change nothing. */
const READS = ["git worktree list --porcelain"];

type Outcome = { result: unknown; ran: string[] };
/** How to call one helper for one case, or why the case does not apply to it. */
type Case = ((f: Fixture) => Outcome) | { notApplicable: string };
type Cases = { "lane 7": Case; "the main checkout": Case; "a folder outside .claude/worktrees": Case };

/** A target with the facts a caller that checked nothing would pass. */
const careless = (f: Fixture, path: string): RemoveTarget => ({
  path,
  mainRoot: join(f.tmp, "not the main root"),
  currentRoot: join(f.tmp, "somewhere else"),
  registered: { path, head: "", branch: undefined, locked: undefined },
  exists: true,
  readable: false,
  changes: [],
  unpushed: 0,
  project: undefined,
  held: undefined,
});

const folderRemoval = (f: Fixture, path: string): Outcome => {
  const r = recorder();
  const rd = (folder: string) => void r.ran.push(`rd ${folder}`);
  const result = worktreeRemoval.removeWorktreeFolder(careless(f, path), { run: r.run, rd, exists: existsSync });
  return { result, ran: r.removing() };
};

const rd = (path: string): Outcome => {
  const ran: string[] = [];
  const spawn = ((command: string, args: string[]) => {
    ran.push([command, ...args].join(" "));
    return { status: 0, stdout: "", stderr: "" };
  }) as unknown as Parameters<typeof worktrees.rdLongPath>[1];
  return { result: worktrees.rdLongPath(path, spawn), ran };
};

/** git's own entry for the folder, as worktrees:prune passes it. */
const listedAt = (f: Fixture, path: string): worktrees.Worktree => worktrees.listWorktrees(f.main).find((w) => samePath(w.path, path)) ?? { path, head: "", branch: undefined, locked: undefined };

/** Helpers that run real git on the fixture: nothing is recorded, and `intact` shows nothing went. */
const withGit = (call: () => unknown): Outcome => ({ result: call(), ran: [] });

/** Docker through a recording runner. */
const docker = () => {
  const ran: string[] = [];
  return { ran, run: (args: string[]) => (ran.push(`docker ${args.join(" ")}`), "") };
};

const project = (name: string): Outcome => {
  const d = docker();
  const result = lanes.removeProject({ project: name, reason: "worktree gone", containers: [`${name}-db-1`], volumes: [`${name}_db-data`] }, { run: d.run, wait: () => {}, volumesKeptBecause: () => undefined });
  return { result, ran: d.ran };
};

const takeover = (c: Pick<lanes.Container, "name" | "project" | "workingDir">): Outcome => {
  const d = docker();
  return { result: lanes.releaseContainers([{ state: "running", ports: [], ...c }], d.run), ran: d.ran };
};

const drop = (db: Pick<lanes.Container, "name" | "project">, name: string): Outcome => {
  const ran: string[] = [];
  const run = (container: string, sql: string) => (ran.push(`psql ${container} ${sql}`), []);
  return { result: lanes.dropDatabase({ state: "running", workingDir: "", ports: [], ...db }, name, run), ran };
};

const projectsNow = (name: string): Outcome => {
  const ran: string[] = [];
  const result = worktreesPruning.removeProjectsNow({
    projects: [{ project: name, reason: "worktree gone", containers: [], volumes: [], waitsFor: [] }],
    removedPaths: [],
    listed: { worktrees: [], containers: [] },
    readNow: () => ({ claims: [], containers: [], postgres: undefined }),
    exists: () => false,
    remove: (p) => void ran.push(`remove ${p.project}`),
    log: () => {},
  });
  return { result, ran };
};

/** A stories volume of the worktree at path, as test-stories-linux.ts names them. */
const storiesVolume = (path: string) => `${STORIES_VOLUME_PREFIX}${worktreeHash(path)}-root`;

const volumes = (f: Fixture, path: string): Outcome => {
  const d = docker();
  const result = storiesVolumes.removeStoriesVolumes([storiesVolume(path)], { run: d.run, wait: () => {}, guarded: storiesVolumes.guardedHashes(f.main) });
  return { result, ran: d.ran };
};

const volumesNow = (f: Fixture, path: string): Outcome => {
  const ran: string[] = [];
  const fake: storiesVolumes.StoriesDocker = {
    list: () => [storiesVolume(path)],
    mountedBy: () => new Map(),
    remove: (list) => (ran.push(`remove ${list.join(" ")}`), { removed: list, refused: [] }),
    busy: () => undefined,
    guarded: () => storiesVolumes.guardedHashes(f.main),
  };
  // A careless caller: every set an orphan, no worktree named as existing.
  return { result: storiesVolumes.removeStoriesVolumesNow({ orphans: true }, [], fake), ran };
};

const veraPdfContainer = (f: Fixture, path: string): Outcome => {
  const d = docker();
  const result = veraPdf.removeVeraPdfContainer(`rabaed-verapdf-${worktreeHash(path)}-4242-1`, { run: d.run, guarded: storiesVolumes.guardedHashes(f.main) });
  return { result, ran: d.ran };
};

/** A branch helper deletes no folder: the outside rule is for the helpers that do (owner, RP-1198 comment 15382). */
const NO_FOLDER = { notApplicable: "it deletes no folder; the .claude/worktrees rule is for those that do (owner's answer 1, RP-1198)" };

const HELPERS: Record<string, { module: Record<string, unknown>; cases: Cases }> = {
  "worktree-removal.ts:removeWorktreeFolder": {
    module: worktreeRemoval,
    cases: {
      "lane 7": (f) => folderRemoval(f, f.lane7),
      "the main checkout": (f) => folderRemoval(f, f.main),
      "a folder outside .claude/worktrees": (f) => folderRemoval(f, f.outside),
    },
  },
  "worktrees.ts:rdLongPath": {
    module: worktrees,
    cases: {
      "lane 7": (f) => rd(f.lane7),
      "the main checkout": (f) => rd(f.main),
      "a folder outside .claude/worktrees": (f) => rd(f.outside),
    },
  },
  "worktrees.ts:removeLinkedWorktree": {
    module: worktrees,
    cases: {
      "lane 7": (f) => withGit(() => worktrees.removeLinkedWorktree(listedAt(f, f.lane7), f.main, "main")),
      // A careless caller's main root: lane 7's folder, from which git works as well.
      "the main checkout": (f) => withGit(() => worktrees.removeLinkedWorktree(listedAt(f, f.main), f.lane7, "main")),
      "a folder outside .claude/worktrees": (f) => withGit(() => worktrees.removeLinkedWorktree(listedAt(f, f.outside), f.main, "main")),
    },
  },
  "worktrees.ts:removeWorktree": {
    module: worktrees,
    cases: {
      "lane 7": (f) => withGit(() => worktrees.removeWorktree(listedAt(f, f.lane7), f.main, "main")),
      "the main checkout": (f) => withGit(() => worktrees.removeWorktree(listedAt(f, f.main), f.main, "main")),
      "a folder outside .claude/worktrees": (f) => withGit(() => worktrees.removeWorktree(listedAt(f, f.outside), f.main, "main")),
    },
  },
  "worktrees.ts:deleteBranch": {
    module: worktrees,
    cases: {
      "lane 7": (f) => withGit(() => worktrees.deleteBranch("RP-7-harness", f.main)),
      "the main checkout": (f) => withGit(() => worktrees.deleteBranch("main", f.main)),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "lanes.ts:removeProject": {
    module: lanes,
    cases: {
      "lane 7": () => project("rabaed-lane7"),
      "the main checkout": () => project("rabaed"),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "lanes.ts:releaseContainers": {
    module: lanes,
    cases: {
      "lane 7": (f) => takeover({ name: "rabaed-lane7-db-1", project: "rabaed-lane7", workingDir: f.lane7 }),
      // By its folder: a container the main checkout started, under a lane's project name.
      "the main checkout": (f) => takeover({ name: "rabaed-lane30-db-1", project: "rabaed-lane30", workingDir: f.main }),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "lanes.ts:dropDatabase": {
    module: lanes,
    cases: {
      "lane 7": () => drop({ name: "rabaed-lane7-db-1", project: "rabaed-lane7" }, "rabaed_rp7"),
      "the main checkout": () => drop({ name: "rabaed-db-1", project: "rabaed" }, "rabaed"),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "worktrees-pruning.ts:removeProjectsNow": {
    module: worktreesPruning,
    cases: {
      "lane 7": () => projectsNow("rabaed-lane7"),
      "the main checkout": () => projectsNow("rabaed"),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "stories-volumes.ts:removeStoriesVolumes": {
    module: storiesVolumes,
    cases: {
      "lane 7": (f) => volumes(f, f.lane7),
      "the main checkout": (f) => volumes(f, f.main),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "stories-volumes.ts:removeStoriesVolumesNow": {
    module: storiesVolumes,
    cases: {
      "lane 7": (f) => volumesNow(f, f.lane7),
      "the main checkout": (f) => volumesNow(f, f.main),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
  "verapdf-containers.ts:removeVeraPdfContainer": {
    module: veraPdf,
    cases: {
      "lane 7": (f) => veraPdfContainer(f, f.lane7),
      "the main checkout": (f) => veraPdfContainer(f, f.main),
      "a folder outside .claude/worktrees": NO_FOLDER,
    },
  },
};

describe("delete helpers refuse on their own (RP-1198)", () => {
  it("knows every exported remover in scripts/: each is tested below or listed as removing nothing, with why", () => {
    const known = [...Object.keys(HELPERS), ...Object.keys(REMOVES_NOTHING)].sort();
    expect(exportedRemovers()).toEqual(known);
  });

  it("names a real export for every helper it tests", () => {
    for (const [key, { module }] of Object.entries(HELPERS)) expect(typeof module[key.split(":")[1]!], key).toBe("function");
  });

  let f: Fixture;
  const removeFixture = () => rmSync(f.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  beforeAll(() => {
    f = makeFixture();
  });
  // A helper that removed something fails its own case; a fresh clone keeps that from failing the cases after it.
  afterEach(() => {
    if (intact(f)) return;
    removeFixture();
    f = makeFixture();
  });
  afterAll(removeFixture);

  for (const [key, { cases }] of Object.entries(HELPERS)) {
    for (const [what, call] of Object.entries(cases) as [keyof Cases, Case][]) {
      if ("notApplicable" in call) {
        it(`${key} has no ${what} case: ${call.notApplicable}`, () => expect(call.notApplicable).not.toBe(""));
        continue;
      }
      it(`${key} refuses ${what} itself, running nothing`, () => {
        const { result, ran } = call(f);
        // A helper that takes many (removeProjectsNow) returns each refusal.
        const why = (result as { refused?: unknown } | undefined)?.refused;
        expect(Array.isArray(why) ? why : [why], "returns { refused: <why> }").toEqual([expect.stringMatching(/\S/)]);
        expect(ran).toEqual([]);
        expect(intact(f)).toBe(true);
      });
    }
  }
});
