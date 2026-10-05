// Seam 2: security definer functions in app are written in plpgsql (RP-310;
// CODING_STANDARDS.md, Database). A `language sql` definer function is planned
// again on every call, nested helpers included. This reads the live catalog
// after every migration, so it covers past and future migrations alike.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/client.ts";
import { appDefinerFunctionsInSql } from "../test-support/definer-language.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

class Rollback extends Error {}

/** Runs `fn` as the migrator in a transaction that is always rolled back. */
async function rolledBack(fn: (trx: Db) => Promise<void>): Promise<void> {
  await migrator
    .transaction()
    .execute(async (trx) => {
      await fn(trx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

describe("security definer functions in the app schema", () => {
  it("are written in plpgsql", async () => {
    expect(await appDefinerFunctionsInSql(migrator)).toEqual([]);
  });

  it("are caught when a new one is written in sql, and invoker ones are not", async () => {
    await rolledBack(async (trx) => {
      await sql
        .raw(
          "create function app.definer_probe(int) returns int language sql security definer set search_path = pg_catalog as $$ select 1 $$",
        )
        .execute(trx);
      await sql.raw("create function app.invoker_probe(int) returns int language sql as $$ select 1 $$").execute(trx);
      const found = await appDefinerFunctionsInSql(trx);
      expect(found).toContain("app.definer_probe(integer)");
      expect(found).not.toContain("app.invoker_probe(integer)");
    });
  });
});
