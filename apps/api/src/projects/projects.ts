import { withMember, type Database, type Db } from "@rabaed/db";
import type { CreateProjectRequest, ProjectSummary } from "@rabaed/domain";
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

function toSummary({ baseRole, roleName, ...row }: ProjectRow): ProjectSummary {
  return { ...row, projectRole: { baseRole, name: roleName } };
}

/** My Projects, newest first. */
export async function listMyProjects(db: Db, memberId: string): Promise<ProjectSummary[]> {
  const rows = await withMember(db, memberId, (trx) =>
    selectProjects(trx, memberId).orderBy("p.created_at", "desc").orderBy("p.id", "desc").execute(),
  );
  return rows.map(toSummary);
}

/** One of my Projects, or null: a Project the Member is not on is indistinguishable from one that doesn't exist. */
export async function getProject(db: Db, memberId: string, projectId: string): Promise<ProjectSummary | null> {
  const row = await withMember(db, memberId, (trx) =>
    selectProjects(trx, memberId).where("p.id", "=", projectId).executeTakeFirst(),
  );
  return row ? toSummary(row) : null;
}
