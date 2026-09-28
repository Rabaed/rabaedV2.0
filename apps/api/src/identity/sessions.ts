import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import { dummyHash, verifyPassword } from "./password.ts";
import { hashToken, newToken } from "./tokens.ts";

export type Principal = { kind: "member"; memberId: string } | { kind: "engineer"; engineerId: string };

export interface Session {
  token: string;
  expiresAt: Date;
}

export async function startSession(db: Db, principal: Principal, now: Date, ttlMs: number): Promise<Session> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const memberId = principal.kind === "member" ? principal.memberId : null;
  const engineerId = principal.kind === "engineer" ? principal.engineerId : null;
  await sql`select app.create_session(${hash}, ${memberId}::uuid, ${engineerId}::uuid, ${expiresAt})`.execute(db);
  return { token, expiresAt };
}

/**
 * Checks an email and password. Every failure (unknown email, wrong password,
 * inactive Member or Company) looks the same and takes the same time, so the
 * response never reveals whether an email is registered.
 *
 * MFA and lockout slot in here later: a result such as `mfa_required` and a
 * failed-attempt check before verifying.
 */
export async function signIn(
  db: Db,
  kind: Principal["kind"],
  email: string,
  password: string,
  now: Date,
  ttlMs: number,
): Promise<Session | null> {
  const { rows } = await sql<{ principal_id: string; password_hash: string }>`
    select principal_id, password_hash from app.sign_in_candidate(${kind}, ${email})
  `.execute(db);
  const candidate = rows[0];
  const ok = await verifyPassword(password, candidate?.password_hash ?? (await dummyHash()));
  if (!candidate || !ok) return null;
  const principal: Principal =
    kind === "member"
      ? { kind, memberId: candidate.principal_id }
      : { kind, engineerId: candidate.principal_id };
  return startSession(db, principal, now, ttlMs);
}

export async function resolveSession(db: Db, token: string, now: Date): Promise<Principal | null> {
  const { rows } = await sql<{ member_id: string | null; engineer_id: string | null }>`
    select member_id, engineer_id from app.session_principal(${hashToken(token)}, ${now})
  `.execute(db);
  const row = rows[0];
  if (row?.member_id) return { kind: "member", memberId: row.member_id };
  if (row?.engineer_id) return { kind: "engineer", engineerId: row.engineer_id };
  return null;
}

export async function endSession(db: Db, token: string, now: Date): Promise<void> {
  await sql`select app.revoke_session(${hashToken(token)}, ${now})`.execute(db);
}
