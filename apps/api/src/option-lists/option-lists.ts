import { withMember, type Database, type Db } from "@rabaed/db";
import { buildOptionLists, type OptionList, type OptionRow } from "@rabaed/domain";
import type { Transaction } from "kysely";

// Option Lists (RP-279) are Rabaed Defaults that Rabaed Admin edits; the
// customer app only reads them, as every active Member on every Project.
// The app role can't insert, update or delete them (row-level security and
// grants), and this module has nothing that tries.

type Label = { en: string; ar: string };

/** Every list with its options nested, retired ones marked, in the order they were added. */
export async function readOptionLists(trx: Transaction<Database>): Promise<OptionList[]> {
  const lists = await trx.selectFrom("option_list").select(["id", "name"]).orderBy("created_at").orderBy("id").execute();
  const rows = await trx
    .selectFrom("option")
    .select(["id", "option_list_id", "parent_id", "value", "label", "retired"])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return buildOptionLists(lists as { id: string; name: Label }[], rows as OptionRow[]);
}

export function listOptionLists(db: Db, memberId: string): Promise<OptionList[]> {
  return withMember(db, memberId, readOptionLists);
}
