import { withMember, type Db } from "@rabaed/db";
import type {
  AddParticipantRequest,
  BaseRole,
  BilingualText,
  CompanyParticipation,
  ParticipantMembers,
  ProjectParticipant,
} from "@rabaed/domain";
import { sql } from "kysely";
import { refusedAsForbidden } from "../db-error.ts";

// Participants and Project Members. Writes go through the app.* functions of the
// participants migration; reads go through RLS or those functions, never around them.

type Forbidden = { ok: false; reason: "forbidden" };

export type AddParticipantResult =
  | { ok: true; participantId: string }
  | Forbidden
  | { ok: false; reason: "not_found" | "project_closed" | "unknown_company" | "already_participant" };

type ProjectMemberRefusal = "not_found" | "project_closed" | "member_not_found";
export type ProjectMemberResult = { ok: true } | Forbidden | { ok: false; reason: ProjectMemberRefusal };

/** An app.*_project_member outcome as a result: `done` is its success word, anything else a refusal. */
function projectMemberResult(outcome: string, done: string): ProjectMemberResult {
  return outcome === done ? { ok: true } : { ok: false, reason: outcome as ProjectMemberRefusal };
}

/** The Participants of one of the Member's Projects, or null when it isn't one of theirs. */
export async function listParticipants(db: Db, memberId: string, projectId: string): Promise<ProjectParticipant[] | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const { rows } = await sql<{
      participant_id: string;
      company_id: string;
      legal_name: BilingualText;
      base_role: BaseRole;
      role_name: BilingualText;
      own: boolean;
    }>`
      select p.*, p.company_id = app.current_company_id() as own from app.project_participants(${projectId}::uuid) p
    `.execute(trx);
    return rows.map((r) => ({
      id: r.participant_id,
      company: { id: r.company_id, legalName: r.legal_name },
      projectRole: { baseRole: r.base_role, name: r.role_name },
      isOwnCompany: r.own,
    }));
  });
}

/** A Project Admin adds a Company, found by its CR number, as a Participant. */
export function addParticipant(
  db: Db,
  memberId: string,
  projectId: string,
  input: AddParticipantRequest,
): Promise<AddParticipantResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<AddParticipantResult> => {
      const { rows } = await sql<{ outcome: "added" | Exclude<AddParticipantResult, { ok: true } | Forbidden>["reason"]; participant_id: string | null }>`
        select outcome, participant_id from app.add_participant(${projectId}::uuid, ${input.crNumber}, ${input.role})
      `.execute(trx);
      const { outcome, participant_id } = rows[0]!;
      return outcome === "added" ? { ok: true, participantId: participant_id! } : { ok: false, reason: outcome };
    }),
  );
}

type ParticipationRow = {
  participant_id: string;
  project_id: string;
  project_number: number;
  code: string;
  name: BilingualText;
  base_role: BaseRole;
  role_name: BilingualText;
};

function toParticipation(r: ParticipationRow): CompanyParticipation {
  return {
    id: r.participant_id,
    project: { id: r.project_id, projectNumber: r.project_number, code: r.code, name: r.name },
    projectRole: { baseRole: r.base_role, name: r.role_name },
  };
}

/** The Authorized Person's Company's Participants, on every Project it takes part in. */
export function listCompanyParticipations(
  db: Db,
  memberId: string,
): Promise<{ ok: true; participations: CompanyParticipation[] } | Forbidden> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<ParticipationRow>`select * from app.company_participants()`.execute(trx);
      return { ok: true, participations: rows.map(toParticipation) } as const;
    }),
  );
}

/**
 * A Participant's Project Members, for its own Company's Members on the Project
 * and its Authorized Person; null for anyone else (RLS hides the rows).
 */
export async function listParticipantMembers(
  db: Db,
  memberId: string,
  participantId: string,
): Promise<ParticipantMembers | null> {
  return withMember(db, memberId, async (trx) => {
    // Only the acting Member's own Company's Participants they may look into.
    const participant = await sql<ParticipationRow>`select * from app.participation(${participantId}::uuid)`.execute(trx);
    const row = participant.rows[0];
    if (!row) return null;
    const members = await trx
      .selectFrom("project_member as pm")
      .innerJoin("member as m", "m.id", "pm.member_id")
      .select(["m.id", "m.email", "m.full_name as fullName"])
      .where("pm.participant_id", "=", participantId)
      .where("pm.status", "=", "active")
      .where("m.status", "in", ["invited", "active"])
      .orderBy("pm.created_at")
      .orderBy("m.id")
      .execute();
    return { participant: toParticipation(row), members };
  });
}

/** The Participant's Authorized Person adds a Member of their own Company to the Project. */
export function addProjectMember(
  db: Db,
  memberId: string,
  participantId: string,
  targetId: string,
  now: Date,
): Promise<ProjectMemberResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ outcome: string }>`
        select app.add_project_member(${participantId}::uuid, ${targetId}::uuid, ${now}) as outcome
      `.execute(trx);
      return projectMemberResult(rows[0]!.outcome, "added");
    }),
  );
}

/** The Participant's Authorized Person removes a Project Member: their access ends at once. */
export function removeProjectMember(
  db: Db,
  memberId: string,
  participantId: string,
  targetId: string,
  now: Date,
): Promise<ProjectMemberResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ outcome: string }>`
        select app.remove_project_member(${participantId}::uuid, ${targetId}::uuid, ${now}) as outcome
      `.execute(trx);
      return projectMemberResult(rows[0]!.outcome, "removed");
    }),
  );
}
