import { readModuleStages, readPublishedVersionDefinition, withMember, type Db } from "@rabaed/db";
import { withRaiserRole, type BaseRole, type ModuleKey, type NewItemRoutePreview } from "@rabaed/domain";
import { sql } from "kysely";
import { newItemWorkflowVersionId } from "./work-items.ts";

// The New item's route preview (RP-1152, gap rows 22, 34 and 35): before an item exists, the
// Workflow a new item of a Type would run for the raiser's Participant, as the create resolves it
// (newItemWorkflowVersionId, app.new_item_workflow_version), shaped as the item's map gives it
// (workflow-map.ts): the raiser's Steps held by the raiser's role. A Workflow is a description
// (V20), readable through workflow-settings and the map already; the preview adds the Draft
// Step's "Drafts visible to" (V1) and names no Company and no Member (V15).

/**
 * The route preview of a new item of the Rabaed Default Type `typeCode` for the Member on
 * `projectId`. Null, the 404 that names nothing, when it isn't one of their Projects or the Type
 * isn't one they may raise there (app.raisable_type_ids, the rule the create checks).
 */
export function readNewItemRoutePreview(db: Db, memberId: string, projectId: string, typeCode: string): Promise<NewItemRoutePreview | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ module_key: ModuleKey; raiser_role: BaseRole }>`
      select t.module_key, r.base_role as raiser_role
      from work_item_type t
      join app.raisable_type_ids(${projectId}::uuid, t.module_key) raisable on raisable.work_item_type_id = t.id
      cross join lateral (
        select pr.base_role from project_member pm
        join participant p on p.id = pm.participant_id
        join project_role pr on pr.id = p.project_role_id
        where pm.project_id = ${projectId}::uuid and pm.member_id = app.current_member_id() and pm.status = 'active'
          and pm.participant_id in (select app.current_participant_ids())
      ) r
      where t.owner_kind = 'rabaed' and t.code = ${typeCode}
    `.execute(trx);
    const type = rows[0];
    if (!type) return null;
    const versionId = await newItemWorkflowVersionId(trx, projectId, typeCode);
    const read = versionId && (await readPublishedVersionDefinition(trx, versionId));
    if (!read) return null;
    const stages = await readModuleStages(trx, type.module_key, projectId);
    const draftKeys = new Set(stages.filter((s) => s.category === "draft").map((s) => s.key));
    const draft = read.steps.find((s) => draftKeys.has(s.stage));
    return {
      definition: withRaiserRole(read, type.raiser_role),
      stages,
      // Left out on the Draft Step: the raiser's whole Company (V1).
      draftsVisibleTo: draft?.draftsVisibleTo ?? "company",
    };
  });
}
