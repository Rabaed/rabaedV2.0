import type { Db } from "@rabaed/db";
import { sql } from "kysely";

/**
 * Pins item `id` to Version `versionNo` of its Rabaed Default Type `typeCode`'s Workflow, Steps
 * by key, as an item started on that Version would be (it must be at a Step the Version has):
 * its Step, its Participant's entry Step and its step assignments. As the migrator.
 */
export async function pinToWorkflowVersion(migrator: Db, typeCode: string, versionNo: number, id: string) {
  await sql`
    with old as (
      select v.id as version_id, s.key, s.id as step_id from work_item_type t
      join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.version_no = ${versionNo}
      join workflow_step s on s.workflow_version_id = v.id
      where t.owner_kind = 'rabaed' and t.code = ${typeCode}
    ),
    moved_assignments as (
      update step_assignment a set step_id = o.step_id
      from workflow_step cur, old o
      where a.work_item_id = ${id}::uuid and cur.id = a.step_id and o.key = cur.key
      returning a.id
    )
    update work_item w set
      workflow_version_id = (select distinct version_id from old),
      current_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.current_step_id),
      participant_entered_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.participant_entered_step_id)
    where w.id = ${id}::uuid
  `.execute(migrator);
}
