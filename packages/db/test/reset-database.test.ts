// Seam 2: dropping and rebuilding a database, as the demo reset does locally
// (pnpm db:reset) and in dev (RP-213). Runs on its own scratch database.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { databaseNameOf, MIGRATOR_ROLE, withDatabaseName, type DatabaseUrls } from "../src/config.ts";
import { resetDatabase } from "../src/reset-database.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const test = testDatabaseUrls();
// Named after this run's test database, so seam 2 runs on other `--db` databases
// in the same Postgres never drop each other's scratch database (RP-949).
const scratch = `${databaseNameOf(test.migrator)}_reset`;
const urls: DatabaseUrls = {
  superuser: test.superuser,
  migrator: withDatabaseName(test.migrator, scratch),
  app: withDatabaseName(test.app, scratch),
  admin: withDatabaseName(test.admin, scratch),
};
const maintenanceUrl = withDatabaseName(test.superuser, "postgres");

async function query<T extends pg.QueryResultRow>(url: string, text: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

/** Drops the scratch database, whatever is connected to it. */
async function dropScratch(): Promise<void> {
  await query(maintenanceUrl, `drop database if exists ${scratch} with (force)`);
}

afterAll(dropScratch);

describe("resetDatabase", () => {
  it("refuses a database that is not on this machine unless told it may", async () => {
    const remote = { ...urls, superuser: urls.superuser.replace(/@[^/]+\//, "@db.example.com/") };
    await expect(resetDatabase(remote)).rejects.toThrow(/not on this machine/);
  });

  // It migrates the whole chain from empty, which grows with every ticket: 202 migrations took
  // over 300 s under several lanes' verify (RP-949).
  it("drops the database, even with connections open, and migrates it from empty", { timeout: 600_000 }, async () => {
    // A database left behind by an earlier run, built by hand: only the reset below is under test.
    await dropScratch();
    await query(maintenanceUrl, `create database ${scratch} owner ${MIGRATOR_ROLE}`);
    await query(urls.migrator, "create table leftover (id int)");
    const open = new pg.Client({ connectionString: urls.app });
    await open.connect();
    open.on("error", () => undefined);

    const { applied } = await resetDatabase(urls);

    expect(applied.length).toBeGreaterThan(0);
    await expect(open.query("select 1")).rejects.toThrow();
    expect(await query(urls.migrator, "select to_regclass('public.leftover') as t")).toEqual([{ t: null }]);
    expect(await query(urls.app, "select count(*)::int as n from project")).toEqual([{ n: 0 }]);
    await open.end().catch(() => undefined);
  });
});
