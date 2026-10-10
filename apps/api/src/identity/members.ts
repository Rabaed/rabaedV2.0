import { newToken, type Invitation } from "@rabaed/auth";
import { withMember, type Database, type Db } from "@rabaed/db";
import type { CompanyMember, InviteMemberRequest, ListedMember } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { checkedOutcome } from "../outcomes.ts";

// The Authorized Person's Member management. Every write goes through one of
// the app.* functions in the member_management migration, which check that the
// acting Member is the Authorized Person and scope the target to their Company.

/**
 * Refused when the email is taken (visibility.md V17): by a Member of the
 * Company, by a deactivated one (whom the Authorized Person may reactivate), or
 * by a Member of another Company, which is all the refusal says about them.
 */
export type InviteResult =
  | { ok: true; memberId: string; invitation: Invitation }
  | Forbidden
  | { ok: false; reason: "already_a_member" | "registered_with_another_company" }
  | { ok: false; reason: "deactivated_member"; memberId: string };

/** The reactivated Member, with a new invitation when they had never accepted the first. */
export type ReactivateResult =
  | { ok: true; member: CompanyMember; invitation?: Invitation }
  | Forbidden
  | { ok: false; reason: "not_found" };

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
export async function listMembers(db: Db, memberId: string): Promise<ListedMember[]> {
  return withMember(db, memberId, async (trx) => {
    const members = await selectMembers(trx).orderBy("m.created_at").orderBy("m.id").execute();
    // How many active Projects each is on, from one function that reads nothing but the count and
    // only for the acting Member's own Company (V15): every Member may know it of a colleague.
    const { rows } = await sql<{ member_id: string; project_count: number }>`select * from app.member_project_counts()`.execute(trx);
    const projects = new Map(rows.map((r) => [r.member_id, r.project_count]));
    return members.map((m) => ({ ...m, projectCount: projects.get(m.id) ?? 0 }));
  });
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
export function inviteMember(
  db: Db,
  memberId: string,
  input: InviteMemberRequest,
  now: Date,
  invitationTtlMs: number,
): Promise<InviteResult> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + invitationTtlMs);
  return asAuthorizedPerson(db, memberId, async (trx): Promise<InviteResult> => {
    // The new Member's id, or why the email is taken; an id comes only with 'invited' and 'deactivated_member'.
    const { rows } = await sql<{ outcome: string; member_id: string | null }>`
      select * from app.invite_member(
        ${input.email}, ${JSON.stringify(input.fullName)}::jsonb, ${input.locale}, ${hash}, ${expiresAt}
      )
    `.execute(trx);
    const { outcome, member_id: id } = rows[0]!;
    const reason = checkedOutcome(outcome, [
      "invited",
      "deactivated_member",
      "already_a_member",
      "registered_with_another_company",
    ]);
    if (reason === "invited") return { ok: true, memberId: id!, invitation: { token, expiresAt } };
    if (reason === "deactivated_member") return { ok: false, reason, memberId: id! };
    return { ok: false, reason };
  });
}

/**
 * The Authorized Person reactivates a deactivated Member of their Company: the
 * same Member, keeping their Signature and records. One who had set a password
 * signs in with it again; one who never did gets a new invitation, returned once.
 */
export function reactivateMember(
  db: Db,
  memberId: string,
  targetId: string,
  now: Date,
  invitationTtlMs: number,
): Promise<ReactivateResult> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + invitationTtlMs);
  return asAuthorizedPerson(db, memberId, async (trx): Promise<ReactivateResult> => {
    // 'reactivated', 'unchanged' (they weren't deactivated), or null when they are not in the Company.
    const { rows } = await sql<{ outcome: string | null }>`
      select app.reactivate_member(${targetId}::uuid, ${hash}, ${expiresAt}, ${now}) as outcome
    `.execute(trx);
    if (rows[0]?.outcome == null) return { ok: false, reason: "not_found" };
    const outcome = checkedOutcome(rows[0].outcome, ["reactivated", "unchanged"]);
    const member = await readMember(trx, targetId);
    // Invited again: the new invitation was stored with this token's hash.
    return outcome === "reactivated" && member.status === "invited"
      ? { ok: true, member, invitation: { token, expiresAt } }
      : { ok: true, member };
  });
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
    const { rows } = await sql<{ outcome: string | null }>`
      select app.deactivate_member(${targetId}::uuid, ${now}) as outcome
    `.execute(trx);
    if (rows[0]?.outcome == null) return { ok: false, reason: "not_found" };
    const outcome = checkedOutcome(rows[0].outcome, ["deactivated", "authorized_person"]);
    if (outcome === "authorized_person") return { ok: false, reason: "authorized_person" };
    return { ok: true, member: await readMember(trx, targetId) };
  });
}
