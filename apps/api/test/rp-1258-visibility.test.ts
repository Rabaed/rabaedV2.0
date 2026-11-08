// Seam 1 for RP-1258 (visibility.md V14: no other Company reads a Member's id). The seam-2 ratchet checks the app
// role's grants; this checks them for the role the api's own pool logs in as (the URL createTestApi builds the api on,
// as server.ts's createDbFromEnv("app") does), so the guard can't pass on one role while the api reads as another.
import { APP_ROLE, createDb } from "@rabaed/db";
import { MEMBER_ID_ALLOW, memberIdGrantProblems, readableMemberIdColumns, testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";

const urls = testDatabaseUrls();
const apiPool = createDb(urls.app, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });

afterAll(async () => {
  await apiPool.destroy();
  await migrator.destroy();
});

describe("RP-1258-1: the api's database role reads a Member id column only where the allow list says why no other Company reaches it", () => {
  it("RP-1258-1: the role the api connects as may SELECT no Member id column off the allow list, and every entry still names one", async () => {
    const { rows } = await sql<{ role: string }>`select current_user as role`.execute(apiPool);
    const role = rows[0]!.role;
    expect(role).toBe(APP_ROLE);
    expect(memberIdGrantProblems(await readableMemberIdColumns(migrator, role), MEMBER_ID_ALLOW)).toEqual([]); // not hidden-from: a list of ratchet problems
  });
});
