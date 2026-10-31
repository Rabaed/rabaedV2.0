import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseMerged,
  composeProjectOfEnv,
  databaseOfUrl,
  databasesInUse,
  databasesOfEnv,
  dropOrKeep,
  firstFreeLane,
  freeLaneClashes,
  freeLaneOrder,
  holderAdvice,
  isPortTaken,
  isValidDbSuffix,
  isValidLane,
  laneClashes,
  laneEnv,
  laneHolders,
  lanePorts,
  onlyLane,
  orphanDatabases,
  parseConnections,
  parseContainers,
  parseLaneEnvArgs,
  dbContainers,
  parseDropDbsArgs,
  parsePruneArgs,
  parseVolumes,
  chooseTakeover,
  clashesAfterRemoval,
  holdsLaneProject,
  postgresConnections,
  projectInUseNow,
  protectedLaneReason,
  pruneCommand,
  releaseContainers,
  removeProject,
  staleProjects,
  twinLane,
  VALID_LANES,
  type Container,
  type TakeoverWorktree,
  type WorktreeLane,
} from "./lanes.ts";
import type { Holders } from "./claude-sessions.ts";

/** Holders that hold nothing: no running and no desktop session. */
const none: Holders = { runningSession: () => undefined, desktopSession: () => undefined };

// `docker ps -a --format` lines as lanes.ts asks for them: name, state, compose project, working dir, ports.
const psLine = (name: string, state: string, project: string, dir: string, ports: string) => [name, state, project, dir, ports].join("\t");

const container = (c: Partial<Container> & Pick<Container, "name">): Container => ({ state: "running", project: "", workingDir: "", ports: [], ...c });

describe("lanePorts", () => {
  it.each([
    [0, { postgres: 5432, api: 4000, admin: 4050, web: 3000, mailpit: 8025, files: 9000 }],
    [3, { postgres: 5732, api: 4300, admin: 4350, web: 3300, mailpit: 8325, files: 9300 }],
    [10, { postgres: 5532, api: 4100, admin: 4150, web: 3100, mailpit: 8125, files: 9100 }],
    [11, { postgres: 5542, api: 4110, admin: 4160, web: 3110, mailpit: 8135, files: 9110 }],
    [14, { postgres: 5572, api: 4140, admin: 4190, web: 3140, mailpit: 8165, files: 9140 }],
    [32, { postgres: 5752, api: 4320, admin: 4370, web: 3320, mailpit: 8345, files: 9320 }],
    [54, { postgres: 5972, api: 4540, admin: 4590, web: 3540, mailpit: 8565, files: 9540 }],
  ])("lane %i", (n, ports) => {
    expect(lanePorts(n)).toEqual(ports);
  });

  it("gives lane m0 the ports of legacy lane m", () => {
    for (const m of [1, 2, 3, 4, 5]) expect(lanePorts(10 * m)).toEqual(lanePorts(m));
  });

  it("lets no two valid lanes share a port, legacy m and m0 aside", () => {
    const holder = new Map<number, number>();
    for (const n of VALID_LANES) {
      const key = n < 10 ? (twinLane(n) ?? n) : n;
      for (const port of Object.values(lanePorts(n))) {
        const held = holder.get(port);
        expect(held === undefined || held === key, `lane ${n} port ${port} is also lane ${held}'s`).toBe(true);
        holder.set(port, key);
      }
    }
  });
});

describe("isValidLane", () => {
  it("takes 0, the legacy 1–9 and mL for m 1–5, L 0–4", () => {
    expect(VALID_LANES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31, 32, 33, 34, 40, 41, 42, 43, 44, 50, 51, 52, 53, 54]);
  });

  it.each([15, 55, 60, 100, -1, 3.5, Number.NaN])("refuses %d", (n) => {
    expect(isValidLane(n)).toBe(false);
  });
});

describe("parseLaneEnvArgs", () => {
  it("reads the lane and options", () => {
    expect(parseLaneEnvArgs(["32", "--force", "--db", "rp602"])).toEqual({ lane: 32, force: true, free: false, db: "rp602" });
    expect(parseLaneEnvArgs(["--free"])).toEqual({ lane: 11, force: false, free: true, db: undefined });
    expect(parseLaneEnvArgs(["7"])).toEqual({ lane: 7, force: false, free: false, db: undefined });
  });

  it.each(["15", "55", "60", "100"])("refuses lane %s, naming the scheme", (n) => {
    const parsed = parseLaneEnvArgs([n]);
    expect("error" in parsed && parsed.error).toContain(`${n} is not a lane: lanes are 0 (the main folder), mL with m = Main 1–5`);
  });

  it("refuses unknown options and a bad --db suffix", () => {
    expect(parseLaneEnvArgs(["31", "--fast"])).toHaveProperty("error");
    expect(parseLaneEnvArgs(["31", "--db", "Bad"])).toHaveProperty("error");
    expect(parseLaneEnvArgs(["31", "32"])).toHaveProperty("error");
  });
});

describe("twinLane", () => {
  it("pairs legacy lane m with lane m0", () => {
    expect([1, 5, 10, 30, 50].map(twinLane)).toEqual([10, 50, 1, 3, 5]);
    expect([0, 6, 9, 11, 34].map(twinLane)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("parseContainers", () => {
  it("reads name, state, project, working dir and the host ports", () => {
    const out = [
      psLine("rabaed-lane2-db-1", "running", "rabaed-lane2", "G:\\rabaed-wt\\RP-193", "127.0.0.1:5632->5432/tcp"),
      psLine("rabaed-lane2-mailpit-1", "created", "rabaed-lane2", "G:\\rabaed-wt\\RP-193", ""),
      psLine("other", "running", "", "", "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 127.0.0.1:9001-9002->9001-9002/tcp"),
      "",
    ].join("\n");
    expect(parseContainers(out)).toEqual([
      { name: "rabaed-lane2-db-1", state: "running", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\RP-193", ports: [5632] },
      { name: "rabaed-lane2-mailpit-1", state: "created", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\RP-193", ports: [] },
      { name: "other", state: "running", project: "", workingDir: "", ports: [8080, 9001, 9002] },
    ]);
  });
});

describe("parseVolumes", () => {
  it("reads each volume's name and compose project", () => {
    expect(parseVolumes("rabaed-lane1_db-data\trabaed-lane1\nfcf053d9\t\n")).toEqual([
      { name: "rabaed-lane1_db-data", project: "rabaed-lane1" },
      { name: "fcf053d9", project: "" },
    ]);
  });
});

describe("laneClashes", () => {
  const here = "G:\\rabaed-wt\\RP-297";

  it("finds nothing when every port is free and no other worktree uses the project", () => {
    expect(laneClashes(2, { containers: [], takenPorts: new Set(), cwd: here })).toEqual([]);
  });

  it("names the container holding a lane port", () => {
    const containers = [container({ name: "rabaed-rp263-db-1", project: "rabaed-rp263", workingDir: "G:\\rabaed-wt\\RP-263", ports: [5732] })];
    expect(laneClashes(3, { containers, takenPorts: new Set([5732]), cwd: here })).toEqual([
      "Postgres port 5732 is held by container rabaed-rp263-db-1 (compose project rabaed-rp263, from G:\\rabaed-wt\\RP-263).",
    ]);
  });

  it("says another process holds a taken port no container publishes", () => {
    expect(laneClashes(1, { containers: [], takenPorts: new Set([3100]), cwd: here })).toEqual([
      "web port 3100 is held by another process (not a Docker container).",
    ]);
  });

  it("ignores ports held by this worktree's own containers, so the lane can be rewritten while it runs", () => {
    const containers = [container({ name: "rabaed-lane2-db-1", project: "rabaed-lane2", workingDir: "g:/rabaed-wt/rp-297/", ports: [5632] })];
    const own = laneClashes(2, { containers, takenPorts: new Set([5632]), cwd: here, platform: "win32" });
    expect(own).toEqual([]);
  });

  it("refuses the compose project when another worktree's containers use it, running or stopped", () => {
    const containers = [
      container({ name: "rabaed-lane2-db-1", state: "exited", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\RP-193", ports: [5632] }),
      container({ name: "rabaed-lane2-files-1", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\RP-193", ports: [9200] }),
    ];
    expect(laneClashes(2, { containers, takenPorts: new Set([9200]), cwd: here })).toEqual([
      "file store port 9200 is held by container rabaed-lane2-files-1 (compose project rabaed-lane2, from G:\\rabaed-wt\\RP-193).",
      "Compose project rabaed-lane2 already belongs to G:\\rabaed-wt\\RP-193 (it would share that worktree's database).",
    ]);
  });
});

describe("firstFreeLane", () => {
  it("returns the first lane from the start that has no clash", () => {
    const busy = new Set([2, 3]);
    expect(firstFreeLane(2, (n) => (busy.has(n) ? ["taken"] : []))).toBe(4);
  });

  it("wraps around, skips lane 0 and gives up when every lane clashes", () => {
    expect(firstFreeLane(8, (n) => (n === 1 ? [] : ["taken"]))).toBe(1);
    expect(firstFreeLane(1, () => ["taken"])).toBeUndefined();
  });

  it("starts at lane 1 when asked from lane 0, and still reaches lane 9 (never trying lane 7)", () => {
    const tried: number[] = [];
    expect(firstFreeLane(0, (n) => (tried.push(n), n === 9 ? [] : ["taken"]))).toBe(9);
    expect(tried).toEqual([1, 2, 3, 4, 5, 6, 8, 9]);
  });

  it("picks 32 from 31 when 31 is taken", () => {
    expect(firstFreeLane(31, (n) => (n === 31 ? ["taken"] : []))).toBe(32);
  });

  it("tries the same Main's lanes A–D first, wrapping round, then the other Mains', never an m0", () => {
    expect(freeLaneOrder(33)).toEqual([33, 34, 31, 32, 11, 12, 13, 14, 21, 22, 23, 24, 41, 42, 43, 44, 51, 52, 53, 54]);
    expect(freeLaneOrder(30).slice(0, 4)).toEqual([31, 32, 33, 34]);
    expect(firstFreeLane(31, (n) => (n >= 31 && n <= 34 ? ["taken"] : []))).toBe(11);
  });

  it("goes on to the lanes A–D once the legacy lanes 1–9 are all taken, never an m0 (RP-605)", () => {
    expect(freeLaneOrder(4)).toEqual([4, 5, 6, 8, 9, 1, 2, 3, 11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34, 41, 42, 43, 44, 51, 52, 53, 54]);
    expect(firstFreeLane(1, (n) => (n < 10 ? ["taken"] : []))).toBe(11);
  });

  it("starts a bare --free at lane 11, so it never hands out a legacy lane (RP-605)", () => {
    const parsed = parseLaneEnvArgs(["--free"]);
    expect("lane" in parsed && freeLaneOrder(parsed.lane).every((n) => n >= 11 && n % 10 !== 0)).toBe(true);
  });
});

describe("lane 7, Main 7's harness data (RP-1101)", () => {
  const here = "G:\\rabaed-wt\\RP-1101";

  it("is the one protected lane, with a reason naming Main 7", () => {
    expect(protectedLaneReason("rabaed-lane7")).toContain("Main 7");
    expect(protectedLaneReason("rabaed-lane71")).toBeUndefined();
    expect(protectedLaneReason("rabaed-lane42")).toBeUndefined();
    expect(protectedLaneReason(undefined)).toBeUndefined();
  });

  it("is never offered by lane:env --free, whatever lane it starts from", () => {
    for (const start of VALID_LANES) expect(freeLaneOrder(start)).not.toContain(7);
    expect(firstFreeLane(6, (n) => (n === 7 ? [] : ["taken"]))).toBeUndefined();
  });

  it("clashes for lane:env 7 --free even with nothing on it (only Main 7's volumes left), so --free moves on", () => {
    expect(freeLaneClashes(7, [])).toEqual([`${protectedLaneReason("rabaed-lane7")}.`]);
    expect(freeLaneClashes(7, ["Port 5532 is taken."])).toEqual(["Port 5532 is taken.", `${protectedLaneReason("rabaed-lane7")}.`]);
    expect(freeLaneClashes(42, [])).toEqual([]);
    expect(freeLaneClashes(42, ["Port 4420 is taken."])).toEqual(["Port 4420 is taken."]);
  });

  it("is never taken over by lane:env --force, even from a worktree that is gone", () => {
    const containers = [container({ name: "rabaed-lane7-db-1", state: "exited", project: "rabaed-lane7", workingDir: "G:\\rabaed-wt\\gone" })];
    const p = chooseTakeover(7, { containers, worktrees: [], cwd: here, holders: none, platform: "win32" });
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`lane:env --force refused: ${protectedLaneReason("rabaed-lane7")}.`]);
    // Nor from a merged, clean worktree whose .env names it.
    const merged: TakeoverWorktree = { path: "G:\\rabaed-wt\\RP-7", branch: "RP-7-x", merged: true, dirty: false, exists: true, project: "rabaed-lane7" };
    expect(chooseTakeover(7, { containers: [], worktrees: [merged], cwd: here, holders: none, platform: "win32" }).released).toEqual([]);
  });
});

describe("laneClashes between legacy lane m and lane m0", () => {
  const here = "G:\\rabaed-wt\\RP-602";

  it("refuses lane 30 while another worktree has rabaed-lane3's containers, even stopped", () => {
    const containers = [container({ name: "rabaed-lane3-db-1", state: "exited", project: "rabaed-lane3", workingDir: "G:\\rabaed-wt\\RP-500" })];
    expect(laneClashes(30, { containers, takenPorts: new Set(), cwd: here })).toEqual([
      "Compose project rabaed-lane3 (lane 3 has the same ports as lane 30) belongs to G:\\rabaed-wt\\RP-500.",
    ]);
    expect(laneHolders(30, { containers, cwd: here })).toEqual(["G:\\rabaed-wt\\RP-500"]);
  });

  it("lets this worktree move from lane 3 to lane 30", () => {
    const containers = [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: here, ports: [5732] })];
    expect(laneClashes(30, { containers, takenPorts: new Set([5732]), cwd: here })).toEqual([]);
  });

  it("lets a --db run share the twin lane's stack, as it shares the lane's own (RP-605)", () => {
    const containers = [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: "G:\\rabaed-wt\\main-3", ports: [5732] })];
    expect(laneClashes(30, { containers, takenPorts: new Set([5732]), cwd: here, ownDatabase: true })).toEqual([]);
    expect(laneHolders(30, { containers, cwd: here, ownDatabase: true })).toEqual([]);
  });

  it("advises pruning the twin lane a holder actually has (RP-605)", () => {
    const old = "G:/rabaed-wt/RP-500";
    const containers = [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: old })];
    const merged: WorktreeLane = { path: old, branch: "RP-500-x", merged: true, project: "rabaed-lane3" };
    const advice = (worktrees: WorktreeLane[]) => holderAdvice(30, [old], { worktrees, hasOriginMain: true, cwd: here, containers, platform: "win32" })[0];
    expect(advice([merged])).toContain("`pnpm lanes:prune --merged --lane 3`");
    expect(advice([])).toContain("`pnpm lanes:prune --lane 3`");
    // An unmerged worktree naming rabaed-lane3 keeps it from lanes:prune, so prune is not suggested.
    const claimant: WorktreeLane = { path: "G:/rabaed-wt/agent-1", branch: "worktree-agent-1", merged: false, project: "rabaed-lane3" };
    expect(advice([merged, claimant])).toContain("lanes:prune keeps rabaed-lane3");
  });

  it("lets --force take lane 30 over from a merged, clean worktree's rabaed-lane3 (RP-605)", () => {
    const old = "G:\\rabaed-wt\\RP-500";
    const containers = [
      container({ name: "rabaed-lane3-db-1", state: "exited", project: "rabaed-lane3", workingDir: old, ports: [] }),
      container({ name: "rabaed-lane5-db-1", project: "rabaed-lane5", workingDir: "G:\\rabaed-wt\\other", ports: [5932] }),
    ];
    const worktrees: TakeoverWorktree[] = [{ path: old, branch: "RP-500-x", merged: true, dirty: false, exists: true, project: "rabaed-lane3" }];
    const p = chooseTakeover(30, { containers, worktrees, cwd: here, holders: none, platform: "win32" });
    expect(p.takeOver.map((c) => c.name)).toEqual(["rabaed-lane3-db-1"]);
    expect(p.refused).toEqual([]);
    expect(holdsLaneProject(30, containers, old, "win32")).toBe(true);
    expect(clashesAfterRemoval(30, { containers, takenPorts: new Set(), cwd: here }, p.takeOver)).toEqual([]);
    // A running twin holds lane 30's ports; once its containers are removed they are free.
    const running = [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: old, ports: [5732] })];
    const busy = { containers: running, takenPorts: new Set([5732]), cwd: here };
    expect(laneClashes(30, busy)).toHaveLength(2);
    expect(clashesAfterRemoval(30, busy, running)).toEqual([]);
    // Not when an unmerged worktree has the twin's project in its .env.
    const sharer: TakeoverWorktree = { path: "G:\\rabaed-wt\\agent-2", branch: "worktree-agent-2", merged: false, dirty: false, exists: true, project: "rabaed-lane3" };
    expect(chooseTakeover(30, { containers, worktrees: [...worktrees, sharer], cwd: here, holders: none, platform: "win32" }).refused).toEqual([
      "G:\\rabaed-wt\\agent-2 is on worktree-agent-2, not merged into origin/main yet, and has rabaed-lane3 in its .env.",
    ]);
  });
});

describe("staleProjects", () => {
  const exists = (dir: string) => dir !== "G:\\rabaed-wt\\gone";
  const base = { cwd: "G:\\rabaed-wt\\RP-297", currentProject: "rabaed-lane4", exists };

  it("picks rabaed-* projects whose worktree is gone or that are not running, with their volumes", () => {
    const containers = [
      container({ name: "rabaed-rp236-db-1", state: "exited", project: "rabaed-rp236", workingDir: "G:\\rabaed-wt\\RP-236" }),
      container({ name: "rabaed-rp270-db-1", project: "rabaed-rp270", workingDir: "G:\\rabaed-wt\\gone" }),
      container({ name: "rabaed-rp263-db-1", project: "rabaed-rp263", workingDir: "G:\\rabaed-wt\\RP-263" }),
      container({ name: "postgres", state: "exited", project: "someone-else", workingDir: "G:\\gone" }),
    ];
    const volumes = [
      { name: "rabaed-rp236_db-data", project: "rabaed-rp236" },
      { name: "rabaed-rp263_db-data", project: "rabaed-rp263" },
      { name: "rabaed-lane7_db-data", project: "rabaed-lane7" },
    ];
    expect(staleProjects({ ...base, containers, volumes })).toEqual([
      { project: "rabaed-lane7", reason: "no containers, only volumes", containers: [], volumes: ["rabaed-lane7_db-data"] },
      { project: "rabaed-rp236", reason: "not running", containers: ["rabaed-rp236-db-1"], volumes: ["rabaed-rp236_db-data"] },
      { project: "rabaed-rp270", reason: "worktree gone (G:\\rabaed-wt\\gone)", containers: ["rabaed-rp270-db-1"], volumes: [] },
    ]);
  });

  it("never picks the current worktree's project, by working dir or by its .env project name", () => {
    const containers = [
      container({ name: "rabaed-lane2-db-1", state: "exited", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\RP-297" }),
      container({ name: "rabaed-lane2-files-1", state: "exited", project: "rabaed-lane2", workingDir: "G:\\rabaed-wt\\gone" }),
      container({ name: "rabaed-lane4-db-1", state: "exited", project: "rabaed-lane4", workingDir: "G:\\rabaed-wt\\gone" }),
    ];
    const volumes = [{ name: "rabaed-lane4_db-data", project: "rabaed-lane4" }];
    expect(staleProjects({ ...base, containers, volumes })).toEqual([]);
  });

  it("keeps a running project while any of its worktrees exists", () => {
    const containers = [
      container({ name: "rabaed-lane9-db-1", project: "rabaed-lane9", workingDir: "G:\\rabaed-wt\\RP-231" }),
      container({ name: "rabaed-lane9-files-1", state: "exited", project: "rabaed-lane9", workingDir: "G:\\rabaed-wt\\gone" }),
    ];
    expect(staleProjects({ ...base, containers, volumes: [] })).toEqual([]);
  });
});

describe("isPortTaken", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it("is true while something listens on the port and false once it stops", async () => {
    server = createServer();
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const { port } = server.address() as { port: number };
    expect(await isPortTaken(port)).toBe(true);
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    expect(await isPortTaken(port)).toBe(false);
  });
});

describe("laneEnv", () => {
  const example = [
    "COMPOSE_PROJECT_NAME=rabaed",
    "POSTGRES_PORT=5432",
    "PORT=3000",
    "API_PORT=4000",
    "ADMIN_PORT=4050",
    "WEB_URL=http://localhost:3000",
    "MAILPIT_PORT=8025",
    "FILE_STORE_PORT=9000",
    "FILE_STORE_ENDPOINT=http://127.0.0.1:9000",
    "MAIL_CATCHER_URL=http://127.0.0.1:8025",
    "API_URL=http://127.0.0.1:4000",
    "DATABASE_SUPERUSER_URL=postgres://postgres:local-dev-only@localhost:5432/postgres",
    "DATABASE_MIGRATOR_URL=postgres://rabaed_migrator:local-dev-only@localhost:5432/rabaed",
    "DATABASE_APP_URL=postgres://rabaed_app:local-dev-only@localhost:5432/rabaed",
    "DATABASE_ADMIN_URL=postgres://rabaed_admin:local-dev-only@localhost:5432/rabaed",
    "MAIL_FROM=no-reply@rabaed.test",
    "",
  ].join("\n");

  it("without a database suffix writes the lane's ports and project and leaves the database URLs alone", () => {
    expect(laneEnv(example, 3)).toBe(
      [
        "COMPOSE_PROJECT_NAME=rabaed-lane3",
        "POSTGRES_PORT=5732",
        "PORT=3300",
        "API_PORT=4300",
        "ADMIN_PORT=4350",
        "WEB_URL=http://lane3.localhost:3300",
        "MAILPIT_PORT=8325",
        "FILE_STORE_PORT=9300",
        "FILE_STORE_ENDPOINT=http://127.0.0.1:9300",
        "MAIL_CATCHER_URL=http://127.0.0.1:8325",
        "API_URL=http://127.0.0.1:4300",
        "DATABASE_SUPERUSER_URL=postgres://postgres:local-dev-only@localhost:5732/postgres",
        "DATABASE_MIGRATOR_URL=postgres://rabaed_migrator:local-dev-only@localhost:5732/rabaed",
        "DATABASE_APP_URL=postgres://rabaed_app:local-dev-only@localhost:5732/rabaed",
        "DATABASE_ADMIN_URL=postgres://rabaed_admin:local-dev-only@localhost:5732/rabaed",
        "MAIL_FROM=no-reply@rabaed.test",
        "",
      ].join("\n"),
    );
  });

  it("with a suffix points the migrator, app and admin URLs at rabaed_<suffix> and nothing else", () => {
    const env = laneEnv(example, 4, "rp322");
    expect(env).toContain("DATABASE_MIGRATOR_URL=postgres://rabaed_migrator:local-dev-only@localhost:5832/rabaed_rp322\n");
    expect(env).toContain("DATABASE_APP_URL=postgres://rabaed_app:local-dev-only@localhost:5832/rabaed_rp322\n");
    expect(env).toContain("DATABASE_ADMIN_URL=postgres://rabaed_admin:local-dev-only@localhost:5832/rabaed_rp322\n");
    expect(env).toContain("DATABASE_SUPERUSER_URL=postgres://postgres:local-dev-only@localhost:5832/postgres\n");
    expect(env).toContain("COMPOSE_PROJECT_NAME=rabaed-lane4\n");
    expect(env).toBe(laneEnv(example, 4).replace(/\/rabaed$/gm, "/rabaed_rp322"));
  });

  it("works on the real .env.example: only the three database names differ with a suffix", () => {
    const real = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    const plain = laneEnv(real, 2).split("\n");
    const changed = laneEnv(real, 2, "rp9")
      .split("\n")
      .filter((line, i) => line !== plain[i]);
    expect(changed.map((l) => l.split("=")[0])).toEqual(["DATABASE_MIGRATOR_URL", "DATABASE_APP_URL", "DATABASE_ADMIN_URL"]);
    expect(changed.every((l) => l.endsWith("/rabaed_rp9"))).toBe(true);
  });
});

describe("isValidDbSuffix", () => {
  it("takes lowercase letters and digits starting with a letter, never test", () => {
    expect(["rp322", "a", "rp322b"].every(isValidDbSuffix)).toBe(true);
    for (const bad of [undefined, "", "322", "RP322", "rp-322", "rp_322", "a;drop", "test"]) expect(isValidDbSuffix(bad)).toBe(false);
  });
});

describe("laneClashes with a shared lane (lane:env --db)", () => {
  const here = "G:\\rabaed-wt\\RP-322";
  const other = container({ name: "rabaed-lane4-db-1", project: "rabaed-lane4", workingDir: "G:\\Rabaed Contech\\.claude\\worktrees\\RP-299", ports: [5832] });

  it("refuses without --db: the lane's Postgres and project belong to another worktree", () => {
    expect(laneClashes(4, { containers: [other], takenPorts: new Set([5832]), cwd: here })).toHaveLength(2);
  });

  it("allows it with --db: sharing the lane's compose project is the point", () => {
    expect(laneClashes(4, { containers: [other], takenPorts: new Set([5832]), cwd: here, ownDatabase: true })).toEqual([]);
  });

  it("still refuses a lane port held by something outside the lane's compose project", () => {
    const stranger = container({ name: "rabaed-rp263-db-1", project: "rabaed-rp263", workingDir: "G:\\rabaed-wt\\RP-263", ports: [5832] });
    expect(laneClashes(4, { containers: [stranger], takenPorts: new Set([5832]), cwd: here, ownDatabase: true })).toHaveLength(1);
    expect(laneClashes(4, { containers: [], takenPorts: new Set([4400]), cwd: here, ownDatabase: true })).toEqual(["api port 4400 is held by another process (not a Docker container)."]);
  });
});

describe("orphanDatabases", () => {
  it("lists the suffixed databases no worktree names, and never the shared ones", () => {
    const names = ["rabaed", "rabaed_test", "rabaed_rp322", "rabaed_rp322_test", "rabaed_rp323", "rabaed_rp323_test", "rabaed_rp324_test", "rabaed_test_rds_master", "postgres"];
    expect(orphanDatabases(names, new Set(["rabaed_rp322", "rabaed"]))).toEqual(["rabaed_rp323", "rabaed_rp323_test", "rabaed_rp324_test"]);
  });

  it("lists the reset test's scratch database of a gone worktree, not a live one's, and never rabaed_test_reset", () => {
    const names = ["rabaed_rp1", "rabaed_rp1_test_reset", "rabaed_rp9_test_reset", "rabaed_test_reset"];
    expect(orphanDatabases(names, new Set(["rabaed_rp1"]))).toEqual(["rabaed_rp9_test_reset"]);
  });

  it("finds nothing when every worktree still exists", () => {
    expect(orphanDatabases(["rabaed_rp1", "rabaed_rp1_test"], new Set(["rabaed_rp1"]))).toEqual([]);
  });
});

describe("databasesOfEnv", () => {
  it("reads the migrator, app and admin URLs' databases, quoted or not, and nothing else", () => {
    const env = [
      "DATABASE_SUPERUSER_URL=postgres://postgres:x@localhost:5832/postgres",
      "DATABASE_MIGRATOR_URL=postgres://rabaed_migrator:x@localhost:5832/rabaed_rp322",
      `DATABASE_APP_URL="postgres://rabaed_app:x@localhost:5832/rabaed_rp322"`,
      "DATABASE_ADMIN_URL='postgres://rabaed_admin:x@localhost:5832/rabaed_rp322?sslmode=disable'  ",
      "# DATABASE_APP_URL=postgres://rabaed_app:x@localhost:5832/rabaed_old",
      "DATABASE_APP_URL_EXTRA=postgres://u:p@h/rabaed_other",
    ].join("\r\n");
    expect(databasesOfEnv(env)).toEqual(["rabaed_rp322", "rabaed_rp322", "rabaed_rp322"]);
  });
});

describe("databasesInUse", () => {
  it("collects the databases of every worktree that has an .env", () => {
    const envs: Record<string, string> = {
      "G:/a": "DATABASE_APP_URL=postgres://u:p@h:5832/rabaed_rp1\n",
      "G:/b": "DATABASE_MIGRATOR_URL=postgres://u:p@h:5832/rabaed\n",
    };
    expect(databasesInUse(["G:/a", "G:/b", "G:/no-env"], (dir) => envs[dir])).toEqual(new Set(["rabaed_rp1", "rabaed"]));
  });
});

describe("dropOrKeep", () => {
  it("keeps an orphan with an open connection (another clone's worktree, a test run) and drops the rest", () => {
    const connections = parseConnections(["rabaed_rp9_test|2", "rabaed_rp7|1", ""].filter((l) => l !== ""));
    expect(dropOrKeep(["rabaed_rp7", "rabaed_rp8", "rabaed_rp8_test", "rabaed_rp9_test"], connections)).toEqual({
      drop: ["rabaed_rp8", "rabaed_rp8_test"],
      busy: [
        { name: "rabaed_rp7", connections: 1 },
        { name: "rabaed_rp9_test", connections: 2 },
      ],
    });
  });
});

describe("chooseMerged (lanes:prune --merged)", () => {
  const cwd = "G:\\rabaed-wt\\current";
  const wt = (path: string, branch: string, merged: boolean, project?: string): WorktreeLane => ({ path: path.replace(/\\/g, "/"), branch, merged, project });
  const worktrees = [
    wt("G:\\rabaed-wt\\current", "RP-400-now", false, "rabaed-lane1"),
    wt("G:\\rabaed-wt\\RP-362", "RP-362-views", true, "rabaed-lane3"),
    wt("G:\\rabaed-wt\\RP-363", "RP-363-dashboard", false, "rabaed-lane4"),
    wt("G:\\rabaed-wt\\RP-322", "RP-322-spec", true, "rabaed-lane5"),
    wt("G:\\rabaed-wt\\agent-1", "worktree-agent-1", false, "rabaed-lane5"),
  ];
  const containers = [
    container({ name: "rabaed-lane1-db-1", project: "rabaed-lane1", workingDir: "G:\\rabaed-wt\\current" }),
    container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: "G:\\rabaed-wt\\RP-362" }),
    container({ name: "rabaed-lane4-db-1", project: "rabaed-lane4", workingDir: "G:\\rabaed-wt\\RP-363" }),
    container({ name: "rabaed-lane5-db-1", project: "rabaed-lane5", workingDir: "G:\\rabaed-wt\\RP-322" }),
  ];
  const volumes = [{ name: "rabaed-lane3_db-data", project: "rabaed-lane3" }];

  it("picks a project whose worktrees are all merged, and keeps one that an unmerged worktree's .env names", () => {
    expect(chooseMerged({ containers, volumes, worktrees, cwd, currentProject: "rabaed-lane1", holders: none, platform: "win32" }).merged).toEqual([
      {
        project: "rabaed-lane3",
        reason: "branch merged into origin/main (RP-362-views at G:/rabaed-wt/RP-362)",
        containers: ["rabaed-lane3-db-1"],
        volumes: ["rabaed-lane3_db-data"],
      },
    ]);
  });

  it("never picks the current worktree's project, even when its branch is merged", () => {
    const merged = worktrees.map((w) => ({ ...w, merged: true }));
    const picked = chooseMerged({ containers, volumes, worktrees: merged, cwd, currentProject: "rabaed-lane1", holders: none, platform: "win32" }).merged.map((p) => p.project);
    expect(picked).toEqual(["rabaed-lane3", "rabaed-lane4", "rabaed-lane5"]);
  });

  it("keeps a merged project whose holder's Claude desktop session is open, and says why (RP-612)", () => {
    const held = "G:/rabaed-wt/RP-362";
    const holders: Holders = { ...none, desktopSession: (path) => (path === held ? { kind: "open", session: 'session "RP-628 snag detail"' } : undefined) };
    const merged = worktrees.map((w) => ({ ...w, merged: true }));
    const { merged: picked, kept } = chooseMerged({ containers, volumes, worktrees: merged, cwd, currentProject: "rabaed-lane1", holders, platform: "win32" });
    expect(picked.map((p) => p.project)).toEqual(["rabaed-lane4", "rabaed-lane5"]);
    expect(kept).toEqual([{ project: "rabaed-lane3", path: held, reason: 'its Claude desktop session is open (session "RP-628 snag detail"); archive it first' }]);
  });

  it("keeps a merged project a running Claude session works in, and names it before a desktop session (RP-956)", () => {
    const held = "G:/rabaed-wt/RP-362";
    const running = 'a running Claude session is in it: session "Main 3" (pid 35408)';
    const holders: Holders = { runningSession: (path) => (path === held ? running : undefined), desktopSession: () => ({ kind: "open", session: 'session "x"' }) };
    const { merged, kept } = chooseMerged({ containers, volumes, worktrees, cwd, currentProject: "rabaed-lane1", holders, platform: "win32" });
    expect(merged).toEqual([]);
    expect(kept).toEqual([{ project: "rabaed-lane3", path: held, reason: running }]);
  });

  it("keeps every merged project when the sessions cannot be checked, and lists only projects that were merged (RP-612, RP-956)", () => {
    const unknown: Holders = { ...none, desktopSession: () => ({ kind: "unknown", reason: "Claude desktop's worktree list could not be read" }) };
    const unchecked: Holders = { ...none, runningSession: () => "running Claude sessions could not be checked: the process list could not be read" };
    // rabaed-lane4 (not merged) and rabaed-lane5 (an unmerged worktree names it) are never listed as kept.
    expect(chooseMerged({ containers, volumes, worktrees, cwd, currentProject: "rabaed-lane1", holders: unknown, platform: "win32" })).toEqual({
      merged: [],
      kept: [{ project: "rabaed-lane3", path: "G:/rabaed-wt/RP-362", reason: "a Claude desktop session may hold it: Claude desktop's worktree list could not be read" }],
    });
    expect(chooseMerged({ containers, volumes, worktrees, cwd, currentProject: "rabaed-lane1", holders: unchecked, platform: "win32" }).kept).toEqual([
      { project: "rabaed-lane3", path: "G:/rabaed-wt/RP-362", reason: "running Claude sessions could not be checked: the process list could not be read" },
    ]);
  });

  it("keeps a project with a container from a folder that is not a worktree of this clone", () => {
    const other = [container({ name: "rabaed-lane6-db-1", project: "rabaed-lane6", workingDir: "D:\\other-clone\\wt" })];
    expect(chooseMerged({ containers: other, volumes: [], worktrees, cwd, currentProject: undefined, holders: none, platform: "win32" }).merged).toEqual([]);
  });
});

describe("projectInUseNow (lanes:prune and worktrees:prune, just before each removal, RP-1073)", () => {
  const gone = "G:\\rabaed-wt\\hopeful-chaum";
  const live = "G:\\rabaed-wt\\rp-921";
  // A Windows disk: any case names the same folder.
  const exists = (dir: string) => dir.toLowerCase() === live.toLowerCase();
  const listedContainers = [container({ name: "rabaed-lane12-files-1", project: "rabaed-lane12", workingDir: gone })];
  const check = (now: Partial<Parameters<typeof projectInUseNow>[1]["now"]>, more: { listedContainers?: Container[] } = {}) =>
    projectInUseNow("rabaed-lane12", {
      listedClaims: [],
      listedContainers: more.listedContainers ?? listedContainers,
      now: { claims: [], containers: listedContainers, postgres: undefined, ...now },
      exists,
      platform: "win32",
    });

  it("lets the project go when nothing changed", () => {
    expect(check({})).toBeUndefined();
  });

  it("keeps it when a worktree's .env names it now, but not for a claim already listed or on another project", () => {
    const claim = { path: live, branch: "RP-921-x", project: "rabaed-lane12" };
    expect(check({ claims: [claim] })).toBe(`the .env of ${live} (on RP-921-x) holds it now`);
    expect(check({ claims: [{ ...claim, project: "rabaed-lane13" }] })).toBeUndefined();
    expect(projectInUseNow("rabaed-lane12", { listedClaims: [claim], listedContainers, now: { claims: [claim], containers: listedContainers, postgres: undefined }, exists })).toBeUndefined();
  });

  it("keeps it when a container of it runs now from a folder that exists and did not run it at listing", () => {
    const started = container({ name: "rabaed-lane12-db-1", project: "rabaed-lane12", workingDir: live.toUpperCase() });
    expect(check({ containers: [...listedContainers, started] })).toBe(`a container of it runs from ${live.toUpperCase()} now (rabaed-lane12-db-1)`);
    // The same container, running from the same folder at listing: nothing new.
    expect(check({ containers: [started] }, { listedContainers: [started] })).toBeUndefined();
    // Started from a folder that is gone, or stopped, or another project's: nothing in use.
    expect(check({ containers: [{ ...started, workingDir: gone }] })).toBeUndefined();
    expect(check({ containers: [{ ...started, state: "exited" }] })).toBeUndefined();
    expect(check({ containers: [{ ...started, project: "rabaed-lane13" }] })).toBeUndefined();
  });

  it("keeps it when another container of it starts from a folder one of its containers already ran from at listing", () => {
    const files = container({ name: "rabaed-lane12-files-1", project: "rabaed-lane12", workingDir: live });
    const db = container({ name: "rabaed-lane12-db-1", project: "rabaed-lane12", workingDir: live });
    expect(check({ containers: [files, db] }, { listedContainers: [files, { ...db, state: "exited" }] })).toBe(`a container of it runs from ${live} now (rabaed-lane12-db-1)`);
  });

  it("keeps it when Docker does not answer: its containers cannot be checked", () => {
    expect(check({ containers: undefined })).toBe("Docker did not answer when it was checked again");
  });

  it("keeps it while something is connected to its Postgres, saying what to stop", () => {
    const db = "rabaed-lane12-db-1";
    const stop = "stop what uses it (`pnpm servers:stop --yes` in its worktree) and re-run";
    expect(check({ postgres: { container: db, connections: { count: 2 } } })).toBe(`2 connections to its Postgres (${db}) now; ${stop}`);
    expect(check({ postgres: { container: db, connections: { count: 1 } } })).toBe(`1 connection to its Postgres (${db}) now; ${stop}`);
    expect(check({ postgres: { container: db, connections: { count: 0 } } })).toBeUndefined();
  });

  it("keeps it when its Postgres cannot be asked, saying how to free a stuck lane", () => {
    expect(check({ postgres: { container: "rabaed-lane12-db-1", connections: { unanswered: "timed out" } } })).toBe(
      "its Postgres (rabaed-lane12-db-1) could not be asked who is connected (timed out); `docker stop rabaed-lane12-db-1` and re-run if the lane is unused",
    );
  });

  it("names a new .env claim before anything else", () => {
    const claim = { path: live, branch: "RP-921-x", project: "rabaed-lane12" };
    expect(check({ claims: [claim], containers: undefined })).toBe(`the .env of ${live} (on RP-921-x) holds it now`);
  });
});

describe("postgresConnections (RP-1073)", () => {
  it("counts the connections to the lane databases, leaving out the asking one", () => {
    let asked = "";
    const run = (_container: string, sql: string) => {
      asked = sql;
      return ["3"];
    };
    expect(postgresConnections("rabaed-lane12-db-1", run)).toEqual({ count: 3 });
    expect(asked).toContain("datname like 'rabaed%'");
    expect(asked).toContain("pid <> pg_backend_pid()");
    expect(asked).toContain("backend_type = 'client backend'");
  });

  it("says why when Postgres does not answer, or answers something else", () => {
    const fails = () => {
      throw Object.assign(new Error("spawnSync docker ETIMEDOUT"), { stderr: "" });
    };
    expect(postgresConnections("x", fails)).toEqual({ unanswered: "spawnSync docker ETIMEDOUT" });
    const refused = () => {
      throw Object.assign(new Error("Command failed"), { stderr: "psql: error: connection refused\n" });
    };
    expect(postgresConnections("x", refused)).toEqual({ unanswered: "psql: error: connection refused" });
    expect(postgresConnections("x", () => [])).toEqual({ unanswered: 'psql answered ""' });
  });
});

describe("onlyLane (lanes:prune --lane N)", () => {
  const prunable = ["rabaed-lane1", "rabaed-lane3", "rabaed-lane4"].map((project) => ({ project, reason: "not running", containers: [], volumes: [] }));

  it("with three prunable projects, --lane 3 selects only rabaed-lane3", () => {
    expect(onlyLane(prunable, 3).map((p) => p.project)).toEqual(["rabaed-lane3"]);
  });

  it("selects nothing when the lane is not among them, and everything without --lane", () => {
    expect(onlyLane(prunable, 2)).toEqual([]);
    expect(onlyLane(prunable, undefined)).toEqual(prunable);
  });
});

describe("pruneCommand", () => {
  it("names the targeted command for a lane, so the suggestion never reaches other lanes", () => {
    expect(pruneCommand(3, { merged: true })).toBe("pnpm lanes:prune --merged --lane 3");
    expect(pruneCommand(3, { merged: false })).toBe("pnpm lanes:prune --lane 3");
  });
});

describe("laneHolders", () => {
  const cwd = "G:\\rabaed-wt\\current";
  const containers = [
    container({ name: "rabaed-lane5-db-1", project: "rabaed-lane5", workingDir: "G:\\rabaed-wt\\RP-322", ports: [5932] }),
    container({ name: "rabaed-rp1-web", project: "rabaed-rp1", workingDir: "G:\\rabaed-wt\\RP-1", ports: [3500] }),
    container({ name: "rabaed-lane5-files-1", project: "rabaed-lane5", workingDir: "G:\\rabaed-wt\\current", ports: [9500] }),
  ];

  it("names the other worktrees holding the lane's compose project or ports", () => {
    expect(laneHolders(5, { containers, cwd, platform: "win32" })).toEqual(["G:\\rabaed-wt\\RP-322", "G:\\rabaed-wt\\RP-1"]);
  });

  it("does not count the lane's own compose project for lane:env --db, which shares it", () => {
    expect(laneHolders(5, { containers, cwd, platform: "win32", ownDatabase: true })).toEqual(["G:\\rabaed-wt\\RP-1"]);
  });
});

describe("holderAdvice (lane:env's line per holder)", () => {
  const cwd = "G:/rabaed-wt/current";
  const wt = (path: string, branch: string, merged: boolean, project?: string): WorktreeLane => ({ path, branch, merged, project });
  const holder = wt("G:/rabaed-wt/RP-362", "RP-362-views", true, "rabaed-lane3");
  const input = (worktrees: WorktreeLane[]) => ({ worktrees, hasOriginMain: true, cwd, containers: [], platform: "win32" as const });

  it("suggests lanes:prune --merged --lane N for a merged holder when no unmerged worktree names the lane", () => {
    expect(holderAdvice(3, [holder.path], input([holder]))[0]).toContain("pnpm lanes:prune --merged --lane 3");
  });

  it("does not suggest prune when an unmerged worktree names the lane in its .env (prune keeps it), and names that worktree", () => {
    const claimant = wt("G:/rabaed-wt/agent-1", "worktree-agent-1", false, "rabaed-lane3");
    const worktrees = [holder, claimant];
    // The same keep rule as lanes:prune --merged: it would free nothing here.
    expect(chooseMerged({ containers: [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: holder.path })], volumes: [], worktrees, cwd, currentProject: undefined, holders: none, platform: "win32" }).merged).toEqual([]);
    const [line] = holderAdvice(3, [holder.path], input(worktrees));
    expect(line).not.toContain("lanes:prune --merged");
    expect(line).toContain("G:/rabaed-wt/agent-1");
    expect(line).toContain("free lane");
  });

  it("says --force takes the lane over when this worktree's own .env is the one naming it", () => {
    const [line] = holderAdvice(3, [holder.path], input([holder, wt(cwd, "RP-434-now", false, "rabaed-lane3")]));
    expect(line).not.toContain("lanes:prune --merged");
    expect(line).toContain("pnpm lane:env 3 --force");
  });

  it("says whether a holder on a detached HEAD is merged, like one on a branch (RP-601)", () => {
    const detached: WorktreeLane = { ...holder, branch: undefined };
    expect(holderAdvice(3, [detached.path], input([detached]))[0]).toBe(
      "  G:/rabaed-wt/RP-362 is on a detached HEAD, already merged into origin/main: free the lane with `pnpm lanes:prune --merged --lane 3`, then re-run.",
    );
    expect(holderAdvice(3, [detached.path], input([{ ...detached, merged: false }]))[0]).toContain("is on a detached HEAD, not merged into origin/main yet");
  });

  it("keeps the other lines: unmerged holder, gone holder, no origin/main", () => {
    const open = wt("G:/rabaed-wt/RP-363", "RP-363-dashboard", false, "rabaed-lane3");
    expect(holderAdvice(3, [open.path], input([open]))[0]).toContain("not merged into origin/main yet");
    expect(holderAdvice(3, ["G:/gone"], input([]))[0]).toContain("pnpm lanes:prune --lane 3");
    expect(holderAdvice(3, [holder.path], { ...input([holder]), hasOriginMain: false })[0]).toContain("git fetch origin main");
  });
});

describe("chooseTakeover (lane:env --force, RP-500)", () => {
  const cwd = "G:\\rabaed-wt\\current";
  const old = "G:\\rabaed-wt\\RP-448";
  const containers = [
    container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: old, ports: [5732] }),
    container({ name: "rabaed-lane3-files-1", project: "rabaed-lane3", workingDir: old, ports: [9300] }),
    container({ name: "rabaed-lane4-db-1", project: "rabaed-lane4", workingDir: "G:\\rabaed-wt\\other", ports: [5832] }),
  ];
  const wt = (w: Partial<TakeoverWorktree>): TakeoverWorktree => ({ path: old, branch: "RP-448-workflow-core", merged: true, dirty: false, exists: true, ...w });
  const choice = (worktrees: TakeoverWorktree[], lane = 3) => chooseTakeover(lane, { containers, worktrees, cwd, holders: none, platform: "win32" });

  it("takes the project over from a merged, clean worktree and says where it came from", () => {
    const p = choice([wt({})]);
    expect(p.takeOver.map((c) => c.name)).toEqual(["rabaed-lane3-db-1", "rabaed-lane3-files-1"]);
    expect(p.from).toEqual([`${old} (RP-448-workflow-core, merged into origin/main)`]);
    expect(p.refused).toEqual([]);
  });

  it("takes the project over from a finished worktree never committed to, and says why it counts (RP-585)", () => {
    const p = choice([wt({ branch: "RP-555-review-fixes", neverCommitted: true })]);
    expect(p.takeOver).toHaveLength(2);
    expect(p.from).toEqual([`${old} (RP-555-review-fixes, never committed to: its tip is in origin/main, it is clean and unlocked, and no process holds it)`]);
  });

  it("refuses a worktree with uncommitted changes", () => {
    const p = choice([wt({ dirty: true })]);
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`${old} is on RP-448-workflow-core and has uncommitted changes.`]);
  });

  it("refuses, naming the session, a worktree a running Claude session is in, merged or not (RP-956)", () => {
    const running = 'a running Claude session is in it: session "Main 4" (pid 35760)';
    const holders: Holders = { ...none, runningSession: (path) => (path === old ? running : undefined) };
    const p = chooseTakeover(3, { containers, worktrees: [wt({ merged: false })], cwd, holders, platform: "win32" });
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`${old} is on RP-448-workflow-core and ${running}.`]);
  });

  it("refuses every holder when the running sessions cannot be checked (RP-956)", () => {
    const why = "running Claude sessions could not be checked: the process list could not be read";
    const p = chooseTakeover(3, { containers, worktrees: [wt({})], cwd, holders: { ...none, runningSession: () => why }, platform: "win32" });
    expect(p.refused).toEqual([`${old} is on RP-448-workflow-core and ${why}.`]);
  });

  it("refuses a merged, clean worktree whose Claude desktop session is open, naming the session (RP-612)", () => {
    const holders: Holders = { ...none, desktopSession: (path) => (path === old ? { kind: "open", session: 'session "RP-628 snag detail"' } : undefined) };
    const p = chooseTakeover(3, { containers, worktrees: [wt({})], cwd, holders, platform: "win32" });
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`${old} is on RP-448-workflow-core and its Claude desktop session is open (session "RP-628 snag detail"); archive it first.`]);
  });

  it("refuses when the desktop sessions cannot be checked, and takes over when no session holds the worktree (RP-612)", () => {
    const unknown: Holders = { ...none, desktopSession: () => ({ kind: "unknown", reason: "Claude desktop's worktree list could not be read" }) };
    expect(chooseTakeover(3, { containers, worktrees: [wt({})], cwd, holders: unknown, platform: "win32" }).refused).toEqual([
      `${old} is on RP-448-workflow-core and a Claude desktop session may hold it: Claude desktop's worktree list could not be read.`,
    ]);
    expect(chooseTakeover(3, { containers, worktrees: [wt({})], cwd, holders: none, platform: "win32" }).takeOver).toHaveLength(2);
  });

  it("does not count a session in this worktree, which is never taken over from (RP-956)", () => {
    const holders: Holders = { ...none, runningSession: (path) => (path === cwd ? "a running Claude session is in it: mine" : undefined) };
    expect(chooseTakeover(3, { containers, worktrees: [wt({}), wt({ path: cwd })], cwd, holders, platform: "win32" }).takeOver).toHaveLength(2);
  });

  it("refuses a worktree that is not merged", () => {
    const p = choice([wt({ merged: false })]);
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`${old} is on RP-448-workflow-core, not merged into origin/main yet.`]);
  });

  it("takes the project over from a clean worktree on a detached HEAD already in origin/main (RP-601)", () => {
    const p = choice([wt({ branch: undefined, merged: true })]);
    expect(p.takeOver.map((c) => c.name)).toEqual(["rabaed-lane3-db-1", "rabaed-lane3-files-1"]);
    expect(p.from).toEqual([`${old} (a detached HEAD, merged into origin/main)`]);
    expect(p.refused).toEqual([]);
  });

  it("refuses a detached HEAD that is not in origin/main, or has uncommitted changes, or a live lock (RP-601)", () => {
    const unmerged = choice([wt({ branch: undefined, merged: false })]);
    expect(unmerged.takeOver).toEqual([]);
    expect(unmerged.refused).toEqual([`${old} is on a detached HEAD, not merged into origin/main yet.`]);
    expect(choice([wt({ branch: undefined, dirty: true })]).refused).toEqual([`${old} is on a detached HEAD and has uncommitted changes.`]);
    const locked = chooseTakeover(3, { containers, worktrees: [wt({ branch: undefined, locked: "claude agent x (pid 7)" })], cwd, pidRunning: (pid) => pid === 7, holders: none, platform: "win32" });
    expect(locked.refused).toEqual([`${old} is locked by a session that is still running (pid 7).`]);
  });

  it("takes over from a worktree that is gone, and refuses a folder that is not a worktree of this clone", () => {
    expect(choice([wt({ exists: false })]).takeOver).toHaveLength(2);
    expect(choice([]).takeOver).toHaveLength(2);
    const there = chooseTakeover(3, { containers, worktrees: [], cwd, holders: none, platform: "win32", exists: () => true });
    expect(there.takeOver).toEqual([]);
    expect(there.refused).toEqual([`${old} is not a worktree of this clone.`]);
  });

  it("takes nothing when any holder is refused", () => {
    const mixed = [...containers, container({ name: "rabaed-lane3-web", project: "rabaed-lane3", workingDir: "G:\\rabaed-wt\\busy" })];
    const p = chooseTakeover(3, { containers: mixed, worktrees: [wt({}), wt({ path: "G:\\rabaed-wt\\busy", merged: false })], cwd, holders: none, platform: "win32" });
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toHaveLength(1);
  });

  it("leaves the current worktree's and other lanes' containers alone", () => {
    const lane4 = choice([wt({}), wt({ path: "G:\\rabaed-wt\\other", merged: false })], 4);
    expect(lane4.takeOver).toEqual([]);
    expect(lane4.refused).toHaveLength(1);
    expect(choice([wt({})], 5).takeOver).toEqual([]);
    expect(chooseTakeover(3, { containers, worktrees: [wt({ path: cwd })], cwd: old, holders: none, platform: "win32" }).takeOver).toEqual([]);
  });
});

describe("chooseTakeover guards (RP-500 review)", () => {
  const cwd = "G:\\rabaed-wt\\current";
  const old = "G:\\rabaed-wt\\RP-448";
  const containers = [container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: old, ports: [5732] })];
  const wt = (w: Partial<TakeoverWorktree>): TakeoverWorktree => ({ path: old, branch: "RP-448-x", merged: true, dirty: false, exists: true, ...w });
  const choose = (worktrees: TakeoverWorktree[], pidRunning: (pid: number) => boolean = () => false) => chooseTakeover(3, { containers, worktrees, cwd, pidRunning, holders: none, platform: "win32" });

  it("refuses a live holder: its worktree exists and its branch is not merged", () => {
    const p = choose([wt({ merged: false })]);
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toHaveLength(1);
  });

  it("refuses a merged, clean worktree locked by a pid that still runs, and takes over when the pid is dead", () => {
    const locked = wt({ locked: "claude agent agent-x (pid 4242)" });
    const live = choose([locked], (pid) => pid === 4242);
    expect(live.takeOver).toEqual([]);
    expect(live.refused).toEqual([`${old} is locked by a session that is still running (pid 4242).`]);
    expect(choose([locked], () => false).takeOver).toHaveLength(1);
    expect(choose([wt({ locked: "kept by hand" })], () => true).takeOver).toHaveLength(1);
  });

  it("treats a worktree whose status cannot be read as having uncommitted changes", () => {
    const p = choose([wt({ dirty: true, statusError: "fatal: not a git repository" })]);
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual([`${old} is on RP-448-x; its uncommitted changes could not be checked (fatal: not a git repository).`]);
  });

  it("refuses when a worktree that is not merged names the project in its .env", () => {
    const sharer = wt({ path: "G:\\rabaed-wt\\sub", branch: "RP-9-y", merged: false, project: "rabaed-lane3" });
    const p = choose([wt({}), sharer]);
    expect(p.takeOver).toEqual([]);
    expect(p.refused).toEqual(["G:\\rabaed-wt\\sub is on RP-9-y, not merged into origin/main yet, and has rabaed-lane3 in its .env."]);
    expect(choose([wt({}), { ...sharer, merged: true }]).takeOver).toHaveLength(1);
    expect(choose([wt({}), { ...sharer, path: cwd }]).takeOver).toHaveLength(1);
    expect(choose([wt({}), { ...sharer, project: "rabaed-lane4" }]).takeOver).toHaveLength(1);
  });
});

describe("holdsLaneProject", () => {
  it("finds a worktree with a container of the lane's compose project, even when it is the lane's own under --db", () => {
    const containers = [container({ name: "a", project: "rabaed-lane3", workingDir: "G:\\w\\one" }), container({ name: "b", project: "rabaed-lane4", workingDir: "G:\\w\\two" })];
    expect(holdsLaneProject(3, containers, "g:\\w\\one", "win32")).toBe(true);
    expect(holdsLaneProject(3, containers, "G:\\w\\two", "win32")).toBe(false);
  });
});

describe("clashesAfterRemoval", () => {
  it("counts neither the removed containers nor the ports they held", () => {
    const db = container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: "G:\\w\\old", ports: [5732] });
    const input = { containers: [db], takenPorts: new Set([5732]), cwd: "G:\\w\\new", platform: "win32" as const };
    expect(laneClashes(3, input)).not.toEqual([]);
    expect(clashesAfterRemoval(3, input, [db])).toEqual([]);
  });

  it("still reports a port something else holds", () => {
    const db = container({ name: "rabaed-lane3-db-1", project: "rabaed-lane3", workingDir: "G:\\w\\old", ports: [5732] });
    const input = { containers: [db], takenPorts: new Set([5732, 3300]), cwd: "G:\\w\\new", platform: "win32" as const };
    expect(clashesAfterRemoval(3, input, [db])).toHaveLength(1);
  });
});

describe("releaseContainers", () => {
  it("removes the containers without their volumes, one at a time", () => {
    const calls: string[][] = [];
    releaseContainers([container({ name: "a" }), container({ name: "b" })], (args) => {
      calls.push(args);
      return "";
    });
    expect(calls).toEqual([
      ["rm", "-f", "a"],
      ["rm", "-f", "b"],
    ]);
  });

  it("stops at the first failure and names what was removed and what was not", () => {
    const run = (args: string[]) => {
      if (args[2] === "b") throw Object.assign(new Error("boom"), { stderr: "Error: removal in progress\n" });
      return "";
    };
    expect(() => releaseContainers([container({ name: "a" }), container({ name: "b" }), container({ name: "c" })], run)).toThrow(
      "Could not remove container b (Error: removal in progress). Removed: a. Not removed: b, c.",
    );
  });
});

describe("parsePruneArgs", () => {
  it("reads --merged, --yes, --dry-run and --lane N", () => {
    expect(parsePruneArgs(["--merged", "--dry-run"])).toEqual({ merged: true, yes: false, dryRun: true });
    expect(parsePruneArgs([])).toEqual({ merged: false, yes: false, dryRun: false });
    expect(parsePruneArgs(["--merged", "--lane", "3", "--dry-run"])).toEqual({ merged: true, yes: false, dryRun: true, lane: 3 });
  });

  it("rejects anything else, and a number that is not a lane", () => {
    expect(parsePruneArgs(["--force"])).toBeUndefined();
    expect(parsePruneArgs(["--lane"])).toBeUndefined();
    expect(parsePruneArgs(["--lane", "15"])).toBeUndefined();
    expect(parsePruneArgs(["--lane", "32"])).toEqual({ merged: false, yes: false, dryRun: false, lane: 32 });
    expect(parsePruneArgs(["--lane", "x"])).toBeUndefined();
  });
});

describe("parseDropDbsArgs (RP-535)", () => {
  it("reads --yes and --lane N, like lanes:prune", () => {
    expect(parseDropDbsArgs([])).toEqual({ yes: false });
    expect(parseDropDbsArgs(["--lane", "5", "--yes"])).toEqual({ yes: true, lane: 5 });
    expect(parseDropDbsArgs(["--lane", "32"])).toEqual({ yes: false, lane: 32 });
  });

  it("rejects anything else, and a number that is not a lane", () => {
    expect(parseDropDbsArgs(["--merged"])).toBeUndefined();
    expect(parseDropDbsArgs(["--lane"])).toBeUndefined();
    expect(parseDropDbsArgs(["--lane", "15"])).toBeUndefined();
    expect(parseDropDbsArgs(["--lane", "x"])).toBeUndefined();
  });
});

describe("dbContainers", () => {
  const all = [
    container({ name: "rabaed-lane5-db-1", project: "rabaed-lane5" }),
    container({ name: "rabaed-lane5-mailpit-1", project: "rabaed-lane5" }),
    container({ name: "rabaed-lane7-db-1", project: "rabaed-lane7" }),
    container({ name: "rabaed-lane8-db-1", project: "rabaed-lane8", state: "exited" }),
  ];

  it("takes the running db containers of every rabaed-* project", () => {
    expect(dbContainers(all).map((c) => c.name)).toEqual(["rabaed-lane5-db-1", "rabaed-lane7-db-1"]);
  });

  it("with a lane, takes only that lane's: --lane 5 leaves lane 7's databases alone (RP-535)", () => {
    expect(dbContainers(all, 5).map((c) => c.name)).toEqual(["rabaed-lane5-db-1"]);
    expect(dbContainers(all, 9)).toEqual([]);
  });
});

describe("composeProjectOfEnv", () => {
  it("reads COMPOSE_PROJECT_NAME, quoted or not", () => {
    expect(composeProjectOfEnv("A=1\nCOMPOSE_PROJECT_NAME=rabaed-lane5\n")).toBe("rabaed-lane5");
    expect(composeProjectOfEnv('COMPOSE_PROJECT_NAME="rabaed-lane2"')).toBe("rabaed-lane2");
    expect(composeProjectOfEnv("A=1")).toBeUndefined();
  });
});

describe("databaseOfUrl", () => {
  it("reads the database name", () => {
    expect(databaseOfUrl("postgres://rabaed_app:x@localhost:5832/rabaed_rp322")).toBe("rabaed_rp322");
    expect(databaseOfUrl("postgres://u:p@h:5432/rabaed?sslmode=disable")).toBe("rabaed");
  });
});

describe("removeProject (RP-1170: a kill that got no exit event is retried; volumes stay while a verify runs)", () => {
  const stale = { project: "rabaed-lane41", reason: "merged", containers: ["db", "files"], volumes: ["rabaed-lane41_db-data"] };
  const noExit = () => Object.assign(new Error("exit 1"), { stderr: "Error response from daemon: cannot remove container db: could not kill: tried to kill container, but did not receive an exit event\n" });
  const runner = (fail: (args: string[], n: number) => Error | undefined) => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      const error = fail(args, calls.filter((c) => c.join(" ") === args.join(" ")).length);
      if (error) throw error;
      return args[0] === "network" && args[1] === "ls" ? "net1\n" : "";
    };
    return { calls, run };
  };

  it("removes each container with its anonymous volumes, then the volumes and the network", () => {
    const { calls, run } = runner(() => undefined);
    expect(removeProject(stale, { run, wait: () => {}, volumesKeptBecause: () => undefined })).toEqual({ volumesKept: undefined });
    expect(calls).toEqual([
      ["rm", "-f", "-v", "db"],
      ["rm", "-f", "-v", "files"],
      ["volume", "rm", "rabaed-lane41_db-data"],
      ["network", "ls", "-q", "--filter", "label=com.docker.compose.project=rabaed-lane41"],
      ["network", "rm", "net1"],
    ]);
  });

  it("retries a container whose kill got no exit event, pausing between tries", () => {
    const waits: number[] = [];
    const { calls, run } = runner((args, n) => (args[3] === "db" && n < 3 ? noExit() : undefined));
    removeProject(stale, { run, wait: (ms) => waits.push(ms), volumesKeptBecause: () => undefined });
    expect(calls.filter((c) => c[3] === "db")).toHaveLength(3);
    expect(waits).toEqual([5000, 5000]);
  });

  it("gives up after three tries, naming what was removed and what was not", () => {
    const { run } = runner((args) => (args[3] === "db" ? noExit() : undefined));
    expect(() => removeProject(stale, { run, wait: () => {}, volumesKeptBecause: () => undefined })).toThrow(/^Could not remove container db after 3 tries \(.*did not receive an exit event\)\. Removed: none\. Not removed: db, files\./);
  });

  it("does not retry another failure, and counts a container already gone as removed", () => {
    const { calls, run } = runner((args) =>
      args[3] === "db" ? Object.assign(new Error("x"), { stderr: "Error: No such container: db" }) : args[3] === "files" ? Object.assign(new Error("x"), { stderr: "Error: removal in progress" }) : undefined,
    );
    expect(() => removeProject(stale, { run, wait: () => {}, volumesKeptBecause: () => undefined })).toThrow("Could not remove container files (Error: removal in progress). Removed: db. Not removed: files.");
    expect(calls.filter((c) => c[3] === "files")).toHaveLength(1);
  });

  it("keeps every volume with keepVolumes: no -v, no volume rm", () => {
    const { calls, run } = runner(() => undefined);
    expect(removeProject(stale, { keepVolumes: true, run, wait: () => {} })).toEqual({ volumesKept: "asked to keep them" });
    expect(calls.slice(0, 3)).toEqual([
      ["rm", "-f", "db"],
      ["rm", "-f", "files"],
      ["network", "ls", "-q", "--filter", "label=com.docker.compose.project=rabaed-lane41"],
    ]);
  });
});

describe("removeProject checks for a running verify itself (RP-1170, rule 4)", () => {
  it("keeps every volume while a verify runs, whatever the caller asked, and says why", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => (calls.push(args), "");
    const stale = { project: "rabaed-lane41", reason: "merged", containers: ["db"], volumes: ["rabaed-lane41_db-data"] };
    expect(removeProject(stale, { run, wait: () => {}, volumesKeptBecause: () => "a verify runs (pid 7)" })).toEqual({ volumesKept: "a verify runs (pid 7)" });
    expect(calls).toEqual([
      ["rm", "-f", "db"],
      ["network", "ls", "-q", "--filter", "label=com.docker.compose.project=rabaed-lane41"],
    ]);
  });
});

describe("removeProject never removes lane 7 (Main 6's review of #583)", () => {
  it("throws before any Docker call for the harness's stack", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => (calls.push(args), "");
    expect(() => removeProject({ project: "rabaed-lane7", reason: "x", containers: ["db"], volumes: ["v"] }, { run, wait: () => {}, volumesKeptBecause: () => undefined })).toThrow(
      /^rabaed-lane7 not removed: lane 7 holds Main 7's UAT harness data/,
    );
    expect(calls).toEqual([]);
  });
});
