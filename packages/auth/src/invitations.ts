import type { Database, Db } from "@rabaed/db";
import { sql, type Transaction } from "kysely";
import { hashPassword } from "./password.ts";
import { hashToken, newToken } from "./tokens.ts";

export interface Invitation {
  token: string;
  expiresAt: Date;
}

type InvitedBy = { engineerId: string } | { memberId: string };

export async function createInvitation(
  trx: Transaction<Database>,
  memberId: string,
  invitedBy: InvitedBy,
  now: Date,
  ttlMs: number,
): Promise<Invitation> {
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await trx
    .insertInto("invitation")
    .values({
      member_id: memberId,
      token_hash: hash,
      invited_by_engineer_id: "engineerId" in invitedBy ? invitedBy.engineerId : null,
      invited_by_member_id: "memberId" in invitedBy ? invitedBy.memberId : null,
      expires_at: expiresAt,
    })
    .execute();
  return { token, expiresAt };
}

/**
 * Uses an invitation once: sets the password and activates the Member.
 * Returns the Member's id, or null if the token is unknown, used or expired.
 */
export async function acceptInvitation(db: Db, token: string, password: string, now: Date): Promise<string | null> {
  const passwordHash = await hashPassword(password);
  const { rows } = await sql<{ member_id: string | null }>`
    select app.accept_invitation(${hashToken(token)}, ${passwordHash}, ${now}) as member_id
  `.execute(db);
  return rows[0]?.member_id ?? null;
}
