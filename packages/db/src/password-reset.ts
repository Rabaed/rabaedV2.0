import { PASSWORD_RESET, type Locale, type PasswordResetEmail } from "@rabaed/domain";
import { sql } from "kysely";
import type { OutboxHandler } from "./outbox.ts";
import { newToken } from "./tokens.ts";

// The worker's side of forgot password (RP-1058; migration 20271020000000_password_reset.sql; the
// api's side is @rabaed/auth password-reset.ts). The link's token is minted only as its email is
// sent, and only its SHA-256 is stored: no raw token is ever in the database, the outbox included.

/** Sends a reset link's email. Throws when it could not, so the outbox retries with a fresh token. */
export type SendPasswordResetEmail = (email: PasswordResetEmail) => Promise<void>;

/**
 * The outbox handler of kind `password_reset`: mints the link's token, stores its hash with the
 * expiry (PASSWORD_RESET.validMinutes from `now`), and sends it. Nothing when the request was
 * voided by a later one, or its Member can no longer sign in. A failed send rolls the hash back
 * with the handler's transaction, and the retry mints a fresh token.
 */
export function passwordResetHandler(send: SendPasswordResetEmail, now: () => Date = () => new Date()): OutboxHandler {
  return async (trx, row) => {
    const resetId = row.payload.passwordResetId;
    if (typeof resetId !== "string") throw new Error("password_reset row without passwordResetId");
    const { validMinutes } = PASSWORD_RESET;
    const { token, hash } = newToken();
    const { rows } = await sql<{ to_address: string; language: Locale }>`
      select to_address, language from app.issue_password_reset(
        ${resetId}::uuid, ${hash}, ${now()}, make_interval(mins => ${validMinutes}::integer)
      )
    `.execute(trx);
    const issued = rows[0];
    if (!issued) return;
    await send({ to: issued.to_address, language: issued.language, token, validMinutes });
  };
}
