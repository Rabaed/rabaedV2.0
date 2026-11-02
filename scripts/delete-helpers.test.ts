import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as laneReset from "./lane-reset.ts";
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
// A new exported remover, found by its name or by a removal call in its body (review S3), that is in
// none of the lists below fails the first test.

/** Exported names that sound like they remove something: whole camelCase words at the start, or one at the end. */
const REMOVER = /^(remove|delete|rd|release|drop|prune|stop)(?![a-z])|(Remove|Delete|Prune|Drop)$/;

/** A junction on Windows (no admin needed), a directory symlink elsewhere. */
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

/** Whether this machine can make a link at all, tried once in a temp folder: the link test runs only where it can. */
const CAN_LINK = (() => {
  const probe = mkdtempSync(join(tmpdir(), "rp1198-link-probe-"));
  try {
    mkdirSync(join(probe, "target"));
    symlinkSync(join(probe, "target"), join(probe, "link"), LINK_TYPE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/** The ones that delete no worktree, folder, branch, stack, volume or database, each with why. */
const REMOVES_NOTHING: Record<string, string> = {
  "lanes-lock.ts:removeStale": "a lane lock file, only when the holder it names is gone (its own pid check)",
  "verify-lock.ts:releaseLock": "the verify lock file, only when this pid holds it",
  "verify-queue.ts:removePlaces": "this pid's own place files in the machine-wide verify line (RP-1197)",
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
  "behind-origin.ts:stopIfBehindOrigin": "stops the script it runs in (exit 1) when this checkout is far behind origin/main; deletes nothing",
  "queue-stack-stop.ts:stopQueuedStack": "stops (never removes) a lane's containers, never lane 7's",
  "queue-stack-stop.ts:stopAfterEnqueue": "calls stopQueuedStack",
};

/**
 * The second net (RP-1198 review S3): calls that remove a folder, container, volume, network, branch,
 * worktree or database, wherever they sit in an exported function's body or an exported object's methods.
 */
const REMOVAL_CALLS: RegExp[] = [
  /\brmSync\b/,
  /\brm -rf\b/,
  /\brd \/s\b/i,
  /["'`]rm["'`]/,
  /["'`]-D["'`]|\bbranch -D\b/,
  /\bworktree remove\b|["'`]worktree["'`],\s*["'`]remove["'`]/,
  /\bdrop database\b/i,
];

/** The removers that sit in a top-level `export`, or behind a local declaration it calls, under no name REMOVER knows. */
const REMOVES_ONLY_ITS_OWN: Record<string, string> = {
  "merge-checks.ts:realMergeChecksSeam":
    "its remove deletes a checkout it made itself under the OS tmpdir (mkdtempSync, merge-checks-*) for pnpm queue's checks, never a worktree of this clone",
  "resolve-visibility.ts:mergeVisibility": "gitMergeFile's own temp folder under the OS tmpdir (rabaed-merge-file-*), made and deleted in one call",
  "verify-pr-body.ts:realPrBodySeam": "setBody's own temp folder under the OS tmpdir (verify-pr-*), made and deleted in one call",
  "lanes-lock.ts:acquireLaneLock": "its own lane lock file and the temp files beside it (removeStale's pid check)",
  "verify-lock.ts:acquireLock": "its own verify lock file's temp and stale copies (create, removeStale)",
  "verify-lock.ts:waitForLock": "calls acquireLock",
  "verify-queue.ts:waitForTurn": "the verify line's own lock (acquireLock) and the place files of runs whose pid is gone (RP-1197)",
  "removal-guard.ts:folderDeletionRefusal": "pure: its refusal text names `git worktree remove`; it runs nothing",
};

/** One top-level declaration: from a line at column 0 to the next one (formatted code puts only closers there). */
type Declaration = { name: string | undefined; exported: boolean; body: string };

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

/** The source's top-level declarations, comments left out. */
function declarations(source: string): Declaration[] {
  const chunks: string[] = [];
  for (const line of withoutComments(source).split(/\r?\n/)) {
    if (/^[^\s})\]]/.test(line) || chunks.length === 0) chunks.push(line);
    else chunks[chunks.length - 1] += `\n${line}`;
  }
  return chunks.map((body) => {
    const m = /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s*|const\s+|let\s+|class\s+)([A-Za-z0-9_$]+)/.exec(body);
    return { name: m?.[2], exported: m?.[1] !== undefined, body };
  });
}

/**
 * The exported names in one script that remove something: by name (REMOVER), or by a removal call
 * (REMOVAL_CALLS) in their own body or in a local declaration they call, however deep.
 */
function removersIn(source: string): string[] {
  const all = declarations(source);
  const local = new Map(all.filter((d) => d.name !== undefined).map((d) => [d.name!, d]));
  /** Whether body calls the local declaration: `name(`, not `.name(` (a method of something else). */
  const calls = (body: string, name: string) => new RegExp(`(?<![.\\w$])${name.replace(/\$/g, "\\$")}\\s*\\(`).test(body);
  const removes = (d: Declaration, seen: Set<string>): boolean =>
    REMOVAL_CALLS.some((call) => call.test(d.body)) ||
    [...local.values()].some((other) => !seen.has(other.name!) && calls(d.body, other.name!) && removes(other, new Set([...seen, other.name!])));
  return all.filter((d) => d.exported && d.name !== undefined && (REMOVER.test(d.name) || removes(d, new Set([d.name])))).map((d) => d.name!);
}

/** Every `file:name` removersIn finds in a non-test script under scripts/, read from the source. */
function exportedRemovers(): string[] {
  const dir = import.meta.dirname;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((file) => removersIn(readFileSync(join(dir, file), "utf8")).map((name) => `${file}:${name}`))
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
type Case = ((f: Fixture) => Outcome | Promise<Outcome>) | { notApplicable: string };
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
  const logged: string[] = [];
  worktreesPruning.removeProjectsNow({
    projects: [{ project: name, reason: "worktree gone", containers: [], volumes: [], waitsFor: [] }],
    removedPaths: [],
    listed: { worktrees: [], containers: [] },
    readNow: () => ({ claims: [], containers: [], postgres: undefined }),
    exists: () => false,
    remove: (p) => void ran.push(`remove ${p.project}`),
    log: (line) => logged.push(line),
  });
  // It logs its refusals, as worktrees:prune prints them (review T5: no return value only tests read).
  return { result: { refused: logged.find((line) => line.startsWith(`Kept compose project ${name}:`)) }, ran };
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
    remove: (list) => (ran.push(`remove ${list.join(" ")}`), { removed: list, refusedVolumes: [] }),
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

/**
 * lane:reset with a careless world: Docker answers, the lane has a stack, nothing holds it and the
 * prompt says yes. It returns an exit code; its refusal is what it prints on exit 1 (as worktrees:prune logs).
 */
const reset = async (lane: number): Promise<Outcome> => {
  const d = docker();
  const errors: string[] = [];
  const name = lanes.laneProject(lane);
  const deps: laneReset.ResetDeps = {
    cwd: "C:\\w\\careless",
    probe: () => ({ ok: true }),
    sessionCwds: () => [],
    docker: (args) => d.run(args),
    listContainers: () => [{ name: `${name}-db-1`, state: "running", project: name, workingDir: "C:\\w\\careless", ports: [] }],
    listVolumes: () => [{ name: `${name}_db-data`, project: name }],
    worktrees: () => [],
    readEnv: () => undefined,
    exists: () => true,
    holders: () => ({ runningSession: () => undefined, desktopSession: () => undefined }),
    verifies: () => ({ runs: [] }),
    remove: (stale, options) => lanes.removeProject(stale, { ...options, run: d.run, wait: () => {} }),
    confirm: async () => true,
    log: () => {},
    error: (line) => errors.push(line),
  };
  const code = await laneReset.resetLane([String(lane)], deps);
  return { result: code === 0 ? {} : { refused: errors.join("\n") }, ran: d.ran };
};

/** A branch helper deletes no folder: the outside rule is for the helpers that do (RP-1198 comment 15382, point 1). */
const NO_FOLDER = { notApplicable: "it deletes no folder; the .claude/worktrees rule is for those that do (RP-1198 comment 15382, point 1)" };

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
  "lane-reset.ts:resetLane": {
    module: laneReset,
    cases: {
      "lane 7": () => reset(7),
      // Lane 0's stack is the main checkout's (rabaed-lane0); lane:reset takes lanes, never the bare `rabaed`.
      "the main checkout": () => reset(0),
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
  it("knows every exported remover in scripts/, by name or by its body: each is tested below or listed with why", () => {
    const known = [...Object.keys(HELPERS), ...Object.keys(REMOVES_NOTHING), ...Object.keys(REMOVES_ONLY_ITS_OWN)].sort();
    expect(exportedRemovers()).toEqual(known);
  });

  it("finds a remover by its body when its name says nothing: its own removal call, an exported object's method, or a local helper it calls", () => {
    const source = [
      'import { rmSync } from "node:fs";',
      "/** Tidies up. */",
      "export function tidy(path: string) {",
      "  rmSync(path, { recursive: true });",
      "}",
      "export const seam = {",
      '  wipe: (name: string) => run(["volume", "rm", name]),',
      "};",
      "function dropIt(name: string) {",
      "  return psql(`DROP DATABASE ${name}`);",
      "}",
      "export const finish = (name: string) => dropIt(name);",
      "// rmSync in a comment is no call",
      "export function quiet() {",
      "  // git branch -D here is a comment",
      "  return 1;",
      "}",
      "export const removeNothing = () => 0;",
    ].join("\n");
    expect(removersIn(source)).toEqual(["tidy", "seam", "finish", "removeNothing"]);
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

  // RP-1198 review S4 (CODING_STANDARDS › Tests): the inputs most likely to slip past a path check.
  /** The folder helpers, each with a path a careless caller might pass. */
  const folderHelpers = (path: string): Record<string, () => Outcome> => ({
    "worktree-removal.ts:removeWorktreeFolder": () => folderRemoval(f, path),
    "worktrees.ts:rdLongPath": () => rd(path),
    "worktrees.ts:removeLinkedWorktree": () => withGit(() => worktrees.removeLinkedWorktree({ ...listedAt(f, path), path }, f.lane7, "main")),
  });
  const refusesAll = (path: string) => {
    for (const [key, call] of Object.entries(folderHelpers(path))) {
      const { result, ran } = call();
      expect((result as { refused?: unknown } | undefined)?.refused, key).toEqual(expect.stringMatching(/\S/));
      expect(ran, key).toEqual([]);
      expect(intact(f), key).toBe(true);
    }
  };
  const mixedCase = (path: string) => path.replace(/[a-z]/gi, (c, i: number) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()));

  it.runIf(process.platform === "win32")("refuses the main checkout and lane 7's worktree spelled in upper or mixed case (Windows)", () => {
    for (const path of [f.main.toUpperCase(), mixedCase(f.main), f.lane7.toUpperCase(), mixedCase(f.lane7)]) refusesAll(path);
  });

  it.runIf(CAN_LINK)("refuses a junction or symlink under .claude/worktrees/ that points outside, and leaves its target intact", () => {
    const link = join(f.main, ".claude", "worktrees", "link-out");
    symlinkSync(f.outside, link, LINK_TYPE);
    try {
      refusesAll(link);
      // The real rd, too: it refuses the link before it runs.
      if (process.platform === "win32") expect(worktrees.rdLongPath(link)).toEqual({ refused: expect.stringContaining("a link") });
      expect(existsSync(join(f.outside, "keep.txt"))).toBe(true);
    } finally {
      unlinkSync(link);
    }
  });

  for (const [key, { cases }] of Object.entries(HELPERS)) {
    for (const [what, call] of Object.entries(cases) as [keyof Cases, Case][]) {
      if ("notApplicable" in call) {
        it(`${key} has no ${what} case: ${call.notApplicable}`, () => expect(call.notApplicable).not.toBe(""));
        continue;
      }
      it(`${key} refuses ${what} itself, running nothing`, async () => {
        const { result, ran } = await call(f);
        const why = (result as { refused?: unknown } | undefined)?.refused;
        expect(why, "returns { refused: <why> }").toEqual(expect.stringMatching(/\S/));
        expect(ran).toEqual([]);
        expect(intact(f)).toBe(true);
      });
    }
  }
});
