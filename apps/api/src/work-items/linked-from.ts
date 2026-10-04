import { withMember, type Db } from "@rabaed/db";
import type { LinkedFrom } from "@rabaed/domain";
import { sql } from "kysely";

// "Linked from" (RP-292; form-engine.md part 2b; visibility.md E3). The
// database decides what comes back: app.work_item_linked_from lists only
// Submitted items linking to an item the Member sees, each as its Document
// Number and Subject, with its id only when the Member sees it too. A hidden
// linking item's id never reaches the API, let alone the browser.

/** The Submitted items linking to a visible item, by Document Number; null when the Member can't see the item. */
export function getLinkedFrom(db: Db, memberId: string, workItemId: string): Promise<LinkedFrom | null> {
  return withMember(db, memberId, async (trx) => {
    const visible = await trx.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst();
    if (!visible) return null;
    const { rows } = await sql<{ document_number: string; subject: string; work_item_id: string | null }>`
      select document_number, subject, work_item_id from app.work_item_linked_from(${workItemId}::uuid)
    `.execute(trx);
    return {
      items: rows.map((r) => ({ documentNumber: r.document_number, subject: r.subject, workItemId: r.work_item_id })),
    };
  });
}
