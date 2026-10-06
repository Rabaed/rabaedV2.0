import { dummyHash, hashToken, newToken, verifyPassword } from "@rabaed/auth";
import type { Db } from "@rabaed/db";
import { sql } from "kysely";

/** Who a customer api session belongs to: always a Member. Rabaed Engineers sign in to Rabaed Admin (ADR 0010). */
export type Principal = { kind: "member"; memberId: string };

export interface Session {
  memberId: string;
  token: string;
  expiresAt: Date;
}

export async function startSession(db: Db, principal: Principal, now: Date, ttlMs: number): Promise<Session> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await sql`select app.create_session(${hash}, ${principal.memberId}::uuid, null::uuid, ${expiresAt})`.execute(db);
  return { memberId: principal.memberId, token, expiresAt };
}

/**
 * Checks an email and password. Every failure (unknown email, wrong password,
 * inactive Member or Company) looks the same and takes the same time, so the
 * response never reveals whether an email is registered.
 *
 * MFA and lockout slot in here later: a result such as `mfa_required` and a
 * failed-attempt check before verifying (Rabaed Admin has both: apps/admin).
 */
export async function signIn(
  db: Db,
  email: string,
  password: string,
  now: Date,
  ttlMs: number,
): Promise<Session | null> {
  const { rows } = await sql<{ principal_id: string; password_hash: string }>`
    select principal_id, password_hash from app.sign_in_candidate('member', ${email})
  `.execute(db);
  const candidate = rows[0];
  const ok = await verifyPassword(password, candidate?.password_hash ?? (await dummyHash()));
  if (!candidate || !ok) return null;
  return startSession(db, { kind: "member", memberId: candidate.principal_id }, now, ttlMs);
}

export async function resolveSession(db: Db, token: string, now: Date): Promise<Principal | null> {
  const { rows } = await sql<{ member_id: string | null }>`
    select member_id from app.session_principal(${hashToken(token)}, ${now})
  `.execute(db);
  const memberId = rows[0]?.member_id;
  return memberId ? { kind: "member", memberId } : null;
}

export async function endSession(db: Db, token: string, now: Date): Promise<void> {
  await sql`select app.revoke_session(${hashToken(token)}, ${now})`.execute(db);
}
