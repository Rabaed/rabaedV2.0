// Seam 2: grants stay as narrow as CODING_STANDARDS.md says (RP-328). Reviews
// found grants that were too wide several times (RP-299: functions executable by
// everyone; RP-255: a whole-table select on work_item). This reads the live
// catalog after every migration, so it covers past and future migrations alike.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/client.ts";
import { appFunctionsExecutableByPublic, wholeTableGrantsOnWorkItem } from "../test-support/grants.ts";
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

// Functions PUBLIC may execute on purpose, as `app.name(argument types)`. Each
// entry states why every role that can connect needs it. Empty since RP-328.
const MAY_BE_PUBLIC: string[] = [];

describe("functions in the app schema", () => {
  it("are never executable by public, outside the allow-list", async () => {
    const executable = await appFunctionsExecutableByPublic(migrator);
    expect(executable.filter((fn) => !MAY_BE_PUBLIC.includes(fn))).toEqual([]);
  });

  it("are caught when a new one keeps the default grant to public", async () => {
    await rolledBack(async (trx) => {
      await sql.raw("create function app.rp328_probe(int) returns int language sql as $$ select 1 $$").execute(trx);
      expect(await appFunctionsExecutableByPublic(trx)).toContain("app.rp328_probe(integer)");
    });
  });

  it("are caught when one is granted to public explicitly", async () => {
    await rolledBack(async (trx) => {
      await sql.raw("grant execute on function app.current_project_ids() to public").execute(trx);
      expect(await appFunctionsExecutableByPublic(trx)).toContain("app.current_project_ids()");
    });
  });
});

describe("work_item", () => {
  it("is granted to the app role column by column only", async () => {
    expect(await wholeTableGrantsOnWorkItem(migrator)).toEqual([]);
  });

  it("is caught when the app role gets a whole-table grant", async () => {
    await rolledBack(async (trx) => {
      await sql.raw("grant select, update on work_item to rabaed_app").execute(trx);
      expect(await wholeTableGrantsOnWorkItem(trx)).toEqual(["SELECT", "UPDATE"]);
    });
  });

  it("is caught when the grant reaches the app role through public", async () => {
    await rolledBack(async (trx) => {
      await sql.raw("grant delete on work_item to public").execute(trx);
      expect(await wholeTableGrantsOnWorkItem(trx)).toEqual(["DELETE"]);
    });
  });
});

