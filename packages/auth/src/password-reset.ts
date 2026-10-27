import type { Db } from "@rabaed/db";
import { sql } from "kysely";
import { hashPassword } from "./password.ts";
import { hashToken } from "./tokens.ts";

// The api's side of forgot password (RP-1058; migration 20271020000000_password_reset.sql). The
// worker mints and emails the link (@rabaed/db password-reset.ts); its token, like an invitation's,
// is stored only as a hash. The limits are @rabaed/domain's PASSWORD_RESET, passed in by the api.

/** How many requests a window takes, per email and per visitor. */
export interface PasswordResetLimits {
  perEmail: number;
  perVisitor: number;
  windowMinutes: number;
}

export type PasswordResetRequestOutcome = "requested" | "too_many_attempts";

/**
 * Asks for a reset link for `email` from a visitor (the SHA-256 of their address). The same
 * `requested` for any email, registered or not; `too_many_attempts` past the limits, which count
 * every request alike.
 */
export async function requestPasswordReset(
  db: Db,
  email: string,
  visitorSha256: Buffer,
  now: Date,
  { perEmail, perVisitor, windowMinutes }: PasswordResetLimits,
): Promise<PasswordResetRequestOutcome> {
  const { rows } = await sql<{ outcome: PasswordResetRequestOutcome }>`
    select app.request_password_reset(
      ${email}, ${visitorSha256}, ${now}, ${perEmail}::integer, ${perVisitor}::integer,
      make_interval(mins => ${windowMinutes}::integer)
    ) as outcome
  `.execute(db);
  return rows[0]!.outcome;
}

/**
 * Uses a reset link once: sets the new password, signs the Member out everywhere and records the
 * reset. Returns the Member's id, or null if the token is unknown, used, voided or expired.
 */
export async function resetPassword(db: Db, token: string, password: string, now: Date): Promise<string | null> {
  const passwordHash = await hashPassword(password);
  const { rows } = await sql<{ member_id: string | null }>`
    select app.reset_password(${hashToken(token)}, ${passwordHash}, ${now}) as member_id
  `.execute(db);
  return rows[0]?.member_id ?? null;
}
