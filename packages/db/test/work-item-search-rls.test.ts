// Seam 2 for Search (RP-347; visibility.md "Search and filters", V19), as the
// app role, on the seeded demo Project. The search index adds nothing the app
// role may read: it can't read work_item_search at all, nor write it, and finds
// items only through app.search_work_items, which answers with exactly the
// matching items the Member sees through row-level security, and nothing for
// anyone else.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const app = createDb(urls.app, { max: 1 });
afterAll(() => Promise.all([migrator.destroy(), app.destroy()]));

let projectId = "";
let members: string[] = [];

beforeAll(async () => {
  // The Project with the most MARs (the seeded demo's, unless a suite made more), and every Member on it.
  const { rows } = await sql<{ project_id: string }>`
    select w.project_id from work_item w join work_item_type t on t.id = w.work_item_type_id
    where t.owner_kind = 'rabaed' and t.code = 'MAR'
    group by w.project_id order by count(*) desc limit 1
  `.execute(migrator);
  projectId = rows[0]!.project_id;
  members = (
    await sql<{ member_id: string }>`
      select distinct member_id from project_member where project_id = ${projectId} and status = 'active'
    `.execute(migrator)
  ).rows.map((r) => r.member_id);
});

const as = <T>(memberId: string, fn: Parameters<typeof withMember<T>>[2]) => withMember(app, memberId, fn);

const searched = (memberId: string, q: string) =>
  as(memberId, async (trx) =>
    (await sql<{ id: string }>`select app.search_work_items(${projectId}::uuid, ${q}::text) as id`.execute(trx)).rows.map((r) => r.id).sort(),
  );

describe("the search index", () => {
  it("is not readable by the app role, not even a column of it", async () => {
    const { rows } = await sql<{ table: boolean; column: boolean }>`
      select has_table_privilege('rabaed_app', 'work_item_search', 'select, insert, update, delete') as table,
        has_any_column_privilege('rabaed_app', 'work_item_search', 'select, insert, update') as column
    `.execute(migrator);
    expect(rows).toEqual([{ table: false, column: false }]);
    await expect(as(members[0]!, (trx) => sql`select search_text from work_item_search`.execute(trx))).rejects.toThrow(/permission denied/);
  });

  it("is written only by its triggers: the app role can't run its refresh", async () => {
    await expect(
      as(members[0]!, (trx) => sql`select app.refresh_work_item_search(${randomUUID()}::uuid)`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("finds exactly the matching items each Member sees through row-level security", async () => {
    expect(members.length).toBeGreaterThan(1);
    let found = 0;
    for (const member of members) {
      // Every item of the seeded Type has "Material Submittal" in its search text.
      const visible = await as(member, async (trx) =>
        (
          await sql<{ id: string }>`
            select w.id from work_item w join work_item_type t on t.id = w.work_item_type_id
            where w.project_id = ${projectId} and t.owner_kind = 'rabaed' and t.code = 'MAR'
          `.execute(trx)
        ).rows
          .map((r) => r.id)
          .sort(),
      );
      expect(await searched(member, "Material Submittal"), member).toEqual(visible);
      found += visible.length;
    }
    expect(found).toBeGreaterThan(0); // the check is not blind
  });

  it("finds nothing for a caller who is no Member, or none at all", async () => {
    expect(await searched(randomUUID(), "Material")).toEqual([]);
    const { rows } = await sql<{ id: string }>`select app.search_work_items(${projectId}::uuid, 'Material') as id`.execute(app);
    expect(rows).toEqual([]);
  });
});
