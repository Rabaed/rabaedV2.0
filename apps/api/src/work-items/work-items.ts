import { withMember, type Database, type Db } from "@rabaed/db";
import {
  stepAgeWeeks,
  type BilingualText,
  type CreateWorkItemRequest,
  type WorkItemDetail,
  type WorkItemList,
  type WorkItemSummary,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";
import { refusedAsForbidden } from "../db-error.ts";

// Work Items. Writes go through the app.* functions of the work items migration;
// reads go through RLS, which answers only with the items the Member can see
// (data-model.md §10). Lists and Stage counts come from the same query, so a
// count can never include an item the list hides.

type Trx = Transaction<Database>;

export type CreateWorkItemResult =
  | { ok: true; id: string }
  | { ok: false; reason: "forbidden" }
  | {
      ok: false;
      reason: "not_found" | "project_closed" | "type_not_found" | "trade_required" | "value_not_found" | "outside_visibility";
    };

type SummaryRow = {
  id: string;
  project_id: string;
  type_code: string;
  type_name: BilingualText;
  title: string;
  document_number: string | null;
  stage_key: string;
  stage_name: BilingualText;
  stage_category: WorkItemSummary["stage"]["category"];
  trade_id: string;
  trade_code: string;
  trade_name: BilingualText;
  location_id: string | null;
  location_code: string | null;
  location_name: BilingualText | null;
  step_entered_at: Date;
};

/** The visible Work Items matching `where`, as list rows. */
function visibleItems(trx: Trx, where: RawBuilder<unknown>) {
  return sql<SummaryRow>`
    select w.id, w.project_id, t.code as type_code, t.name as type_name, w.title, w.document_number,
      st.key as stage_key, st.name as stage_name, st.category as stage_category,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      w.step_entered_at
    from work_item w
    join work_item_type t on t.id = w.work_item_type_id
    join stage st on st.module_key = t.module_key and st.key = w.current_stage_key and st.project_id is null
    join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
    join work_item_dimension_value tdv on tdv.work_item_id = w.id and tdv.dimension_id = td.id
    join dimension_value tv on tv.id = tdv.dimension_value_id
    join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
    left join work_item_dimension_value ldv on ldv.work_item_id = w.id and ldv.dimension_id = ld.id
    left join dimension_value lv on lv.id = ldv.dimension_value_id
    where ${where}
    order by w.step_entered_at desc, w.id desc
  `
    .execute(trx)
    .then((r) => r.rows);
}

function toSummary(r: SummaryRow, now: Date): WorkItemSummary {
  return {
    id: r.id,
    projectId: r.project_id,
    type: { code: r.type_code, name: r.type_name },
    title: r.title,
    documentNumber: r.document_number,
    stage: { key: r.stage_key, name: r.stage_name, category: r.stage_category },
    trade: { id: r.trade_id, code: r.trade_code, name: r.trade_name },
    location: r.location_id ? { id: r.location_id, code: r.location_code!, name: r.location_name! } : null,
    stepEnteredAt: r.step_entered_at.toISOString(),
    stepAgeWeeks: stepAgeWeeks(r.step_entered_at, now),
  };
}

/** A Member creates a Work Item in Draft on one of their Projects. */
export function createWorkItem(
  db: Db,
  memberId: string,
  projectId: string,
  input: Required<CreateWorkItemRequest>,
  now: Date,
): Promise<CreateWorkItemResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<CreateWorkItemResult> => {
      const { rows } = await sql<{
        outcome: "created" | Exclude<CreateWorkItemResult, { ok: true }>["reason"];
        work_item_id: string | null;
      }>`
        select outcome, work_item_id from app.create_work_item(
          ${projectId}::uuid, ${input.type}, ${input.title}, ${input.description},
          ${input.tradeId}::uuid, ${input.locationId}::uuid, ${now})
      `.execute(trx);
      const { outcome, work_item_id } = rows[0]!;
      return outcome === "created" ? { ok: true, id: work_item_id! } : { ok: false, reason: outcome };
    }),
  );
}

/**
 * The Submittals of one of the Member's Projects that they can see, with every
 * Stage and how many of those items are in it; null when it isn't one of their Projects.
 */
export function listWorkItems(db: Db, memberId: string, projectId: string, now: Date): Promise<WorkItemList | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const items = (await visibleItems(trx, sql`w.project_id = ${projectId}`)).map((r) => toSummary(r, now));
    const stages = await trx
      .selectFrom("stage")
      .select(["key", "name", "category"])
      .where("module_key", "=", "submittals")
      .where("project_id", "is", null)
      .orderBy("sort")
      .execute();
    return {
      stages: stages.map((s) => ({ ...s, count: items.filter((i) => i.stage.key === s.key).length })),
      items,
    };
  });
}

/** One Work Item, or null when the Member can't see it (exactly as if it didn't exist). */
export function getWorkItem(db: Db, memberId: string, workItemId: string, now: Date): Promise<WorkItemDetail | null> {
  return withMember(db, memberId, async (trx) => {
    const [row] = await visibleItems(trx, sql`w.id = ${workItemId}`);
    if (!row) return null;
    const { rows } = await sql<{
      data: Record<string, unknown>;
      created_at: Date;
      step_key: string;
      step_name: BilingualText;
      raised_by: BilingualText;
      held_by: BilingualText | null;
      holder_name: BilingualText | null;
    }>`
      select w.data, w.created_at, s.key as step_key, s.name as step_name,
        raiser.legal_name as raised_by, holder.legal_name as held_by, m.full_name as holder_name
      from work_item w
      join workflow_step s on s.id = w.current_step_id
      join app.project_participants(w.project_id) raiser on raiser.participant_id = w.raised_by_participant_id
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
      left join app.project_participants(w.project_id) holder on holder.participant_id = a.participant_id
      -- member's own RLS shows only the viewer's own Company's people (V14).
      left join member m on m.id = a.assignee_member_id
      where w.id = ${workItemId}
    `.execute(trx);
    const d = rows[0]!;
    return {
      ...toSummary(row, now),
      description: typeof d.data.description === "string" ? d.data.description : "",
      step: { key: d.step_key, name: d.step_name },
      raisedBy: { companyName: d.raised_by },
      heldBy: d.held_by ? { companyName: d.held_by, memberName: d.holder_name } : null,
      createdAt: d.created_at.toISOString(),
    };
  });
}
