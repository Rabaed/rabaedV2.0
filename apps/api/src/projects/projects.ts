import { withMember, type Database, type Db } from "@rabaed/db";
import { moduleTabOrder, type BilingualText, type CreateProjectRequest, type ModuleKey, type MyProjects, type ProjectSummary } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { submittalCounts } from "./submittal-counts.ts";

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
      // Every Member of the Project sees the Host Company's name (V15).
      sql<BilingualText>`app.project_host_company_name(p.id)`.as("hostName"),
      "r.base_role as baseRole",
      "r.name as roleName",
      sql<boolean>`pa.id is not null`.as("isProjectAdmin"),
    ]);
}

type ProjectRow = Awaited<ReturnType<ReturnType<typeof selectProjects>["executeTakeFirstOrThrow"]>>;

/**
 * The items waiting on the Member in these Projects, each once: the rows behind
 * the Need My Action count, which Home lists too (RP-407). The items
 * app.need_my_action says are waiting on them, one per Revision chain, the
 * latest Revision they see (app.latest_visible_revision), as the List shows by
 * default; never their own Drafts. Only open assignments of the Member's own
 * Participants are candidates (RLS on step_assignment), and RLS on work_item
 * keeps it to items they see. Nothing on a closed Project.
 */
export async function waitingOnMember(trx: Transaction<Database>, projectIds: readonly string[]): Promise<{ projectId: string; id: string }[]> {
  if (projectIds.length === 0) return [];
  const { rows } = await sql<{ project_id: string; id: string }>`
    select distinct w.project_id, w.id
    from work_item w
    join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed')
    where w.project_id = any(${projectIds}::uuid[]) and app.need_my_action(w.id) = 'waiting'
      and app.latest_visible_revision(w.id)
  `.execute(trx);
  return rows.map((r) => ({ projectId: r.project_id, id: r.id }));
}

/**
 * Per Project, what its card and shell show besides its row: the Need My Action
 * count and the Modules it has a Work Item Type in.
 *
 * The count follows the List's toggle row for row, minus the Member's own
 * Drafts (`waitingOnMember`): the same functions, so the two can't disagree.
 * A closed Project counts 0.
 */
async function summaries(trx: Transaction<Database>, rows: ProjectRow[]): Promise<ProjectSummary[]> {
  if (rows.length === 0) return [];
  const projectIds = rows.map((r) => r.id);
  const waiting = await waitingOnMember(trx, projectIds);
  const { rows: modules } = await sql<{ project_id: string; module_key: ModuleKey }>`
    select distinct p.id as project_id, t.module_key
    from project p
    join work_item_type t on t.project_id is null or t.project_id = p.id
    where p.id = any(${projectIds}::uuid[])
  `.execute(trx);
  return rows.map(({ baseRole, roleName, hostName, ...row }) => ({
    ...row,
    hostCompany: { legalName: hostName },
    projectRole: { baseRole, name: roleName },
    needMyAction: waiting.filter((w) => w.projectId === row.id).length,
    modules: moduleTabOrder.filter((key) => modules.some((m) => m.project_id === row.id && m.module_key === key)),
  }));
}

/** The Member's Projects, as the Projects page lists them, newest first, within the Member's transaction. */
export async function myProjectSummaries(trx: Transaction<Database>, memberId: string): Promise<ProjectSummary[]> {
  return summaries(trx, await selectProjects(trx, memberId).orderBy("p.created_at", "desc").orderBy("p.id", "desc").execute());
}

/**
 * The Member's Projects, as the Projects page lists them, newest first, with each
 * card's "n submittals": the Member's own Submittals List count on it, a closed
 * Project's too (its List is still theirs to read).
 */
export function listMyProjects(db: Db, memberId: string, now: Date): Promise<MyProjects> {
  return withMember(db, memberId, async (trx) => {
    const projects = await myProjectSummaries(trx, memberId);
    return { projects, submittals: await submittalCounts(trx, projects, now) };
  });
}

/** One of my Projects, or null: a Project the Member is not on is indistinguishable from one that doesn't exist. */
export function getProject(db: Db, memberId: string, projectId: string): Promise<ProjectSummary | null> {
  return withMember(db, memberId, async (trx) => {
    const row = await selectProjects(trx, memberId).where("p.id", "=", projectId).executeTakeFirst();
    return row ? (await summaries(trx, [row]))[0]! : null;
  });
}
