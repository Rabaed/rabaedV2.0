// Seam 2: dropping and rebuilding a database, as the demo reset does locally
// (pnpm db:reset) and in dev (RP-213). Runs on its own scratch database.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { withDatabaseName, type DatabaseUrls } from "../src/config.ts";
import { resetDatabase } from "../src/reset-database.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const test = testDatabaseUrls();
const scratch = "rabaed_reset_test";
const urls: DatabaseUrls = {
  superuser: test.superuser,
  migrator: withDatabaseName(test.migrator, scratch),
  app: withDatabaseName(test.app, scratch),
  admin: withDatabaseName(test.admin, scratch),
};

async function query<T extends pg.QueryResultRow>(url: string, text: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  await query(withDatabaseName(test.superuser, "postgres"), `drop database if exists ${scratch} with (force)`);
});

describe("resetDatabase", () => {
  it("drops the database, even with connections open, and migrates it from empty", async () => {
    await resetDatabase(urls);
    await query(urls.migrator, "create table leftover (id int)");
    const open = new pg.Client({ connectionString: urls.app });
    await open.connect();
    open.on("error", () => undefined);

    const { applied } = await resetDatabase(urls);

    expect(applied.length).toBeGreaterThan(0);
    expect(await query(urls.migrator, "select to_regclass('public.leftover') as t")).toEqual([{ t: null }]);
    expect(await query(urls.app, "select count(*)::int as n from project")).toEqual([{ n: 0 }]);
    await open.end().catch(() => undefined);
  });
});
