// Many items cheaply (RP-978). A test that needs dozens of items to page over made them one by one through the api
// (53 requests, each a Draft with its access row, assignment, event and built-in answers), which took over 60 s in CI
// seam 1. This copies one item the api made: the item's row and every row the api's create path wrote for it, as the
// migrator, in one transaction. The database's own triggers then do the rest (the item's own Root, the raiser's watch,
// the search row, the event chain), so a copy is read by the List, the Kanban and the visibility checks like the original.
import type { createDb } from "@rabaed/db";
import { sql } from "kysely";

type Db = ReturnType<typeof createDb>;

/** What differs between a copy and the original: a new id and Subject. */
export type WorkItemCopy = { id: string; title: string };

/**
 * Inserts a copy of the item `templateId` for each of `copies`, as the migrator, in the same Project, raised by the same
 * Participant, at the same Step. The copy is a Draft like the original: copy only an item the api has just created
 * (nothing Submitted, linked, answered with Documents, ...), since only the rows of that creation are copied.
 */
export async function copyWorkItem(migrator: Db, templateId: string, copies: readonly WorkItemCopy[]): Promise<void> {
  if (copies.length === 0) return;
  const ids = copies.map((c) => c.id);
  const titles = copies.map((c) => c.title);
  await migrator.transaction().execute(async (trx) => {
    // `root_id` null so the database makes each copy its own Root; `to_jsonb` and `jsonb_populate_record` copy every other column,
    // including any added later.
    await sql`
      insert into work_item
      select (jsonb_populate_record(null::work_item, to_jsonb(t) || jsonb_build_object('id', n.id, 'title', n.title, 'root_id', null))).*
      from work_item t
      cross join unnest(${ids}::uuid[], ${titles}::text[]) as n (id, title)
      where t.id = ${templateId}::uuid
    `.execute(trx);
    // Each of the rows the api's create path wrote beside the item. The id of a row that has one is new; the event chain
    // numbers and hashes the event itself.
    await sql`
      insert into work_item_access
      select (jsonb_populate_record(null::work_item_access, to_jsonb(t) || jsonb_build_object('work_item_id', n.id))).*
      from work_item_access t cross join unnest(${ids}::uuid[]) as n (id)
      where t.work_item_id = ${templateId}::uuid
    `.execute(trx);
    await sql`
      insert into work_item_dimension_value
      select (jsonb_populate_record(null::work_item_dimension_value, to_jsonb(t) || jsonb_build_object('work_item_id', n.id))).*
      from work_item_dimension_value t cross join unnest(${ids}::uuid[]) as n (id)
      where t.work_item_id = ${templateId}::uuid
    `.execute(trx);
    await sql`
      insert into step_assignment
      select (jsonb_populate_record(null::step_assignment, to_jsonb(t) || jsonb_build_object('work_item_id', n.id, 'id', gen_random_uuid()))).*
      from step_assignment t cross join unnest(${ids}::uuid[]) as n (id)
      where t.work_item_id = ${templateId}::uuid
    `.execute(trx);
    await sql`
      insert into work_item_event
      select (jsonb_populate_record(null::work_item_event, to_jsonb(t) || jsonb_build_object('work_item_id', n.id, 'id', gen_random_uuid()))).*
      from work_item_event t cross join unnest(${ids}::uuid[]) as n (id)
      where t.work_item_id = ${templateId}::uuid
    `.execute(trx);
  });
}
