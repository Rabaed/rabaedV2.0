import type { Db } from "@rabaed/db";
import { sql } from "kysely";

// Items in flight on a retired Rabaed Default Version (RP-437 review, product owner
// 2026-10-11). Retiring Form Sections filled by another Participant (ADR 0019) left two
// kinds of open item unable to finish on the Versions they pinned, so `pnpm
// defaults:publish` moves them on, once the Versions they move to are published (a
// migration runs before them, so it can't):
//
// - an open Comment on the Comment Form Version 1 and Workflow Version 1: Version 1's
//   Resolution section, the Contractor's to fill at Open, can no longer be saved, so its
//   Resolve could never be taken. It moves to the latest Comment Workflow (its Resolve
//   shows the Screen `comment_resolution`) and Form, Step by Step key (the same Steps).
// - an open MAR on the MAR Form Version 4 and Workflow Version 2: the Consultant could
//   no longer record its verification in the Form. It moves to the latest MAR Workflow
//   (Version 3), keeping its Form: the Draft and the Contractor's review to the Steps of
//   the same key, the Consultant's review to the Consultant Engineer Step, whose reply
//   ("Consultant review") records the verification and pre-fills the Manager's Code.
//
// Its holder stays when they may hold the new Step; otherwise the Step goes back to its
// pool, which a pool of one holds at once (ADR 0018). History, Documents, answers and
// access stay as they are. Run again, it moves nothing.

/** A move of one Type's open items from one Workflow Version (and Form Version) to the latest Workflow Version. */
type Move = {
  type: string;
  workflowVersionNo: number;
  formVersionNo: number;
  /** The new Step's key by the old Step's; an item at a Step not named stays. */
  steps: Record<string, string>;
  /** Whether the item also moves to the latest published Form Version. */
  latestForm: boolean;
};

const moves: readonly Move[] = [
  { type: "CMT", workflowVersionNo: 1, formVersionNo: 1, steps: { draft: "draft", open: "open", resolved: "resolved" }, latestForm: true },
  {
    type: "MAR",
    workflowVersionNo: 2,
    formVersionNo: 4,
    steps: { draft: "draft", internal_review: "internal_review", consultant_review: "consultant_engineer" },
    latestForm: false,
  },
];

/** How many open items each Type moved. */
export type InFlightMoved = { type: string; moved: number }[];

/** Moves the Rabaed Default Types' open items off the retired Versions above, connected as the migrator, in one transaction. */
export async function moveInFlightItems(migratorDb: Db): Promise<InFlightMoved> {
  return migratorDb.transaction().execute(async (trx) => {
    const done: InFlightMoved = [];
    for (const move of moves) done.push({ type: move.type, moved: await moveItems(trx, move) });
    return done;
  });
}

async function moveItems(trx: Db, move: Move): Promise<number> {
  const { rows } = await sql<{ id: string }>`
    with t as (
      select id, workflow_definition_id, form_definition_id from work_item_type where owner_kind = 'rabaed' and code = ${move.type}
    ),
    old_wf as (
      select v.id from workflow_version v join t on t.workflow_definition_id = v.workflow_definition_id
      where v.version_no = ${move.workflowVersionNo} and v.status = 'published'
    ),
    new_wf as (
      select v.id from workflow_version v join t on t.workflow_definition_id = v.workflow_definition_id
      where v.status = 'published' and v.version_no > ${move.workflowVersionNo}
      order by v.version_no desc limit 1
    ),
    old_form as (
      select f.id from form_version f join t on t.form_definition_id = f.form_definition_id
      where f.version_no = ${move.formVersionNo} and f.status = 'published'
    ),
    new_form as (
      select f.id from form_version f join t on t.form_definition_id = f.form_definition_id
      where f.status = 'published' order by f.version_no desc limit 1
    ),
    steps as (
      select o.id as old_id, n.id as new_id
      from jsonb_each_text(${JSON.stringify(move.steps)}::jsonb) k (old_key, new_key)
      join workflow_step o on o.key = k.old_key and o.workflow_version_id = (select id from old_wf)
      join workflow_step n on n.key = k.new_key and n.workflow_version_id = (select id from new_wf)
    ),
    items as (
      select w.id from work_item w join t on t.id = w.work_item_type_id
      where w.closed_at is null
        and w.workflow_version_id = (select id from old_wf)
        and w.form_version_id = (select id from old_form)
        and w.current_step_id in (select old_id from steps)
      for update of w
    ),
    open_assignments as (
      update step_assignment a set step_id = s.new_id, updated_at = now()
      from steps s
      where a.step_id = s.old_id and a.work_item_id in (select id from items) and a.status in ('pooled', 'picked_up', 'vacant')
      returning a.id
    )
    update work_item w set
      workflow_version_id = (select id from new_wf),
      current_step_id = (select s.new_id from steps s where s.old_id = w.current_step_id),
      participant_entered_step_id = coalesce((select s.new_id from steps s where s.old_id = w.participant_entered_step_id), w.participant_entered_step_id),
      form_version_id = ${move.latestForm ? sql`(select id from new_form)` : sql`w.form_version_id`},
      updated_at = now()
    where w.id in (select id from items)
    returning w.id
  `.execute(trx);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  // A holder who may not hold the new Step gives it back to its pool, which a pool of one holds at once.
  await sql`
    update step_assignment a set status = 'pooled', assignee_member_id = null, picked_up_at = null, updated_at = now()
    where a.work_item_id = any(${ids}::uuid[]) and a.status = 'picked_up'
      and a.assignee_member_id not in (select p.member_id from app.step_pool(a.work_item_id, a.step_id, a.participant_id) p)
  `.execute(trx);
  await sql`
    select app.hold_pool_of_one(a.id) from step_assignment a
    where a.work_item_id = any(${ids}::uuid[]) and a.status = 'pooled'
  `.execute(trx);
  return ids.length;
}
