import { latestPublishedVersionNo, readModuleStages, readPositions, readPublishedVersionDefinition, withMember, type Db } from "@rabaed/db";
import {
  moduleKeys,
  type BilingualText,
  type ModuleKey,
  type ScreenPins,
  type WorkflowSettings,
  type WorkflowSettingsType,
  type WorkflowVersionRead,
} from "@rabaed/domain";
import { sql } from "kysely";
import { isProjectAdmin } from "./project-admin.ts";

// Project → Settings → Workflows (RP-441, WF-18; ADR 0016, 0019; visibility.md V15, V18,
// V20). Reads only: every write is WF-4's, Screens', Stages' or outcomes' own command.
// Everything is read through row-level security as the Member, so a Workflow with no
// published Version, a draft, an exception that isn't their Participant's and another
// Company's Library never reach anyone who may not read them.

type Latest = { id: string; name: BilingualText; version_no: number | null };

/** Which Workflow each Work Item Type of the Project runs, its exceptions and, for a Project Admin, the Workflows to bind or copy; null when the Member is not on the Project. */
export function readWorkflowSettings(db: Db, memberId: string, projectId: string): Promise<WorkflowSettings | null> {
  return withMember(db, memberId, async (trx): Promise<WorkflowSettings | null> => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const canEdit = await isProjectAdmin(trx, projectId);

    const types = await sql<{ id: string; code: string; name: BilingualText; module_key: ModuleKey; workflow_definition_id: string; own: boolean }>`
      select t.id, t.code, t.name, t.module_key, t.workflow_definition_id, t.project_id is not null as own
      from work_item_type t where t.project_id is null or t.project_id = ${projectId}::uuid
    `.execute(trx);
    // The Project's own Type of a code first, as app.project_type_id.
    const byCode = new Map<string, (typeof types.rows)[number]>();
    for (const t of types.rows) if (!byCode.has(t.code) || t.own) byCode.set(t.code, t);

    const named = async (ids: string[]): Promise<Map<string, Latest>> => {
      if (ids.length === 0) return new Map();
      const { rows } = await sql<Latest>`
        select d.id, d.name, ${latestPublishedVersionNo(sql.ref("d.id"))} as version_no
        from workflow_definition d where d.id = any(${ids}::uuid[])
      `.execute(trx);
      return new Map(rows.map((r) => [r.id, r]));
    };
    const bindings = await sql<{ work_item_type_id: string; raising_participant_id: string | null; workflow_definition_id: string }>`
      select work_item_type_id, raising_participant_id, workflow_definition_id from workflow_binding where project_id = ${projectId}::uuid
    `.execute(trx);
    const companies = await sql<{ participant_id: string; legal_name: BilingualText }>`
      select participant_id, legal_name from app.project_participants(${projectId}::uuid)
    `.execute(trx);
    const workflows = await named([...new Set([...byCode.values()].map((t) => t.workflow_definition_id).concat(bindings.rows.map((b) => b.workflow_definition_id)))]);
    const pick = (id: string) => workflows.get(id);

    // The Project's own Workflows, for a Project Admin (their authors), each with its latest Version and whether a draft waits.
    const copies = canEdit
      ? await sql<Latest & { type_id: string | null; has_draft: boolean }>`
          select d.id, d.name, app.workflow_type(d.id) as type_id, ${latestPublishedVersionNo(sql.ref("d.id"))} as version_no,
            exists (select 1 from app.workflow_draft(d.id)) as has_draft
          from workflow_definition d
          where d.owner_kind = 'project' and d.project_id = ${projectId}::uuid order by d.created_at, d.id
        `.execute(trx)
      : { rows: [] };

    const result: WorkflowSettingsType[] = [...byCode.values()]
      .sort((a, b) => moduleKeys.indexOf(a.module_key) - moduleKeys.indexOf(b.module_key) || a.code.localeCompare(b.code))
      .flatMap((t): WorkflowSettingsType[] => {
        const own = bindings.rows.find((b) => b.work_item_type_id === t.id && b.raising_participant_id === null);
        const running = pick(own?.workflow_definition_id ?? t.workflow_definition_id);
        if (!running) return [];
        return [
          {
            id: t.id,
            code: t.code,
            name: t.name,
            moduleKey: t.module_key,
            workflow: { id: running.id, name: running.name, versionNo: running.version_no, source: own ? "project_copy" : "rabaed_default" },
            exceptions: bindings.rows
              .filter((b) => b.work_item_type_id === t.id && b.raising_participant_id !== null)
              .flatMap((b) => {
                const w = pick(b.workflow_definition_id);
                const company = companies.rows.find((c) => c.participant_id === b.raising_participant_id);
                return w && company
                  ? [{ participantId: b.raising_participant_id!, companyName: company.legal_name, workflow: { id: w.id, name: w.name, versionNo: w.version_no } }]
                  : [];
              }),
            copies: copies.rows
              .filter((c) => c.type_id === t.id)
              .map((c) => ({ id: c.id, name: c.name, versionNo: c.version_no, bound: own?.workflow_definition_id === c.id, hasDraft: c.has_draft })),
          },
        ];
      });

    // The Library: the Member's own Company's Workflows with a published Version, per Type, for a Project Admin.
    const library = canEdit
      ? await sql<{ id: string; name: BilingualText; version_no: number; work_item_type_id: string }>`
          select d.id, d.name, d.work_item_type_id, ${latestPublishedVersionNo(sql.ref("d.id"))} as version_no
          from workflow_definition d
          where d.owner_kind = 'company' and d.company_id = app.current_company_id()
            and exists (select 1 from workflow_version v where v.workflow_definition_id = d.id and v.status = 'published')
          order by d.created_at, d.id
        `.execute(trx)
      : { rows: [] };
    return {
      canEdit,
      types: result,
      library: library.rows
        .filter((l) => result.some((t) => t.id === l.work_item_type_id))
        .map((l) => ({ id: l.id, name: l.name, versionNo: l.version_no, workItemTypeId: l.work_item_type_id })),
    };
  });
}

/** Published Version `versionNo` of Workflow `workflowId`, whole, with the Stages and Positions to draw it, for whoever reads the Workflow (V20); null for anyone else. */
export function readWorkflowVersion(db: Db, memberId: string, workflowId: string, versionNo: number): Promise<WorkflowVersionRead | null> {
  return withMember(db, memberId, async (trx): Promise<WorkflowVersionRead | null> => {
    const { rows } = await sql<{ id: string; name: BilingualText; project_id: string | null; module_key: ModuleKey | null }>`
      select d.id, d.name, d.project_id, (select t.module_key from work_item_type t where t.id = app.workflow_type(d.id)) as module_key
      from workflow_definition d where d.id = ${workflowId}::uuid
    `.execute(trx);
    const definition = rows[0];
    if (!definition) return null;
    const published = await trx
      .selectFrom("workflow_version")
      .select(["id", "version_no"])
      .where("workflow_definition_id", "=", workflowId)
      .where("status", "=", "published")
      .orderBy("version_no")
      .execute();
    const version = published.find((v) => v.version_no === versionNo);
    if (!version) return null;
    const read = await readPublishedVersionDefinition(trx, version.id);
    if (!read) return null;
    return {
      name: definition.name,
      versionNo,
      publishedVersions: published.map((v) => v.version_no),
      definition: read,
      stages: definition.module_key === null ? [] : await readModuleStages(trx, definition.module_key, definition.project_id),
      positions: await readPositions(trx, [...new Set(read.steps.flatMap((s) => s.actor?.positions ?? []))]),
    };
  });
}

/** Which published Workflow Versions pin which Screen Version, among the Screens of Project `projectId` (its own); null when the Member isn't on it. */
export function readScreenPins(db: Db, memberId: string, projectId: string): Promise<ScreenPins | null> {
  return withMember(db, memberId, async (trx): Promise<ScreenPins | null> => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const { rows } = await sql<{
      screen_id: string;
      screen_key: string;
      screen_version_no: number;
      workflow_id: string;
      workflow_name: BilingualText;
      workflow_version_no: number;
    }>`
      select distinct s.id as screen_id, s.key as screen_key, sv.version_no as screen_version_no,
        d.id as workflow_id, d.name as workflow_name, wv.version_no as workflow_version_no
      from workflow_transition t
      join screen_version sv on sv.id = t.screen_version_id
      join screen s on s.id = sv.screen_id and s.owner_kind = 'project' and s.project_id = ${projectId}::uuid
      join workflow_version wv on wv.id = t.workflow_version_id and wv.status = 'published'
      join workflow_definition d on d.id = wv.workflow_definition_id
      order by s.key, sv.version_no, d.name, wv.version_no
    `.execute(trx);
    return {
      pins: rows.map((r) => ({
        screenId: r.screen_id,
        screenKey: r.screen_key,
        screenVersionNo: r.screen_version_no,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        workflowVersionNo: r.workflow_version_no,
      })),
    };
  });
}
