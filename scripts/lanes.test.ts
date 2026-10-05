import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { firstFreeLane, isPortTaken, laneClashes, lanePorts, parseContainers, parseVolumes, staleProjects, type Container } from "./lanes.ts";

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
