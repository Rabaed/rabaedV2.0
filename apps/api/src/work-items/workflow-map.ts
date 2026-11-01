import { latestPublishedVersionNo, readModuleStages, readPositions, readPublishedVersionDefinition, withMember, type Db } from "@rabaed/db";
import {
  closedStepKey,
  withRaiserRole,
  type BaseRole,
  type BilingualText,
  type ModuleKey,
  type WorkflowDefinition,
  type WorkItemMapPosition,
  type WorkItemWorkflowMap,
} from "@rabaed/domain";
import { sql } from "kysely";

// A Work Item's Workflow map (RP-438, WF-15; workflow-engine.md §11). The Workflow
// Version the item is pinned to, whole, read through row-level security as every
// Project Member reads it (V20), and where the item is on it as the item read
// knows it (V14): app.step_as_seen gives the viewer's own Participant its current
// Step and anyone else no Step, only the role holding it (RP-1192). A closed item is
// at the terminal Step its outcome reached, which everyone who sees the item may know.

/** The map of item `workItemId` for the Member; null when they don't see the item or can't read its Workflow. */
export function readWorkItemWorkflowMap(db: Db, memberId: string, workItemId: string): Promise<WorkItemWorkflowMap | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{
      project_id: string;
      module_key: ModuleKey;
      workflow_version_id: string;
      outcome: string | null;
      closed_at: Date | null;
      name: BilingualText;
      version_no: number;
      seen_step_key: string | null;
      holder_role: BaseRole | null;
      holder_mine: boolean | null;
      holder_name: BilingualText | null;
      raiser_role: BaseRole | null;
    }>`
      select w.project_id, t.module_key, w.workflow_version_id, w.outcome, w.closed_at, wf.name, wf.version_no,
        s.key as seen_step_key, seen.holder_role, app.work_item_raiser_role(w.id) as raiser_role,
        -- At the Owner's review, "Owner review" to all but its holder and the recommending Consultant (ADR 0022):
        -- no holder reaches them (RP-1138), and the item is held outside their Participant.
        case when r.label is not null then false else a.participant_id in (select app.current_participant_ids()) end as holder_mine,
        coalesce(r.label, holder.legal_name) as holder_name
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join app.work_item_workflow(w.id) wf on true
      cross join lateral app.step_as_seen(w.id) seen
      -- No Step while another Company holds it: app.step_as_seen gives none (RP-1192).
      left join workflow_step s on s.id = seen.step_id
      -- db-mask: app.work_item_holder_unchecked (app.work_item_holder gives no holder where this label is read).
      cross join lateral (select app.with_owner_review(w.id) as label) r
      left join app.work_item_holder(w.id) a on true
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      where w.id = ${workItemId}::uuid
    `.execute(trx);
    const item = rows[0];
    if (!item) return null;
    const read = await readPublishedVersionDefinition(trx, item.workflow_version_id);
    if (!read) return null;
    // A Step held by the raiser (RP-622) is held by the item's raiser's role here.
    const definition = item.raiser_role ? withRaiserRole(read, item.raiser_role) : read;

    const { rows: latest } = await sql<{ version_no: number | null }>`
      select ${latestPublishedVersionNo(sql.ref("v.workflow_definition_id"))} as version_no
      from workflow_version v where v.id = ${item.workflow_version_id}::uuid
    `.execute(trx);
    const viewer = await trx
      .selectFrom("participant as p")
      .innerJoin("project_role as r", "r.id", "p.project_role_id")
      .select("r.base_role")
      .where("p.project_id", "=", item.project_id)
      .where("p.id", "in", sql<string>`(select app.current_participant_ids())`)
      .executeTakeFirst();

    return {
      name: item.name,
      versionNo: item.version_no,
      latestVersionNo: latest[0]?.version_no ?? item.version_no,
      definition,
      stages: await readModuleStages(trx, item.module_key, item.project_id),
      positions: await readPositions(trx, [...new Set(definition.steps.flatMap((s) => s.actor?.positions ?? []))]),
      viewerRole: (viewer?.base_role as BaseRole | undefined) ?? null,
      position: position(item, definition),
    };
  });
}

function position(
  item: {
    closed_at: Date | null;
    outcome: string | null;
    seen_step_key: string | null;
    holder_role: BaseRole | null;
    holder_mine: boolean | null;
    holder_name: BilingualText | null;
  },
  definition: WorkflowDefinition,
): WorkItemMapPosition | null {
  if (item.closed_at) return { kind: "closed", stepKey: item.outcome ? closedStepKey(definition, item.outcome) : null };
  if (item.holder_mine === null) return null;
  // Inside the viewer's own Participant, step_as_seen gave the current Step.
  if (item.holder_mine) return item.seen_step_key ? { kind: "own", stepKey: item.seen_step_key } : null;
  // Anyone else: the role holding it, never a Step (V14).
  return item.holder_role && item.holder_name ? { kind: "company", role: item.holder_role, companyName: item.holder_name } : null;
}
