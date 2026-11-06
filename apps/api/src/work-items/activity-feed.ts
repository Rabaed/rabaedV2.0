import { withMember, type Database, type Db } from "@rabaed/db";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  moduleKeys,
  outcomeLook,
  type ActivityFeed,
  type ActivityFeedEntry,
  type ActivityFeedQuery,
  type BilingualText,
  type OutcomeAction,
  type OutcomePolarity,
  type WorkItemOutcome,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";

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
  on_item: boolean;
  by_me: boolean;
};

/**
 * One page of a Project's feed, within the Member's transaction (`withMember`):
 * app.activity_feed answers with nothing for a Project they are not on. Home
 * (RP-407) merges these pages across the Member's Projects.
 */
export async function activityFeedPage(
  trx: Transaction<Database>,
  projectId: string,
  q: ActivityFeedQuery,
): Promise<Pick<ActivityFeed, "entries" | "nextCursor">> {
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
  const chips = await outcomeChips(trx, page.filter((r) => r.outcome !== null).map((r) => r.id));
  return {
    entries: page.map((r) => ({
      id: r.id,
      type: r.type,
      at: r.created_at.toISOString(),
      audience: r.audience,
      by: { companyName: r.company_name, memberName: r.member_name },
      transition: r.transition_label,
      outcome: r.outcome,
      outcomeChip: chips.get(r.id) ?? null,
      workItem: { id: r.work_item_id, documentNumber: r.document_number, title: r.title, type: { code: r.type_code, name: r.type_name } },
      onItem: r.on_item,
      byMe: r.by_me,
    })),
    nextCursor: rows.length > q.limit && last ? encodeActivityCursor(last.id) : null,
  };
}

/**
 * How the page shows each of these events' outcome (RP-1157): its look, from its place in its Type's
 * outcome set, and its own name unless it is a Review Code, as Home names it. `events` are the page's
 * own, so read through the same RLS as the feed: only the outcomes it already shows.
 */
async function outcomeChips(trx: Transaction<Database>, events: string[]): Promise<Map<string, ActivityFeedEntry["outcomeChip"]>> {
  const chips = new Map<string, ActivityFeedEntry["outcomeChip"]>();
  if (events.length === 0) return chips;
  const { rows } = await sql<{
    id: string;
    code: string;
    named: boolean;
    name: BilingualText;
    outcome_set: { code: string; polarity: OutcomePolarity; actions: OutcomeAction[] }[];
  }>`
    -- A Review Code reads "Code B"; any other outcome by its own name (an Inspection Result, an
    -- Approval…), as Home's recent activity names it (RP-673).
    select e.id, o.code, (wt.outcome_kind <> 'review_code' or e.type <> 'issue_code') as named, o.name,
      (select jsonb_agg(jsonb_build_object('code', s.code, 'polarity', s.polarity, 'actions', s.actions) order by s.sort)
        from outcome s where s.project_id = o.project_id and s.work_item_type_id = o.work_item_type_id) as outcome_set
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    join work_item_type wt on wt.id = w.work_item_type_id
    join outcome o on o.project_id = e.project_id and o.work_item_type_id = w.work_item_type_id and o.code = e.payload ->> 'outcome'
    where e.id = any(${events}::uuid[])
  `.execute(trx);
  for (const r of rows) {
    const set = r.outcome_set.map((o) => ({ ...o, actions: o.actions ?? [] }));
    const own = set.find((o) => o.code === r.code);
    if (own) chips.set(r.id, { name: r.named ? r.name : null, look: outcomeLook(own, set) });
  }
  return chips;
}

/** One page of the feed of one of the Member's Projects, or null when it isn't one of theirs. */
export function getActivityFeed(db: Db, memberId: string, projectId: string, q: ActivityFeedQuery): Promise<ActivityFeed | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    // The Project's Types, for the Module and Type filters: names only, no counts.
    const types = await trx
      .selectFrom("work_item_type")
      .select(["module_key", "code", "name"])
      .where((eb) => eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]))
      .orderBy("code")
      .execute();
    return {
      ...(await activityFeedPage(trx, projectId, q)),
      types: moduleKeys.flatMap((moduleKey) =>
        types.filter((t) => t.module_key === moduleKey).map((t) => ({ code: t.code, name: t.name as BilingualText, moduleKey })),
      ),
    };
  });
}
