// Seam 2 for the pool's idle connections (RP-402): when Postgres closes an idle
// connection (a database reset, an RDS restart or failover), pg-pool emits
// 'error' on the pool; with no listener Node crashes the api and the worker.
// createDb listens, logs the error by class and code only, and the next query
// opens a fresh connection.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, poolErrorLog } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();

/** Opens a pool, leaves one idle connection in it and returns that connection's backend pid. */
async function idleBackend(db: ReturnType<typeof createDb>): Promise<number> {
  const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);
  return rows[0]!.pid;
}

async function terminate(pid: number): Promise<void> {
  const admin = new pg.Client({ connectionString: urls.superuser });
  await admin.connect();
  try {
    await admin.query("select pg_terminate_backend($1)", [pid]);
  } finally {
    await admin.end();
  }
}

const opened: Array<ReturnType<typeof createDb>> = [];
afterAll(() => Promise.all(opened.map((db) => db.destroy())));

describe("createDb pool errors", () => {
  it("survives Postgres closing an idle connection, and the next query works", async () => {
    const errors: unknown[] = [];
    const db = createDb(urls.app, { max: 1, onPoolError: (error) => errors.push(error) });
    opened.push(db);
    const pid = await idleBackend(db);

    const unhandled: unknown[] = [];
    const record = (error: unknown) => unhandled.push(error);
    process.on("uncaughtException", record);
    try {
      await terminate(pid);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      process.off("uncaughtException", record);
    }

    expect(unhandled).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(poolErrorLog(errors[0])).toEqual({ level: "warn", msg: "idle database connection failed", err: { type: "DatabaseError", code: "57P01" } });
    expect((await sql<{ one: number }>`select 1 as one`.execute(db)).rows).toEqual([{ one: 1 }]);
    expect(await idleBackend(db)).not.toBe(pid);
  });

  it("logs by class and code only, never the message", () => {
    const error = Object.assign(new Error("terminating connection: row 'Secret Tower' quoted"), { code: "57P01", severity: "FATAL" });
    expect(JSON.stringify(poolErrorLog(error))).not.toContain("Secret Tower");
    expect(poolErrorLog(new Error("boom"))).toEqual({ level: "warn", msg: "idle database connection failed", err: { type: "Error", code: undefined } });
  });
});
