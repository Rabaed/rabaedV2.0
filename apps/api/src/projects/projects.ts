import { withMember, type Database, type Db } from "@rabaed/db";
import { moduleKeys, type CreateProjectRequest, type ModuleKey, type ProjectSummary } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";

export type CreateProjectResult = { ok: true; projectId: string; projectNumber: number } | Forbidden;

/**
 * A Project Creator creates a Project. app.create_project checks the flag, takes
 * the Host Company's next Project Number and makes the creator's Company a
 * Participant and the creator a Project Member and Project Admin, in one transaction.
 */
export function createProject(db: Db, memberId: string, input: CreateProjectRequest): Promise<CreateProjectResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ project_id: string; project_number: number }>`
        select project_id, project_number
        from app.create_project(${JSON.stringify(input.name)}::jsonb, ${input.code}, ${input.role})
      `.execute(trx);
      return { ok: true, projectId: rows[0]!.project_id, projectNumber: rows[0]!.project_number } as const;
    }),
  );
}

/**
 * The Projects the Member is on, each with the Project Role their Company plays.
 * No filter on who may see what: RLS returns only the Member's own Projects.
 */
function selectProjects(trx: Transaction<Database>, memberId: string) {
  return trx
    .selectFrom("project as p")
    .innerJoin("project_member as pm", (join) =>
      join.onRef("pm.project_id", "=", "p.id").on("pm.member_id", "=", memberId).on("pm.status", "=", "active"),
    )
    .innerJoin("participant as pt", "pt.id", "pm.participant_id")
    .innerJoin("project_role as r", "r.id", "pt.project_role_id")
    .leftJoin("project_admin as pa", (join) => join.onRef("pa.project_id", "=", "p.id").on("pa.member_id", "=", memberId))
    .select([
      "p.id",
      "p.project_number as projectNumber",
      "p.code",
      "p.name",
      "p.status",
      "r.base_role as baseRole",
      "r.name as roleName",
      sql<boolean>`pa.id is not null`.as("isProjectAdmin"),
    ]);
}

type ProjectRow = Awaited<ReturnType<ReturnType<typeof selectProjects>["executeTakeFirstOrThrow"]>>;

/**
 * Per Project, what its card and shell show besides its row: the Need My Action
 * count and the Modules it has a Work Item Type in.
 *
 * The count follows the List's toggle row for row, minus the Member's own
 * Drafts: the items app.need_my_action says are waiting on them, one per
 * Revision chain, the latest Revision they see (app.latest_visible_revision), as
 * the List shows by default. Same functions, so the two can't disagree. Only open assignments of the Member's own Participants are
 * candidates (RLS on step_assignment), and RLS on work_item keeps it to items
 * they see. A closed Project counts 0.
 */
async function summaries(trx: Transaction<Database>, rows: ProjectRow[]): Promise<ProjectSummary[]> {
  if (rows.length === 0) return [];
  const projectIds = rows.map((r) => r.id);
  const { rows: counts } = await sql<{ project_id: string; count: number }>`
    select w.project_id, count(distinct w.id)::int as count
    from work_item w
    join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed')
    where w.project_id = any(${projectIds}::uuid[]) and app.need_my_action(w.id) = 'waiting'
      and app.latest_visible_revision(w.id)
    group by w.project_id
  `.execute(trx);
  const { rows: modules } = await sql<{ project_id: string; module_key: ModuleKey }>`
    select distinct p.id as project_id, t.module_key
    from project p
    join work_item_type t on t.project_id is null or t.project_id = p.id
    where p.id = any(${projectIds}::uuid[])
  `.execute(trx);
  return rows.map(({ baseRole, roleName, ...row }) => ({
    ...row,
    projectRole: { baseRole, name: roleName },
    needMyAction: counts.find((c) => c.project_id === row.id)?.count ?? 0,
    modules: moduleKeys.filter((key) => modules.some((m) => m.project_id === row.id && m.module_key === key)),
  }));
}

/** The Member's Projects, as the Projects page lists them, newest first. */
export function listMyProjects(db: Db, memberId: string): Promise<ProjectSummary[]> {
  return withMember(db, memberId, async (trx) =>
    summaries(trx, await selectProjects(trx, memberId).orderBy("p.created_at", "desc").orderBy("p.id", "desc").execute()),
  );
}

/** One of my Projects, or null: a Project the Member is not on is indistinguishable from one that doesn't exist. */
export function getProject(db: Db, memberId: string, projectId: string): Promise<ProjectSummary | null> {
  return withMember(db, memberId, async (trx) => {
    const row = await selectProjects(trx, memberId).where("p.id", "=", projectId).executeTakeFirst();
    return row ? (await summaries(trx, [row]))[0]! : null;
  });
}
