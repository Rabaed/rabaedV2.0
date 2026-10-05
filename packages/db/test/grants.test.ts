// Seam 2: grants stay as narrow as CODING_STANDARDS.md says (RP-328). Reviews
// found grants that were too wide several times (RP-299: functions executable by
// everyone; RP-255: a whole-table select on work_item). This reads the live
// catalog after every migration, so it covers past and future migrations alike.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { appFunctionsExecutableByPublic, wholeTableGrantsOnWorkItem } from "../test-support/grants.ts";
import { rolledBack, testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

// Functions PUBLIC may execute on purpose, as `app.name(argument types)`. Each
// entry states why every role that can connect needs it. Empty since RP-328.
const MAY_BE_PUBLIC: string[] = [];

describe("functions in the app schema", () => {
  it("are never executable by public, outside the allow-list", async () => {
    const executable = await appFunctionsExecutableByPublic(migrator);
    expect(executable.filter((fn) => !MAY_BE_PUBLIC.includes(fn))).toEqual([]);
  });

  it("are caught when a new one keeps the default grant to public", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("create function app.grants_probe(int) returns int language sql as $$ select 1 $$").execute(trx);
      expect(await appFunctionsExecutableByPublic(trx)).toContain("app.grants_probe(integer)");
    });
  });

  it("are caught when one is granted to public explicitly", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("create function app.grants_probe(int) returns int language sql as $$ select 1 $$").execute(trx);
      await sql.raw("revoke all on function app.grants_probe(int) from public").execute(trx);
      expect(await appFunctionsExecutableByPublic(trx)).not.toContain("app.grants_probe(integer)");
      await sql.raw("grant execute on function app.grants_probe(int) to public").execute(trx);
      expect(await appFunctionsExecutableByPublic(trx)).toContain("app.grants_probe(integer)");
    });
  });
});

describe("work_item", () => {
  it("is granted to the app role column by column only", async () => {
    expect(await wholeTableGrantsOnWorkItem(migrator)).toEqual([]);
  });

  it("is caught when the app role gets a whole-table grant", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("grant select, update on work_item to rabaed_app").execute(trx);
      expect(await wholeTableGrantsOnWorkItem(trx)).toEqual(["SELECT", "UPDATE"]);
    });
  });

  it("is caught when the grant reaches the app role through public", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("grant delete, truncate on work_item to public").execute(trx);
      expect(await wholeTableGrantsOnWorkItem(trx)).toEqual(["DELETE", "TRUNCATE"]);
    });
  });
});

