// Seam 2: a table the app role reads only through item visibility is reviewed
// (RP-367). Its row policy asks only whether the caller sees the item, so every
// column the app role may read goes to every Participant who sees it. RP-309
// found two such tables leaking: step_assignment gave away another Participant's
// internal Steps (V5, V14), and work_item_access.since the Draft's start time
// (V1). This reads the live catalog after every migration, so a new table or
// policy of that shape fails here until someone reviews its columns.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { rolledBack, testDatabaseUrls } from "../test-support/index.ts";
import { tablesReadableThroughItemVisibility } from "../test-support/item-visibility-tables.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

// Each entry says why every column the app role reads may go to anyone who sees
// the item.
const REVIEWED: Record<string, string> = {
  work_item:
    "The item itself, read column by column; each granted column passed the grant rule (grants.test.ts). created_at, data and field_times are not granted (RP-309, RP-392).",
  work_item_access:
    "Which Participants have access, by random id, and why (raised, handling, oversight by Project role, V2); names come only through app.work_item_companies. `since` is not granted: the raiser's is the Draft's start (RP-309).",
  work_item_dimension_value:
    "The item's Visibility values (Trade, Location), shown on the item; app.sees_work_item already requires the viewer's grants to cover each one.",
  work_item_scope: "The item's Scopes, shown on the item; every Project Member reads the Project's Scopes anyway.",
};

// Tables of that shape with a column that reaches viewers it shouldn't, kept
// here until it is fixed so the check still fails on anything new.
const KNOWN_LEAKS: Record<string, string> = {
  document:
    "RP-367 finding: confirmed_at and created_at keep the real time of a Document added during the Draft, before the Creation Date; the api shows confirmed_at as uploadedAt (visibility.md 61, 74).",
  work_item_link:
    "RP-367 finding: created_at keeps the real time of a Link added during the Draft; the app role reads it and app.work_item_links returns it (visibility.md 61).",
};

describe("tables the app role reads only through item visibility", () => {
  it("are each reviewed", async () => {
    const reviewed = [...Object.keys(REVIEWED), ...Object.keys(KNOWN_LEAKS)].sort();
    expect(await tablesReadableThroughItemVisibility(migrator)).toEqual(reviewed);
  });

  it("are caught when a new table's policy asks only whether the caller sees the item", async () => {
    await rolledBack(migrator, async (trx) => {
      // The default privileges in public grant a new table to the app role whole;
      // each probe states its own grant instead.
      const table = async (name: string, using: string, grant: string) => {
        await sql.raw(`create table ${name} (id uuid primary key, work_item_id uuid not null, at timestamptz)`).execute(trx);
        await sql.raw(`alter table ${name} enable row level security`).execute(trx);
        await sql.raw(`create policy ${name}_read on ${name} for select to rabaed_app using (${using})`).execute(trx);
        await sql.raw(`revoke all on ${name} from rabaed_app`).execute(trx);
        await sql.raw(`grant ${grant} on ${name} to rabaed_app`).execute(trx);
      };
      await table("item_probe", "work_item_id in (select id from work_item)", "select");
      await table("sees_probe", "app.sees_work_item(work_item_id)", "select (id, at)");
      await table(
        "own_probe",
        "work_item_id in (select id from work_item) and at is not null and id in (select app.current_participant_ids())",
        "select",
      );
      await table("ungranted_probe", "app.sees_work_item(work_item_id)", "insert");
      const found = await tablesReadableThroughItemVisibility(trx);
      expect(found).toContain("item_probe");
      expect(found).toContain("sees_probe");
      expect(found).not.toContain("own_probe");
      expect(found).not.toContain("ungranted_probe");
    });
  });

  it("are caught when a new policy opens an existing table to everyone who sees the item", async () => {
    await rolledBack(migrator, async (trx) => {
      expect(await tablesReadableThroughItemVisibility(trx)).not.toContain("step_assignment");
      await sql
        .raw("create policy probe_reads_step_assignments on step_assignment for select to rabaed_app using (app.sees_work_item(work_item_id))")
        .execute(trx);
      expect(await tablesReadableThroughItemVisibility(trx)).toContain("step_assignment");
    });
  });
});
