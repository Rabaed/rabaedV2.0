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
import { runningByVersion } from "./workflows.ts";

// Project → Settings → Workflows (RP-441, WF-18; ADR 0016, 0019; visibility.md V15, V18,
// V20). Reads only: every write is WF-4's, Screens', Stages' or outcomes' own command.
// Everything is read through row-level security as the Member, so a Workflow with no
// published Version, a draft, an exception that isn't their Participant's and another
// Company's Library never reach anyone who may not read them.

type Latest = { id: string; name: BilingualText; version_no: number | null };

/** Which Workflow each Work Item Type of the Project runs, its exceptions and, for a Project Admin, the Workflows to bind or copy; null when the Member is not on the Project. */
export function readWorkflowSettings(db: Db, memberId: string, projectId: string): Promise<WorkflowSettings | null> {
  return withMember(db, memberId, (trx) => settingsAsMember(trx, projectId));
}

/**
 * The Workflows Settings lists to the Member on the Project, by id (RP-1299): for a Project Admin
 * every one it names (each Type's, the Rabaed Defaults, the exceptions, the Project's copies); for
 * anyone else only those in use: the one each Type runs and the exceptions they read (V15).
 * It adds no rule of its own: `settingsAsMember` already lists a non-admin only the Rabaed Default
 * in use and no copies, and row-level security gives them only their own exceptions.
 */
const listedWorkflowIds = (settings: WorkflowSettings): Set<string> =>
  new Set(
    settings.types.flatMap((t) => [t.workflow.id, ...t.rabaedDefaults.map((d) => d.id), ...t.exceptions.map((e) => e.workflow.id), ...t.copies.map((c) => c.id)]),
  );

async function settingsAsMember(trx: Db, projectId: string): Promise<WorkflowSettings | null> {
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

  // The Rabaed Defaults made for each Rabaed Type the Project uses (RP-596: a Type may have several,
  // the eight submittal Workflows), as the Project's Members read them (V20: only those with a published Version).
  const rabaedTypeIds = [...byCode.values()].filter((t) => !t.own).map((t) => t.id);
  const defaults =
    rabaedTypeIds.length === 0
      ? { rows: [] }
      : await sql<Latest & { type_id: string }>`
          select d.id, d.name, d.work_item_type_id as type_id, ${latestPublishedVersionNo(sql.ref("d.id"))} as version_no
          from workflow_definition d
          where d.owner_kind = 'rabaed' and d.work_item_type_id = any(${rabaedTypeIds}::uuid[])
          order by coalesce(d.default_key like '%-owner', false), d.default_key nulls first, d.created_at, d.id
        `.execute(trx);
  const rabaedIds = new Set(defaults.rows.map((d) => d.id));

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
          // A Rabaed Default the Project bound (RP-596) is still the Rabaed Default, not a copy of its own.
          workflow: {
            id: running.id,
            name: running.name,
            versionNo: running.version_no,
            source: own && !rabaedIds.has(own.workflow_definition_id) ? "project_copy" : "rabaed_default",
          },
          // A Member who is not a Project Admin is listed only the one in use (RP-1299, owner's decision 2026-11-13).
          rabaedDefaults: defaults.rows
            .filter((d) => d.type_id === t.id && d.version_no !== null && (canEdit || d.id === running.id))
            .map((d) => ({
              id: d.id,
              name: d.name,
              versionNo: d.version_no,
              bound: d.id === running.id,
              isTypeDefault: d.id === t.workflow_definition_id,
            })),
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
}

/**
 * Published Version `versionNo` of Workflow `workflowId`, whole, with the Stages and Positions to draw it,
 * for whoever reads the Workflow off any Project (V20, `readsWorkflowOffProject`, RP-1309); null for anyone else.
 */
export function readWorkflowVersion(db: Db, memberId: string, workflowId: string, versionNo: number): Promise<WorkflowVersionRead | null> {
  return withMember(db, memberId, async (trx) => ((await readsWorkflowOffProject(trx, workflowId)) ? versionAsMember(trx, workflowId, versionNo) : null));
}

/**
 * The same, as Project `projectId`'s Settings opens it (RP-1299): only a Workflow Settings lists
 * to the Member there, so to anyone but a Project Admin only one in use; null otherwise, as for a
 * made-up id.
 */
export function readProjectWorkflowVersion(db: Db, memberId: string, projectId: string, workflowId: string, versionNo: number): Promise<WorkflowVersionRead | null> {
  return withMember(db, memberId, async (trx) => {
    const settings = await settingsAsMember(trx, projectId);
    if (!settings || !listedWorkflowIds(settings).has(workflowId)) return null;
    return versionAsMember(trx, workflowId, versionNo);
  });
}

/**
 * Whether the acting Member reads Workflow `workflowId` through a read with no Project in its path
 * (`GET /v1/workflows/:w`, its map and its Versions; RP-1309, owner's decision 2026-11-14): their own
 * Company's Library Workflow, as row-level security gives it them (V18); any other only when Settings
 * lists it to them on a Project they are on (RP-1299's rule, `listedWorkflowIds`): in use there, or,
 * where they are a Project Admin, every Rabaed Default of its Types and its copies. Anyone else gets
 * the 404 of a made-up id. Row-level security still decides first, so this never widens a read.
 * Duplicate and save to Library take only such a source (RP-1323).
 */
export async function readsWorkflowOffProject(trx: Db, workflowId: string): Promise<boolean> {
  const definition = await trx.selectFrom("workflow_definition").select(["owner_kind"]).where("id", "=", workflowId).executeTakeFirst();
  if (!definition) return false;
  if (definition.owner_kind === "company") return true;
  for (const projectId of await mayListWorkflow(trx, workflowId)) {
    const settings = await settingsAsMember(trx, projectId);
    if (settings && listedWorkflowIds(settings).has(workflowId)) return true;
  }
  return false;
}

/**
 * The Projects the Member is on whose Settings may list Workflow `workflowId` to them, in one query
 * (RP-1323), its own Project first: those where a binding they read names it (a Type's, or an
 * exception's, V15), where a Type of the Project runs it by default (the Project's own Type of
 * that code first, and no binding for the Type), and those they are a Project Admin of where it
 * is one of its copies or a Rabaed Default of a Rabaed Type. It is only a filter: every way
 * `settingsAsMember` lists a Workflow passes it, and `listedWorkflowIds` still decides, so the
 * rule stays RP-1299's. A Workflow listed nowhere costs this query, not one Settings per Project.
 */
async function mayListWorkflow(trx: Db, workflowId: string): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    select p.id
    from workflow_definition d cross join project p
    where d.id = ${workflowId}::uuid
      and (
        exists (select 1 from workflow_binding b where b.project_id = p.id and b.workflow_definition_id = d.id)
        or exists (
          select 1 from work_item_type t
          where t.workflow_definition_id = d.id and (t.project_id is null or t.project_id = p.id)
            and not exists (select 1 from work_item_type o where t.project_id is null and o.project_id = p.id and o.code = t.code)
            and not exists (select 1 from workflow_binding b where b.project_id = p.id and b.work_item_type_id = t.id and b.raising_participant_id is null))
        or (p.id in (select app.current_admin_project_ids()) and (
          (d.owner_kind = 'project' and d.project_id = p.id)
          or (d.owner_kind = 'rabaed' and exists (select 1 from work_item_type t where t.id = d.work_item_type_id and t.project_id is null))))
      )
    order by p.id is distinct from d.project_id, p.created_at, p.id
  `.execute(trx);
  return rows.map((r) => r.id);
}

async function versionAsMember(trx: Db, workflowId: string, versionNo: number): Promise<WorkflowVersionRead | null> {
  const { rows } = await sql<{ id: string; name: BilingualText; project_id: string | null; module_key: ModuleKey | null }>`
    select d.id, d.name, d.project_id, (select t.module_key from work_item_type t where t.id = app.workflow_type(d.id)) as module_key
    from workflow_definition d where d.id = ${workflowId}::uuid
  `.execute(trx);
  const definition = rows[0];
  if (!definition) return null;
  const published = await trx
    .selectFrom("workflow_version")
    .select(["id", "version_no", "published_at"])
    .where("workflow_definition_id", "=", workflowId)
    .where("status", "=", "published")
    .orderBy("version_no")
    .execute();
  const version = published.find((v) => v.version_no === versionNo);
  if (!version) return null;
  const read = await readPublishedVersionDefinition(trx, version.id);
  if (!read) return null;
  // Change Notes: the Workflow's authors only (workflow_change_note's policy); counts: the items the reader sees.
  const changeNotes = await trx
    .selectFrom("workflow_change_note")
    .select(["workflow_version_id", "change_note"])
    .where("workflow_version_id", "in", published.map((v) => v.id))
    .execute();
  const running = await runningByVersion(trx, workflowId);
  return {
    name: definition.name,
    versionNo,
    publishedVersions: published.map((v) => v.version_no),
    history: published.toReversed().map((v) => ({
      versionNo: v.version_no,
      publishedAt: (v.published_at ?? new Date(0)).toISOString(),
      changeNote: changeNotes.find((n) => n.workflow_version_id === v.id)?.change_note ?? null,
      running: running.find((r) => r.versionNo === v.version_no)?.count ?? 0,
    })),
    definition: read,
    stages: definition.module_key === null ? [] : await readModuleStages(trx, definition.module_key, definition.project_id),
    positions: await readPositions(trx, [...new Set(read.steps.flatMap((s) => s.actor?.positions ?? []))]),
  };
}

/** Which published Workflow Versions pin which Screen Version, among the Screens of Project `projectId` (its own); null when the Member isn't on it. */
export function readScreenPins(db: Db, memberId: string, projectId: string): Promise<ScreenPins | null> {
  return withMember(db, memberId, async (trx): Promise<ScreenPins | null> => {
    // Only the Workflows Settings lists to the Member (RP-1299), so no pin links to one they'd get the 404 of.
    const settings = await settingsAsMember(trx, projectId);
    if (!settings) return null;
    const listed = listedWorkflowIds(settings);
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
      pins: rows.filter((r) => listed.has(r.workflow_id)).map((r) => ({
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
