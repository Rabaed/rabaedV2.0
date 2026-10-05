import { withMember, type Db } from "@rabaed/db";
import {
  participantCodeRefusals,
  type AddParticipantRequest,
  type BaseRole,
  type BilingualText,
  type CompanyInvitations,
  type CompanyParticipation,
  type ParticipantMembers,
  type ProjectInvitations,
  type ProjectParticipants,
} from "@rabaed/domain";
import { sql, type RawBuilder } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Participants and Project Members. Writes go through the app.* functions of the
// participants migration; reads go through RLS or those functions, never around them.

const addParticipantRefusals = ["not_found", "project_closed", "already_participant"] as const;

/** One answer, `ok`, whether or not the CR number is on Rabaed (ADR 0009). */
export type AddParticipantResult =
  | { ok: true }
  | Forbidden
  | { ok: false; reason: (typeof addParticipantRefusals)[number] };

export type SetParticipantCodeResult = { ok: true } | Forbidden | { ok: false; reason: (typeof participantCodeRefusals)[number] };

const respondRefusals = ["not_found", "project_closed"] as const;
export type RespondToInvitationResult =
  | { ok: true }
  | Forbidden
  | { ok: false; reason: (typeof respondRefusals)[number] };

const projectMemberRefusals = ["not_found", "project_closed", "member_not_found", "position_not_found"] as const;
export type ProjectMemberResult = { ok: true } | Forbidden | { ok: false; reason: (typeof projectMemberRefusals)[number] };

/**
 * The Participants of one of the Member's Projects they may list (every one for
 * its Project Admins, otherwise only their own Company's) and the Host Company's
 * name (V15); null when it isn't one of their Projects.
 */
export async function listParticipants(db: Db, memberId: string, projectId: string): Promise<ProjectParticipants | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx
      .selectFrom("project")
      // Never null here: RLS shows the Project only to its Members, who all see the Host Company.
      .select(sql<BilingualText>`app.project_host_company_name(id)`.as("hostName"))
      .where("id", "=", projectId)
      .executeTakeFirst();
    if (!onProject) return null;
    const { rows } = await sql<{
      participant_id: string;
      company_id: string;
      legal_name: BilingualText;
      base_role: BaseRole;
      role_name: BilingualText;
      own: boolean;
      code: string | null;
    }>`
      -- The code is read through the participant table's row-level security: a Member
      -- gets the codes of the Participants they can see (V15), and the join adds no row.
      select p.*, p.company_id = app.current_company_id() as own, pt.code
      from app.project_participants(${projectId}::uuid) p
      join participant pt on pt.id = p.participant_id
    `.execute(trx);
    return {
      hostCompany: { legalName: onProject.hostName },
      participants: rows.map((r) => ({
        id: r.participant_id,
        company: { id: r.company_id, legalName: r.legal_name },
        projectRole: { baseRole: r.base_role, name: r.role_name },
        code: r.code,
        isOwnCompany: r.own,
      })),
    };
  });
}

/**
 * A Project Admin invites a Company, found by its CR number, to the Project. A
 * CR number that isn't on Rabaed becomes an onboarding lead, with the same answer.
 */
export function addParticipant(
  db: Db,
  memberId: string,
  projectId: string,
  input: AddParticipantRequest,
  now: Date,
): Promise<AddParticipantResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<AddParticipantResult> => {
      const { rows } = await sql<{ outcome: string }>`
        select app.add_participant(${projectId}::uuid, ${input.crNumber}, ${input.role}, ${now}) as outcome
      `.execute(trx);
      return commandResult(rows[0]!.outcome, "invited", addParticipantRefusals);
    }),
  );
}

/**
 * A Project's pending Participant Invitations, for its Project Admins: null
 * when it isn't one of the Member's Projects, forbidden for its other Members.
 */
export async function listProjectInvitations(
  db: Db,
  memberId: string,
  projectId: string,
): Promise<ProjectInvitations | Forbidden | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx
      .selectFrom("project")
      .select(sql<boolean>`id in (select app.current_admin_project_ids())`.as("isAdmin"))
      .where("id", "=", projectId)
      .executeTakeFirst();
    if (!project) return null;
    if (!project.isAdmin) return { ok: false, reason: "forbidden" } as const;
    const { rows } = await sql<{
      invitation_id: string;
      cr_number: string;
      base_role: BaseRole;
      role_name: BilingualText;
      invited_at: Date;
    }>`select * from app.project_invitations(${projectId}::uuid)`.execute(trx);
    return {
      invitations: rows.map((r) => ({
        id: r.invitation_id,
        crNumber: r.cr_number,
        projectRole: { baseRole: r.base_role, name: r.role_name },
        invitedAt: r.invited_at.toISOString(),
      })),
    };
  });
}

const withdrawRefusals = ["not_found", "project_closed"] as const;
/** The same answer for an invitation to a Company on Rabaed and for an onboarding lead (scenario 38). */
export type WithdrawInvitationResult = { ok: true } | { ok: false; reason: (typeof withdrawRefusals)[number] };

/**
 * A Project Admin withdraws one of the Project's pending invitations, whether
 * it went to a Company on Rabaed or became an onboarding lead. Not found for
 * anyone else.
 */
export function withdrawInvitation(
  db: Db,
  memberId: string,
  projectId: string,
  invitationId: string,
  now: Date,
): Promise<WithdrawInvitationResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.withdraw_invitation(${projectId}::uuid, ${invitationId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "withdrawn", withdrawRefusals);
  });
}

/** The Authorized Person's Company's pending Participant Invitations. */
export function listCompanyInvitations(db: Db, memberId: string): Promise<CompanyInvitations | Forbidden> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{
        participant_id: string;
        project_name: BilingualText;
        host_name: BilingualText;
        base_role: BaseRole;
        role_name: BilingualText;
        invited_at: Date;
      }>`select * from app.company_invitations()`.execute(trx);
      return {
        invitations: rows.map((r) => ({
          id: r.participant_id,
          project: { name: r.project_name },
          hostCompany: { legalName: r.host_name },
          projectRole: { baseRole: r.base_role, name: r.role_name },
          invitedAt: r.invited_at.toISOString(),
        })),
      };
    }),
  );
}

/**
 * The invited Company's Authorized Person accepts (the Company becomes a
 * Participant) or declines (nothing changes on the Project) an invitation.
 */
export function respondToInvitation(
  db: Db,
  memberId: string,
  participantId: string,
  accept: boolean,
  now: Date,
): Promise<RespondToInvitationResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<RespondToInvitationResult> => {
      const { rows } = await sql<{ outcome: string }>`
        select app.respond_to_invitation(${participantId}::uuid, ${accept}, ${now}) as outcome
      `.execute(trx);
      const outcome = checkedOutcome(rows[0]!.outcome, ["accepted", "declined", ...respondRefusals]);
      return outcome === "accepted" || outcome === "declined" ? { ok: true } : { ok: false, reason: outcome };
    }),
  );
}

type ParticipationRow = {
  participant_id: string;
  project_id: string;
  project_number: number;
  code: string;
  name: BilingualText;
  host_name: BilingualText;
  base_role: BaseRole;
  role_name: BilingualText;
};

/** Rows of app.company_participants or app.participation, each with its Host Company's name. */
const withHostCompanyName = (from: RawBuilder<unknown>) =>
  sql<ParticipationRow>`select x.*, app.project_host_company_name(x.project_id) as host_name from ${from} x`;

function toParticipation(r: ParticipationRow): CompanyParticipation {
  return {
    id: r.participant_id,
    project: { id: r.project_id, projectNumber: r.project_number, code: r.code, name: r.name },
    hostCompany: { legalName: r.host_name },
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
      const { rows } = await withHostCompanyName(sql`app.company_participants()`).execute(trx);
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
    const participant = await withHostCompanyName(sql`app.participation(${participantId}::uuid)`).execute(trx);
    const row = participant.rows[0];
    if (!row) return null;
    const members = await trx
      .selectFrom("project_member as pm")
      .innerJoin("member as m", "m.id", "pm.member_id")
      .select((eb) => [
        "m.id",
        "m.email",
        "m.full_name as fullName",
        eb.fn
          .coalesce(
            eb
              .selectFrom("project_member_position as mp")
              .innerJoin("position as pos", "pos.id", "mp.position_id")
              .select(sql<string[]>`array_agg(pos.key order by pos.sort)`.as("keys"))
              .whereRef("mp.project_member_id", "=", "pm.id"),
            sql<string[]>`'{}'::text[]`,
          )
          .as("positions"),
      ])
      .where("pm.participant_id", "=", participantId)
      .where("pm.status", "=", "active")
      .where("m.status", "in", ["invited", "active"])
      .orderBy("pm.created_at")
      .orderBy("m.id")
      .execute();
    const positions = await trx
      .selectFrom("position")
      .select(["key", "name"])
      .where("base_role", "=", row.base_role)
      .orderBy("sort")
      .execute();
    return { participant: toParticipation(row), members, positions };
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
      return commandResult(rows[0]!.outcome, "added", projectMemberRefusals);
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
      return commandResult(rows[0]!.outcome, "removed", projectMemberRefusals);
    }),
  );
}

/** The Participant's Authorized Person sets a Project Member's Positions. */
export function setMemberPositions(
  db: Db,
  memberId: string,
  participantId: string,
  targetId: string,
  positions: string[],
): Promise<ProjectMemberResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx) => {
      const { rows } = await sql<{ outcome: string }>`
        select app.set_project_member_positions(${participantId}::uuid, ${targetId}::uuid, ${positions}::text[]) as outcome
      `.execute(trx);
      return commandResult(rows[0]!.outcome, "set", projectMemberRefusals);
    }),
  );
}

/**
 * A Project Admin sets a Participant's Participant Code. Not found for a
 * Participant the Member can't see; forbidden for a Member who sees it but
 * isn't a Project Admin.
 */
export function setParticipantCode(
  db: Db,
  memberId: string,
  participantId: string,
  code: string,
): Promise<SetParticipantCodeResult> {
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<SetParticipantCodeResult> => {
      const { rows } = await sql<{ outcome: string }>`
        select app.set_participant_code(${participantId}::uuid, ${code}) as outcome
      `.execute(trx);
      return commandResult(rows[0]!.outcome, "set", participantCodeRefusals);
    }),
  );
}
