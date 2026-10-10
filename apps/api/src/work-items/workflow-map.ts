import { readPublishedVersionDefinition, withMember, type Db } from "@rabaed/db";
import {
  closedStepKey,
  holderRole,
  type BaseRole,
  type BilingualText,
  type ModuleKey,
  type StageCategory,
  type WorkItemMapPosition,
  type WorkItemWorkflowMap,
} from "@rabaed/domain";
import { sql } from "kysely";

// A Work Item's Workflow map (RP-438, WF-15; workflow-engine.md §11). The Workflow
// Version the item is pinned to, whole, read through row-level security as every
// Project Member reads it (V20), and where the item is on it as the item read
// knows it (V14): app.step_as_seen gives the viewer's own Participant its current
// Step and anyone else only the Step the item arrived at, which leaves here as that
// Participant's role and never as a Step. A closed item is at the terminal Step its
// outcome reached, which everyone who sees the item may know.

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
      seen_step_key: string;
      holder_mine: boolean | null;
      holder_name: BilingualText | null;
    }>`
      select w.project_id, t.module_key, w.workflow_version_id, w.outcome, w.closed_at, wf.name, wf.version_no,
        s.key as seen_step_key,
        a.participant_id in (select app.current_participant_ids()) as holder_mine,
        holder.legal_name as holder_name
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join app.work_item_workflow(w.id) wf on true
      cross join lateral app.step_as_seen(w.id) seen
      join workflow_step s on s.id = seen.step_id
      left join app.work_item_holder(w.id) a on true
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      where w.id = ${workItemId}::uuid
    `.execute(trx);
    const item = rows[0];
    if (!item) return null;
    const definition = await readPublishedVersionDefinition(trx, item.workflow_version_id);
    if (!definition) return null;

    const { rows: latest } = await sql<{ version_no: number }>`
      select max(v.version_no) as version_no from workflow_version v
      where v.status = 'published'
        and v.workflow_definition_id = (select workflow_definition_id from workflow_version where id = ${item.workflow_version_id}::uuid)
    `.execute(trx);
    const stages = await trx
      .selectFrom("stage")
      .select(["key", "name", "category"])
      .where("project_id", "=", item.project_id)
      .where("module_key", "=", item.module_key)
      .orderBy("sort")
      .orderBy("key")
      .execute();
    const used = [...new Set(definition.steps.flatMap((s) => s.actor?.positions ?? []))];
    const positions =
      used.length === 0
        ? []
        : await trx.selectFrom("position").select(["base_role", "key", "name"]).where("key", "in", used).orderBy("sort").execute();
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
      stages: stages.map((s) => ({ key: s.key, name: s.name as BilingualText, category: s.category as StageCategory })),
      positions: positions.map((p) => ({ role: p.base_role, key: p.key, name: p.name as BilingualText })),
      viewerRole: (viewer?.base_role as BaseRole | undefined) ?? null,
      position: position(item, definition),
    };
  });
}

function position(
  item: { closed_at: Date | null; outcome: string | null; seen_step_key: string; holder_mine: boolean | null; holder_name: BilingualText | null },
  definition: Parameters<typeof holderRole>[0],
): WorkItemMapPosition | null {
  if (item.closed_at) return { kind: "closed", stepKey: item.outcome ? closedStepKey(definition, item.outcome) : null };
  if (item.holder_mine === null) return null;
  // Inside the viewer's own Participant, step_as_seen gave the current Step.
  if (item.holder_mine) return { kind: "own", stepKey: item.seen_step_key };
  // Anyone else: the Step it arrived at, sent only as its role (V14).
  const role = holderRole(definition, item.seen_step_key);
  return role && item.holder_name ? { kind: "company", role, companyName: item.holder_name } : null;
}
