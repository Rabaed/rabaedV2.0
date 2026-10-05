import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  databaseOfUrl,
  databasesInUse,
  databasesOfEnv,
  dropOrKeep,
  firstFreeLane,
  isPortTaken,
  isValidDbSuffix,
  laneClashes,
  laneEnv,
  lanePorts,
  orphanDatabases,
  parseConnections,
  parseContainers,
  parseVolumes,
  staleProjects,
  type Container,
} from "./lanes.ts";

// `docker ps -a --format` lines as lanes.ts asks for them: name, state, compose project, working dir, ports.
const psLine = (name: string, state: string, project: string, dir: string, ports: string) => [name, state, project, dir, ports].join("\t");

const container = (c: Partial<Container> & Pick<Container, "name">): Container => ({ state: "running", project: "", workingDir: "", ports: [], ...c });

describe("lanePorts", () => {
  it("keeps the defaults for lane 0 and adds 100 per lane", () => {
    expect(lanePorts(0)).toEqual({ postgres: 5432, api: 4000, admin: 4050, web: 3000, mailpit: 8025, files: 9000 });
    expect(lanePorts(3)).toEqual({ postgres: 5732, api: 4300, admin: 4350, web: 3300, mailpit: 8325, files: 9300 });
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

  it("starts at lane 1 when asked from lane 0, and still reaches lane 9", () => {
    const tried: number[] = [];
    expect(firstFreeLane(0, (n) => (tried.push(n), n === 9 ? [] : ["taken"]))).toBe(9);
    expect(tried).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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

describe("databaseOfUrl", () => {
  it("reads the database name", () => {
    expect(databaseOfUrl("postgres://rabaed_app:x@localhost:5832/rabaed_rp322")).toBe("rabaed_rp322");
    expect(databaseOfUrl("postgres://u:p@h:5432/rabaed?sslmode=disable")).toBe("rabaed");
  });
});
