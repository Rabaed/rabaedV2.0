import { withMember, type Db } from "@rabaed/db";
import type { DocumentNumberSegments, WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";

/**
 * The item read with its Document Number part by part (RP-1065, spec RP-1054 C4), for the
 * Submittal Panel's "How this number is built" card. `app.work_item_number_segments` rebuilds
 * the number from the pattern Version it was numbered under and gives the parts only to
 * whoever sees the item, and only when the rebuild is exactly the issued number; otherwise
 * the read has no `numberSegments` and the card stays hidden.
 */
export async function withNumberSegments(db: Db, memberId: string, read: Promise<WorkItemDetail | null>): Promise<WorkItemDetail | null> {
  const item = await read;
  if (!item?.documentNumber) return item;
  const segments = await withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ segments: DocumentNumberSegments | null }>`
      select app.work_item_number_segments(${item.id}::uuid) as segments
    `.execute(trx);
    return rows[0]?.segments ?? null;
  });
  return segments ? { ...item, numberSegments: segments } : item;
}
