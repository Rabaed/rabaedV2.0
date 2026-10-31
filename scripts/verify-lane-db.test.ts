import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { laneDatabaseOf, laneDatabaseRefusal, sharesLaneDatabase, type OtherWorktree } from "./verify-lane-db.ts";
import { liveHolder, type LockHolder, type Processes } from "./verify-lock.ts";

const env = (lane: number, database = "rabaed") =>
  [
    `COMPOSE_PROJECT_NAME=rabaed-lane${lane}`,
    `POSTGRES_PORT=${5432 + lane * 10}`,
    `DATABASE_SUPERUSER_URL=postgres://postgres:x@localhost:${5432 + lane * 10}/postgres`,
    `DATABASE_APP_URL=postgres://rabaed_app:x@localhost:${5432 + lane * 10}/${database}`,
  ].join("\n");

const holder: LockHolder = { pid: 4242, started: new Date("2026-10-31T03:00:00Z"), command: "pnpm verify" };
// This run took its lock after the other worktree's.
const self: LockHolder = { pid: 5000, started: new Date("2026-10-31T03:30:00Z"), command: "pnpm verify" };
const other = (path: string, text: string | undefined, ...running: [] | [LockHolder | undefined]): OtherWorktree => ({
  path,
  env: text,
  holder: running.length === 0 ? holder : running[0],
});

describe("laneDatabaseOf", () => {
  it("reads the compose project, port and database", () => {
    expect(laneDatabaseOf(env(11))).toEqual({ project: "rabaed-lane11", port: 5542, database: "rabaed" });
  });

  it("leaves out what the .env doesn't say", () => {
    expect(laneDatabaseOf("")).toEqual({ project: undefined, port: undefined, database: undefined });
  });
});

describe("sharesLaneDatabase", () => {
  it("is true for one compose project or one port", () => {
    expect(sharesLaneDatabase(laneDatabaseOf(env(11)), laneDatabaseOf(env(11)))).toBe(true);
    expect(sharesLaneDatabase({ project: "a", port: 1, database: undefined }, { project: "b", port: 1, database: undefined })).toBe(true);
    expect(sharesLaneDatabase({ project: "a", port: 1, database: undefined }, { project: "a", port: 2, database: undefined })).toBe(true);
  });

  it("is false for two lanes", () => {
    expect(sharesLaneDatabase(laneDatabaseOf(env(11)), laneDatabaseOf(env(12)))).toBe(false);
  });

  it("is false for two --db databases on one lane's Postgres, true for the same one", () => {
    expect(sharesLaneDatabase(laneDatabaseOf(env(11, "rabaed_rp322")), laneDatabaseOf(env(11, "rabaed_rp323")))).toBe(false);
    expect(sharesLaneDatabase(laneDatabaseOf(env(11, "rabaed_rp322")), laneDatabaseOf(env(11, "rabaed_rp322")))).toBe(true);
    expect(sharesLaneDatabase(laneDatabaseOf(env(11, "rabaed_rp322")), laneDatabaseOf(env(11)))).toBe(false);
  });
});

describe("laneDatabaseRefusal", () => {
  it("names the other worktree and its verify when it holds the same lane", () => {
    const message = laneDatabaseRefusal(env(11), [other("G:/wt/other", env(12)), other("G:/wt/rp-1132", env(11))], self);
    expect(message).toContain("G:/wt/rp-1132");
    expect(message).toContain("compose project rabaed-lane11");
    expect(message).toContain("pid 4242");
  });

  it("names the port when the projects differ", () => {
    const sameLaneTwoProjects = `COMPOSE_PROJECT_NAME=rabaed-lane110\nPOSTGRES_PORT=5542`;
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/x", sameLaneTwoProjects)], self)).toContain("Postgres port 5542");
  });

  it("lets the older run go when the other worktree's lock was taken after its own, so only one gives way", () => {
    const older: LockHolder = { ...self, started: new Date("2026-10-31T02:00:00Z") };
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/rp-1132", env(11))], older)).toBeUndefined();
    const tie: LockHolder = { ...holder, pid: 4243 };
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/rp-1132", env(11))], tie)).toContain("G:/wt/rp-1132");
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/rp-1132", env(11), tie)], holder)).toBeUndefined();
  });

  it("lets a run go when the same lane's other worktree runs no verify", () => {
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/rp-1132", env(11), undefined)], self)).toBeUndefined();
  });

  it("lets a run go when the other worktree has no .env, or sits on another lane or --db database", () => {
    expect(laneDatabaseRefusal(env(11), [other("G:/wt/a", undefined), other("G:/wt/b", env(12)), other("G:/wt/c", env(11, "rabaed_rp322"))], self)).toBeUndefined();
    expect(laneDatabaseRefusal(env(11, "rabaed_rp321"), [other("G:/wt/c", env(11, "rabaed_rp322"))], self)).toBeUndefined();
  });
});

describe("liveHolder", () => {
  const processes = (alive: boolean): Processes => ({ isAlive: () => alive, startOf: () => undefined });
  const self: LockHolder = { pid: 1, started: new Date(), command: "pnpm verify" };

  it("returns the live run in a lock file and nothing for a gone one, an unreadable one or no file (temp folder only)", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-lane-db-"));
    try {
      const file = join(dir, ".verify.lock");
      expect(liveHolder(file, self, processes(true))).toBeUndefined();
      writeFileSync(file, JSON.stringify({ ...holder, started: holder.started.toISOString() }));
      expect(liveHolder(file, self, processes(true))?.pid).toBe(4242);
      expect(liveHolder(file, self, processes(false))).toBeUndefined();
      writeFileSync(file, "not json");
      expect(liveHolder(file, self, processes(true))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
