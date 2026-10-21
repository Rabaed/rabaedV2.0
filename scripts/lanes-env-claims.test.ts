// RP-1007: a lane is held while any other worktree's .env names its compose project, even with its
// containers stopped or gone. Fixture worktrees are real folders with real .env files.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Holders } from "./claude-sessions.ts";
import {
  chooseMerged,
  chooseTakeover,
  clashesAfterRemoval,
  envClaims,
  firstFreeLane,
  keptByClaims,
  laneClashes,
  newClaimant,
  readWorktreeEnv,
  staleProjects,
  type Container,
  type EnvClaim,
  type TakeoverWorktree,
} from "./lanes.ts";

const none: Holders = { runningSession: () => undefined, desktopSession: () => undefined };
const container = (c: Partial<Container> & Pick<Container, "name">): Container => ({ state: "running", project: "", workingDir: "", ports: [], ...c });

let root: string;
let first: string; // its .env names lane 32, its containers are down
let second: string; // the worktree running lane:env / lanes:prune
let other: string; // its .env names a non-lane project
let bare: string; // no .env at all
const gone = () => join(root, "gone");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "rp-1007-"));
  const worktree = (name: string, env?: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    if (env !== undefined) writeFileSync(join(dir, ".env"), env);
    return dir;
  };
  first = worktree("RP-983-first", "POSTGRES_PORT=5752\nCOMPOSE_PROJECT_NAME=rabaed-lane32\n");
  second = worktree("RP-992-second", "COMPOSE_PROJECT_NAME=rabaed-lane31\n");
  other = worktree("RP-1-other", 'COMPOSE_PROJECT_NAME="someone-else"\n');
  bare = worktree("RP-2-bare");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const worktrees = () => [
  { path: first, branch: "RP-983-first" },
  { path: second, branch: "RP-992-second" },
  { path: other, branch: "RP-1-other" },
  { path: bare, branch: undefined },
  { path: gone(), branch: "RP-3-gone" },
];
const claimsFrom = (cwd: string) => envClaims(worktrees(), { cwd, readEnv: readWorktreeEnv });

describe("envClaims", () => {
  it("lists every other worktree whose .env names a rabaed-* compose project", () => {
    expect(claimsFrom(second)).toEqual([{ path: first, branch: "RP-983-first", project: "rabaed-lane32" }]);
    expect(claimsFrom(first)).toEqual([{ path: second, branch: "RP-992-second", project: "rabaed-lane31" }]);
  });

  it("reads nothing from a folder with no .env, or one that is gone", () => {
    expect(readWorktreeEnv(bare)).toBeUndefined();
    expect(readWorktreeEnv(gone())).toBeUndefined();
  });
});

describe("lane:env with a lane another worktree's .env names (RP-1007)", () => {
  const check = (claims: EnvClaim[], extra: { claimFree?: (c: EnvClaim) => boolean; ownDatabase?: boolean } = {}) => ({
    containers: [] as Container[],
    takenPorts: new Set<number>(),
    cwd: second,
    claims,
    ...extra,
  });

  it("counts lane 32 as held, naming the worktree, though its containers are down", () => {
    expect(laneClashes(32, check(claimsFrom(second)))).toEqual([
      `Compose project rabaed-lane32 is in the .env of ${first} (on RP-983-first): that worktree holds the lane even with its containers stopped.`,
    ]);
  });

  it("--free from lane 32 returns a different lane", () => {
    const input = check(claimsFrom(second));
    expect(firstFreeLane(32, (n) => laneClashes(n, input))).toBe(33);
    // And from lane 31, the first free lane skips 32.
    const busy31 = { ...input, takenPorts: new Set([5742]) };
    expect(firstFreeLane(31, (n) => laneClashes(n, busy31))).toBe(33);
  });

  it("counts the twin lane's project too (legacy 3 and lane 30 share ports)", () => {
    const claims: EnvClaim[] = [{ path: first, branch: "x", project: "rabaed-lane3" }];
    expect(laneClashes(30, check(claims))).toHaveLength(1);
  });

  it("does not count this worktree's own .env, a claim the caller frees, or a --db run sharing its lane", () => {
    const own: EnvClaim[] = [{ path: second, branch: "RP-992-second", project: "rabaed-lane32" }];
    expect(laneClashes(32, check(own))).toEqual([]);
    expect(laneClashes(32, check(claimsFrom(second), { claimFree: (c) => c.path === first }))).toEqual([]);
    expect(laneClashes(32, check(claimsFrom(second), { ownDatabase: true }))).toEqual([]);
  });

  it("names a worktree once when it has containers of the lane as well", () => {
    const containers = [container({ name: "rabaed-lane32-db-1", state: "exited", project: "rabaed-lane32", workingDir: first })];
    const clashes = laneClashes(32, { ...check(claimsFrom(second)), containers });
    expect(clashes).toEqual([`Compose project rabaed-lane32 already belongs to ${first} (it would share that worktree's database).`]);
  });
});

describe("lane:env --force with a lane only a worktree's .env names (RP-1007)", () => {
  const wt = (w: Partial<TakeoverWorktree>): TakeoverWorktree => ({ path: first, branch: "RP-983-first", merged: false, dirty: false, exists: true, project: "rabaed-lane32", ...w });
  const choose = (w: TakeoverWorktree[], holders: Holders = none) => chooseTakeover(32, { containers: [], worktrees: w, cwd: second, holders, platform: process.platform });

  it("refuses when that worktree is not merged, naming it", () => {
    const p = choose([wt({})]);
    expect(p.refused).toEqual([`${first} is on RP-983-first, not merged into origin/main yet, and has rabaed-lane32 in its .env.`]);
    expect(p.released).toEqual([]);
  });

  it("refuses a merged claimant a session holds, or with uncommitted changes", () => {
    const held: Holders = { ...none, runningSession: (path) => (path === first ? 'a running Claude session is in it: session "Main 3" (pid 9)' : undefined) };
    expect(choose([wt({ merged: true })], held).refused).toEqual([`${first} is on RP-983-first and a running Claude session is in it: session "Main 3" (pid 9).`]);
    expect(choose([wt({ merged: true, dirty: true })]).refused).toEqual([`${first} is on RP-983-first and has uncommitted changes.`]);
  });

  it("takes it over from a merged, clean claimant: nothing to remove, its claim released", () => {
    const p = choose([wt({ merged: true })]);
    expect(p.refused).toEqual([]);
    expect(p.takeOver).toEqual([]);
    expect(p.released).toEqual([first]);
    expect(p.from).toEqual([`${first} (RP-983-first, merged into origin/main; rabaed-lane32 is in its .env)`]);
    const input = { containers: [], takenPorts: new Set<number>(), cwd: second, claims: claimsFrom(second) };
    expect(laneClashes(32, input)).toHaveLength(1);
    expect(clashesAfterRemoval(32, input, p.takeOver, p.released)).toEqual([]);
  });
});

describe("lanes:prune with a lane another worktree's .env names (RP-1007)", () => {
  let stopped: Container[];
  beforeAll(() => {
    stopped = [
      container({ name: "rabaed-lane32-db-1", state: "exited", project: "rabaed-lane32", workingDir: first }),
      container({ name: "rabaed-lane33-db-1", state: "exited", project: "rabaed-lane33", workingDir: gone() }),
    ];
  });
  const volumes = [
    { name: "rabaed-lane32_db-data", project: "rabaed-lane32" },
    { name: "rabaed-lane33_db-data", project: "rabaed-lane33" },
    { name: "rabaed-lane43_db-data", project: "rabaed-lane43" },
  ];

  it("keeps a stopped or volumes-only lane a live worktree's .env names, and names the worktree", () => {
    const claims: EnvClaim[] = [...claimsFrom(second), { path: other, branch: "RP-1-other", project: "rabaed-lane43" }];
    const stale = staleProjects({ containers: stopped, volumes, cwd: second, currentProject: "rabaed-lane31", exists: (d) => d !== gone() });
    expect(stale.map((s) => s.project)).toEqual(["rabaed-lane32", "rabaed-lane33", "rabaed-lane43"]);
    const { prune, kept } = keptByClaims(stale, claims);
    expect(prune.map((s) => s.project)).toEqual(["rabaed-lane33"]);
    expect(kept).toEqual([
      { project: "rabaed-lane32", path: first, reason: "its .env names rabaed-lane32 (on RP-983-first), so the lane is still in use" },
      { project: "rabaed-lane43", path: other, reason: "its .env names rabaed-lane43 (on RP-1-other), so the lane is still in use" },
    ]);
  });

  it("with --merged, still keeps a stopped lane whose claimant is not merged", () => {
    const lanes = [
      { path: first, branch: "RP-983-first", merged: false, project: "rabaed-lane32" },
      { path: second, branch: "RP-992-second", merged: false, project: "rabaed-lane31" },
    ];
    expect(chooseMerged({ containers: stopped, volumes, worktrees: lanes, cwd: second, currentProject: "rabaed-lane31", holders: none }).merged).toEqual([]);
  });

  it("sees a worktree that names the lane after the list was made", () => {
    const listed = claimsFrom(second);
    expect(newClaimant("rabaed-lane32", listed, listed)).toBeUndefined();
    expect(newClaimant("rabaed-lane32", [], listed)).toEqual(listed[0]);
    expect(newClaimant("rabaed-lane33", [], listed)).toBeUndefined();
  });
});
