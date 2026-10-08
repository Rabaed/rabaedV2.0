// Seam 2 for the pool's idle connections (RP-402): when Postgres closes an idle
// connection (a database reset, an RDS restart or failover), pg-pool emits
// 'error' on the pool; with no listener Node crashes the api and the worker.
// createDb listens, logs the error by class and code only, and the next query
// opens a fresh connection.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/index.ts";
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
  it("survives Postgres closing an idle connection, logs it by class and code only, and the next query works", async () => {
    const db = createDb(urls.app, { max: 1 });
    opened.push(db);
    const pid = await idleBackend(db);

    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const unhandled: unknown[] = [];
    const record = (error: unknown) => unhandled.push(error);
    process.on("uncaughtException", record);
    let line: string | undefined;
    try {
      await terminate(pid);
      await vi.waitFor(
        () => {
          line = written.find((entry) => entry.includes("idle database connection failed"));
          expect(line).toBeDefined();
        },
        { timeout: 5000 },
      );
    } finally {
      process.off("uncaughtException", record);
      stderr.mockRestore();
    }

    expect(unhandled).toEqual([]);
    expect(JSON.parse(line!)).toEqual({ level: "warn", msg: "idle database connection failed", err: { type: "DatabaseError", code: "57P01" } });
    // The server's own text ("terminating connection due to administrator command") is not logged.
    expect(line).not.toContain("terminating");
    expect((await sql<{ one: number }>`select 1 as one`.execute(db)).rows).toEqual([{ one: 1 }]);
    expect(await idleBackend(db)).not.toBe(pid);
  });
});
