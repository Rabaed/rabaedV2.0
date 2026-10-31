import { sql, type RawBuilder, type Transaction } from "kysely";
import type { Db } from "../src/client.ts";
import type { Database } from "../src/schema.ts";

// `uat:age`'s write (RP-922), as the migrator, one transaction for every item: each item's own times
// move back by its shift, the audit trail never.
//
// Moving `work_item.participant_entered_at` reads, to the database, like the item leaving its
// Participant: triggers then clear the shared answers (app.share_answers_on_leaving), drop the holder's
// waiting reply files and removed Links, and freeze the Documents added since the last arrival. No
// trigger is ever disabled. So an item is aged only when those would find nothing to do; the shared
// answers the first trigger clears are written back at once; and every row the item has is compared
// before and after, its moved times left out, so any other change rolls the whole run back. Frozen
// Documents are left as they are (app.refuse_frozen_document_change): they read later than the moved
// dates, which no Creation Date rule forbids.

/** A time column the tool moves, or why it keeps it. */
export interface TableTimes {
  /** Its rows of the item (`$item`). */
  rows: (item: string) => RawBuilder<unknown>;
  moved: readonly string[];
  /** The time columns it keeps, each with why. */
  kept: Readonly<Record<string, string>>;
}

const AUDIT = "kept: the audit trail keeps the true history";

/**
 * Every timestamp column of `work_item` and of each table with a foreign key to it, moved or kept
 * (scripts' test 8, packages/db/test/uat-age.test.ts, fails on a column missing here). Tables with no
 * rows of the item to move list only `kept`.
 */
export const ITEM_TIMES: Readonly<Record<string, TableTimes>> = {
  work_item: {
    rows: (item) => sql`id = ${item}::uuid`,
    moved: ["created_at", "numbered_at", "submitted_at", "participant_entered_at", "step_entered_at", "updated_at"],
    kept: { closed_at: "kept: only open items are aged", discarded_at: "kept: only open items are aged" },
  },
  document: {
    rows: (item) => sql`work_item_id = ${item}::uuid and frozen_at is null`,
    moved: ["created_at", "confirmed_at", "taken_at", "removed_at"],
    kept: { frozen_at: "kept: a frozen Document never changes (app.refuse_frozen_document_change); an unfrozen one has none" },
  },
  step_assignment: {
    rows: (item) => sql`work_item_id = ${item}::uuid`,
    moved: ["created_at", "picked_up_at", "done_at", "updated_at"],
    kept: {},
  },
  work_item_link: {
    rows: (item) => sql`from_id = ${item}::uuid`,
    moved: ["created_at"],
    kept: { removed_at: "kept: an item with a removed Link is not aged (leaving would drop it)" },
  },
  work_item_access: { rows: (item) => sql`work_item_id = ${item}::uuid`, moved: ["since"], kept: {} },
  work_item_checklist: { rows: (item) => sql`work_item_id = ${item}::uuid`, moved: ["copied_at"], kept: {} },
  reply_checklist: { rows: (item) => sql`work_item_id = ${item}::uuid`, moved: ["updated_at"], kept: {} },
  work_item_event: { rows: () => sql`false`, moved: [], kept: { created_at: `${AUDIT}: its times are inside the hash chain` } },
  package_event: { rows: () => sql`false`, moved: [], kept: { created_at: `${AUDIT}: append-only` } },
  chat_message: { rows: () => sql`false`, moved: [], kept: { created_at: "kept: never changed (app.chat_message_insert_only); it stays after the Submission Date" } },
  notification: {
    rows: () => sql`false`,
    moved: [],
    kept: Object.fromEntries(["created_at", "read_at", "withdrawn_at", "emailed_at", "digested_at"].map((c) => [c, "kept: notifications are never changed by the tool"])),
  },
  documental_record: { rows: () => sql`false`, moved: [], kept: { sealed_at: "kept: a closed item's record", created_at: "kept: a closed item's record" } },
  working_copy: {
    rows: () => sql`false`,
    moved: [],
    kept: { made_at: "kept: a print made then", stale_at: "kept: a print made then", created_at: "kept: a print made then" },
  },
  command_idempotency: { rows: () => sql`false`, moved: [], kept: { created_at: "kept: a command's replay record, never read as an item time" } },
  work_item_watch: { rows: () => sql`false`, moved: [], kept: { created_at: "kept: a Member's watch, not a time of the item" } },
  approved_supplier: {
    rows: () => sql`false`,
    moved: [],
    kept: { added_at: "kept: the Approved Supplier list's own record", withdrawn_at: "kept: the Approved Supplier list's own record" },
  },
};

/** The answer-time maps (`{ field: { at, by } }`) on work_item, moved like its columns. */
export const ITEM_TIME_MAPS = ["field_times", "field_times_as_arrived"] as const;

export interface AgeItem {
  id: string;
  documentNumber: string;
  shiftMs: number;
}

export interface AgedRows {
  id: string;
  documentNumber: string;
  /** Rows changed, by table; none left out. */
  rows: Record<string, number>;
}

/** An item the tool will not age: its message names it. */
export class AgeRefused extends Error {}

/** Thrown to roll a dry run back after it ran every check. */
class DryRun extends Error {
  constructor(readonly aged: AgedRows[]) {
    super("dry run");
  }
}

const shiftOf = (shiftMs: number) => sql`(${shiftMs / 1000}::double precision * interval '1 second')`;

/** `map` (a work_item answer-time column) with each `at` moved back by `shift`. */
const movedMap = (column: string, shift: RawBuilder<unknown>) => sql`case when ${sql.ref(column)} is null then null else (
  select coalesce(jsonb_object_agg(t.key, case when jsonb_typeof(t.value -> 'at') = 'string'
    then jsonb_set(t.value, '{at}', to_jsonb((t.value ->> 'at')::timestamptz - ${shift})) else t.value end), '{}'::jsonb)
  from jsonb_each(${sql.ref(column)}) t) end`;

/** A fingerprint of every row the item has in the tables the tool writes, with the moved times left out. */
async function fingerprint(trx: Transaction<Database>, item: string): Promise<string> {
  const parts = Object.entries(ITEM_TIMES)
    .filter(([, t]) => t.moved.length > 0)
    .map(([table, t]) => {
      const drop = [...t.moved, ...(table === "work_item" ? ITEM_TIME_MAPS : [])];
      // Every row of the item, frozen Documents too: the `rows` filter is what moves, not what is compared.
      const all = table === "work_item" ? sql`id = ${item}::uuid` : table === "work_item_link" ? sql`from_id = ${item}::uuid` : sql`work_item_id = ${item}::uuid`;
      // Ordered by the row itself: not every table has an id.
      return sql`(select coalesce(jsonb_agg(to_jsonb(x) - ${drop}::text[] order by (to_jsonb(x) - ${drop}::text[])::text), '[]'::jsonb) from ${sql.table(table)} x where ${all})`;
    });
  const { rows } = await sql<{ f: string }>`select md5(jsonb_build_array(${sql.join(parts)},
      (select count(*) from work_item_event), (select count(*) from outbox), (select count(*) from notification),
      (select to_jsonb(p) from package p join work_item w on w.package_id = p.id where w.id = ${item}::uuid))::text) as f`.execute(trx);
  return rows[0]!.f;
}

/** Why the leaving triggers would change item `item`, or none. */
async function blockers(trx: Transaction<Database>, item: string): Promise<string[]> {
  const { rows } = await sql<{ reply_files: boolean; reply_checklist: boolean; removed_links: boolean; unfrozen: boolean }>`
    select
      exists (select 1 from document d where d.work_item_id = w.id and d.reply and d.reply_event_id is null
        and d.confirmed_at is not null and d.removed_at is null) as reply_files,
      exists (select 1 from reply_checklist r where r.work_item_id = w.id and r.reply_event_id is null) as reply_checklist,
      exists (select 1 from work_item_link l where l.from_id = w.id and l.removed_at is not null) as removed_links,
      w.submitted_at is not null and exists (select 1 from document d where d.work_item_id = w.id
        and d.confirmed_at is not null and d.removed_at is null and d.frozen_at is null) as unfrozen
    from work_item w where w.id = ${item}::uuid`.execute(trx);
  const b = rows[0]!;
  return [
    b.reply_files ? "reply Documents waiting to be sent" : undefined,
    b.reply_checklist ? "a reply checklist waiting to be sent" : undefined,
    b.removed_links ? "a removed Link not yet sent" : undefined,
    b.unfrozen ? "Documents added since it last arrived" : undefined,
  ].filter((x): x is string => x !== undefined);
}

async function ageOne(trx: Transaction<Database>, { id, documentNumber, shiftMs }: AgeItem): Promise<AgedRows> {
  const { rows: locked } = await sql<{ open: boolean; data_as_arrived: unknown; built_ins_as_arrived: unknown; arrivals: number }>`
    select closed_at is null and discarded_at is null and document_number is not null as open, data_as_arrived, built_ins_as_arrived, arrivals
    from work_item where id = ${id}::uuid for update`.execute(trx);
  const item = locked[0];
  if (!item?.open) throw new AgeRefused(`${documentNumber} is no longer open and numbered: nothing was changed`);
  const blocking = await blockers(trx, id);
  if (blocking.length > 0) {
    throw new AgeRefused(`${documentNumber} has ${blocking.join(", ")} at its current Step: moving its times would act as if it left. Age it after its next Transition; nothing was changed`);
  }
  const before = await fingerprint(trx, id);
  const shift = shiftOf(shiftMs);
  const changed: Record<string, number> = {};
  for (const [table, t] of Object.entries(ITEM_TIMES)) {
    if (t.moved.length === 0) continue;
    const sets = t.moved.map((c) => sql`${sql.ref(c)} = ${sql.ref(c)} - ${shift}`);
    if (table === "work_item") sets.push(...ITEM_TIME_MAPS.map((c) => sql`${sql.ref(c)} = ${movedMap(c, shift)}`));
    const result = await sql`update ${sql.table(table)} set ${sql.join(sets)} where ${t.rows(id)}`.execute(trx);
    changed[table] = Number(result.numAffectedRows ?? 0);
  }
  // app.share_answers_on_leaving cleared these as the item "left"; it did not.
  const json = (value: unknown) => (value === null ? null : JSON.stringify(value));
  await sql`update work_item set data_as_arrived = ${json(item.data_as_arrived)}::jsonb,
      built_ins_as_arrived = ${json(item.built_ins_as_arrived)}::jsonb, arrivals = ${item.arrivals}
    where id = ${id}::uuid`.execute(trx);
  if ((await fingerprint(trx, id)) !== before) throw new Error(`${documentNumber}: a row besides its times changed; everything was rolled back`);
  const { rows: chain } = await sql<{ intact: boolean }>`select app.work_item_chain_intact(${id}::uuid) as intact`.execute(trx);
  if (!chain[0]?.intact) throw new Error(`${documentNumber}: its audit chain no longer checks; everything was rolled back`);
  return { id, documentNumber, rows: changed };
}

/**
 * Moves each item's times back by its shift, as the migrator, in one transaction: any refusal or
 * failed check rolls every item back. `dryRun` runs it all and rolls back, so it reports the rows it
 * would change.
 */
export async function ageItems(db: Db, items: AgeItem[], { dryRun }: { dryRun: boolean }): Promise<AgedRows[]> {
  try {
    return await db.transaction().execute(async (trx) => {
      const aged: AgedRows[] = [];
      for (const item of items) aged.push(await ageOne(trx, item));
      if (dryRun) throw new DryRun(aged);
      return aged;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.aged;
    throw error;
  }
}
