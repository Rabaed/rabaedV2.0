// Many items cheaply (RP-978). A test that needs dozens of items to page over made them one by one through the api
// (53 requests, each a Draft with its access row, assignment, event and built-in answers), which took over 60 s in CI
// seam 1. This copies one item the api made: the item's row and every row the api's create path wrote for it
// (`create_work_item`, with `set_work_item_built_ins`), as the migrator, in one transaction. The database's own triggers
// then do the rest (the item's own Root, the raiser's watch, the search row, the event chain), so a copy is read by the
// List, the Kanban and the visibility checks like the original.
import type { Db } from "@rabaed/db";
import { sql, type RawBuilder } from "kysely";

/** What differs between a copy and the original: a new id and Subject, and optionally the time it was made. */
export type WorkItemCopy = {
  id: string;
  title: string;
  /** ISO time of the item's `created_at` (and of its created event); the original's when omitted. */
  createdAt?: string;
};

/**
 * The tables the create path writes beside `work_item`, each copied by `work_item_id`. A row that has an id of its own gets
 * a new one; the created event also takes the copy's Subject (the event is of the copy, not of the original) and time.
 */
const CHILD_TABLES: readonly { table: string; overrides: RawBuilder<unknown> }[] = [
  { table: "work_item_access", overrides: sql`` },
  { table: "work_item_dimension_value", overrides: sql`` },
  { table: "work_item_scope", overrides: sql`` },
  { table: "step_assignment", overrides: sql`, 'id', gen_random_uuid()` },
  {
    table: "work_item_event",
    overrides: sql`, 'id', gen_random_uuid(), 'created_at', coalesce(n.created_at, t.created_at),
      'payload', case when t.type = 'created' then t.payload || jsonb_build_object('title', n.title) else t.payload end`,
  },
];

/**
 * Inserts a copy of the item `templateId` for each of `copies`, as the migrator, in the same Project, raised by the same
 * Participant, at the same Step. The copy is a Draft like the original: copy only an item the api has just created
 * (nothing Submitted, linked, answered with Documents, ...), since only the rows of that creation are copied.
 */
export async function copyWorkItems(migrator: Db, templateId: string, copies: readonly WorkItemCopy[]): Promise<void> {
  if (copies.length === 0) return;
  const ids = copies.map((c) => c.id);
  const titles = copies.map((c) => c.title);
  const createdAts = copies.map((c) => c.createdAt ?? null);
  const names = sql`unnest(${ids}::uuid[], ${titles}::text[], ${createdAts}::timestamptz[]) as n (id, title, created_at)`;
  await migrator.transaction().execute(async (trx) => {
    // `root_id` null so the database makes each copy its own Root; `to_jsonb` and `jsonb_populate_record` copy every other column,
    // including any added later.
    await sql`
      insert into work_item
      select (jsonb_populate_record(null::work_item, to_jsonb(t) || jsonb_build_object(
        'id', n.id, 'title', n.title, 'root_id', null, 'created_at', coalesce(n.created_at, t.created_at)))).*
      from work_item t cross join ${names}
      where t.id = ${templateId}::uuid
    `.execute(trx);
    for (const { table, overrides } of CHILD_TABLES) {
      await sql`
        insert into ${sql.table(table)}
        select (jsonb_populate_record(null::${sql.table(table)}, to_jsonb(t) || jsonb_build_object('work_item_id', n.id${overrides}))).*
        from ${sql.table(table)} t cross join ${names}
        where t.work_item_id = ${templateId}::uuid
      `.execute(trx);
    }
  });
}
