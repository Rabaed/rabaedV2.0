import { withMember, type Db } from "@rabaed/db";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityFeed,
  type ActivityFeedEntry,
  type ActivityFeedQuery,
  type BilingualText,
  type WorkItemOutcome,
} from "@rabaed/domain";
import { sql } from "kysely";

// The Activity Feed (RP-353, spec RP-344; visibility.md "Activity Feed"): the
// Project's Work Item events as the Member may see them, through
// app.activity_feed, which reads with the same RLS as an item's history (layers
// 3 to 5, V5) and names another Company by its name only (V14). Answer changes
// are left out (V19). Newest first, a page at a time.

type Row = {
  id: string;
  created_at: Date;
  type: ActivityFeedEntry["type"];
  audience: "shared" | "internal";
  company_name: BilingualText | null;
  member_name: BilingualText | null;
  transition_label: BilingualText | null;
  outcome: WorkItemOutcome | null;
  work_item_id: string;
  document_number: string | null;
  title: string;
  type_code: string;
  type_name: BilingualText;
};

/** One page of the feed of one of the Member's Projects, or null when it isn't one of theirs. */
export function getActivityFeed(db: Db, memberId: string, projectId: string, q: ActivityFeedQuery): Promise<ActivityFeed | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    // The query schema refused any cursor that isn't one.
    const after = q.cursor === undefined ? null : decodeActivityCursor(q.cursor);
    const { rows } = await sql<Row>`
      select * from app.activity_feed(
        ${projectId}::uuid, ${q.module ?? null}::text, ${q.type}::text[], ${q.mine}::boolean,
        ${after?.id ?? null}::uuid, ${q.limit + 1}::integer
      )
    `.execute(trx);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      entries: page.map((r) => ({
        id: r.id,
        type: r.type,
        at: r.created_at.toISOString(),
        audience: r.audience,
        by: { companyName: r.company_name, memberName: r.member_name },
        transition: r.transition_label,
        outcome: r.outcome,
        workItem: { id: r.work_item_id, documentNumber: r.document_number, title: r.title, type: { code: r.type_code, name: r.type_name } },
      })),
      nextCursor: rows.length > q.limit && last ? encodeActivityCursor(last.id) : null,
    };
  });
}
