import { withMember, type Database, type Db } from "@rabaed/db";
import type { CompanyMember, InviteMemberRequest } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { pgError, refusedAsForbidden, UNIQUE_VIOLATION } from "../db-error.ts";
import type { Invitation } from "./invitations.ts";
import { newToken } from "./tokens.ts";

// The Authorized Person's Member management. Every write goes through one of
// the app.* functions in the member_management migration, which check that the
// acting Member is the Authorized Person and scope the target to their Company.

type Forbidden = { ok: false; reason: "forbidden" };

export type InviteResult = { ok: true; memberId: string; invitation: Invitation } | Forbidden | { ok: false; reason: "duplicate_email" };

export type UpdateResult =
  | { ok: true; member: CompanyMember }
  | Forbidden
  | { ok: false; reason: "not_found" | "member_deactivated" | "authorized_person" };

/** Runs `fn` as the Member; the database's refusal for not being the Authorized Person becomes `forbidden`. */
function asAuthorizedPerson<T>(
  db: Db,
  memberId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T | Forbidden> {
  return refusedAsForbidden(() => withMember(db, memberId, fn));
}

/** The Company's Members, as RLS lets the acting Member see them: their own Company only. */
export async function listMembers(db: Db, memberId: string): Promise<CompanyMember[]> {
  return withMember(db, memberId, (trx) => selectMembers(trx).orderBy("m.created_at").orderBy("m.id").execute());
}

function selectMembers(trx: Transaction<Database>) {
  return trx
    .selectFrom("member as m")
    .innerJoin("company as c", "c.id", "m.company_id")
    .select([
      "m.id",
      "m.email",
      "m.full_name as fullName",
      "m.locale",
      "m.status",
      sql<boolean>`coalesce(c.authorized_person_id = m.id, false)`.as("isAuthorizedPerson"),
      "m.can_create_projects as canCreateProjects",
    ]);
}

function readMember(trx: Transaction<Database>, id: string): Promise<CompanyMember> {
  return selectMembers(trx).where("m.id", "=", id).executeTakeFirstOrThrow();
}

/**
 * The Authorized Person invites a Member of their Company. The invitation token
 * is returned once, to be passed on (email delivery comes later); only its hash is stored.
 */
export async function inviteMember(
  db: Db,
  memberId: string,
  input: InviteMemberRequest,
  now: Date,
  invitationTtlMs: number,
): Promise<InviteResult> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + invitationTtlMs);
  try {
    return await asAuthorizedPerson(db, memberId, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select app.invite_member(
          ${input.email}, ${JSON.stringify(input.fullName)}::jsonb, ${input.locale}, ${hash}, ${expiresAt}
        ) as id
      `.execute(trx);
      return { ok: true, memberId: rows[0]!.id, invitation: { token, expiresAt } } as const;
    });
  } catch (error) {
    const e = pgError(error);
    if (e.code === UNIQUE_VIOLATION && e.constraint === "member_email_key") return { ok: false, reason: "duplicate_email" };
    throw error;
  }
}

/** The Authorized Person marks a Member of their Company as a Project Creator, or not. */
export function setProjectCreator(db: Db, memberId: string, targetId: string, value: boolean): Promise<UpdateResult> {
  return asAuthorizedPerson(db, memberId, async (trx): Promise<UpdateResult> => {
    // The Member's status, or null when they are not in the Company.
    const { rows } = await sql<{ status: string | null }>`
      select app.set_project_creator(${targetId}::uuid, ${value}) as status
    `.execute(trx);
    const status = rows[0]?.status;
    if (!status) return { ok: false, reason: "not_found" };
    if (status === "deactivated") return { ok: false, reason: "member_deactivated" };
    return { ok: true, member: await readMember(trx, targetId) };
  });
}

/** The Authorized Person deactivates a Member of their Company: their sessions end at once. */
export function deactivateMember(db: Db, memberId: string, targetId: string, now: Date): Promise<UpdateResult> {
  return asAuthorizedPerson(db, memberId, async (trx): Promise<UpdateResult> => {
    // 'deactivated', 'authorized_person' (refused), or null when they are not in the Company.
    const { rows } = await sql<{ outcome: "deactivated" | "authorized_person" | null }>`
      select app.deactivate_member(${targetId}::uuid, ${now}) as outcome
    `.execute(trx);
    const outcome = rows[0]?.outcome;
    if (!outcome) return { ok: false, reason: "not_found" };
    if (outcome === "authorized_person") return { ok: false, reason: "authorized_person" };
    return { ok: true, member: await readMember(trx, targetId) };
  });
}
