import { randomInt, timingSafeEqual } from "node:crypto";
import { dummyHash, hashToken, newToken, verifyPassword } from "@rabaed/auth";
import type { Database, Db, EngineerSignInEvent } from "@rabaed/db";
import type { Mailer } from "@rabaed/mailer";
import { sql, type Kysely, type Transaction } from "kysely";
import { signInPolicy as policy } from "./config.ts";

// A Rabaed Engineer's sign-in to Rabaed Admin (ADR 0010): a password, then a
// one-time code sent by email, in the same browser. Consecutive failures lock
// the Engineer out for a while; a session ends after 30 minutes idle; a
// sign-in from a browser not seen before emails an alert. Every sign-in,
// failure and sign-out is logged in engineer_sign_in_event.
//
// It runs on the admin connection, but touches only the Engineer's own
// sign-in records, never a Company's data, so it does not go through
// asEngineer.

/** Where a request came from, for the log and the new-device alert. */
export interface Seen {
  ip: string | null;
  userAgent: string | null;
}

export interface Session {
  token: string;
  expiresAt: Date;
}

export type PasswordOutcome =
  | { kind: "code_sent"; email: string; challenge: Session }
  | { kind: "invalid_credentials" }
  | { kind: "too_many_codes" };

export type CodeOutcome =
  | { kind: "signed_in"; session: Session; /** Set when the browser had no device cookie yet. */ newDeviceToken: string | null }
  | { kind: "invalid_code" };

type Executor = Kysely<Database> | Transaction<Database>;

/** The later of the caller's clock and the database's: expiry is never judged early. */
const at = (now: Date) => sql<Date>`greatest(${now}::timestamptz, now())`;
const ms = (value: number) => sql<string>`make_interval(secs => ${value / 1000})`;

async function log(db: Executor, event: EngineerSignInEvent, who: { engineerId: string | null; email: string }, seen: Seen, now: Date) {
  await db
    .insertInto("engineer_sign_in_event")
    .values({ engineer_id: who.engineerId, email: who.email, event, ip: seen.ip, user_agent: seen.userAgent, at: now })
    .execute();
}

/**
 * Counts a failed password or code. The one that reaches the limit locks the
 * Engineer out and starts the count again; it returns true then.
 */
async function countFailure(db: Executor, engineerId: string, now: Date): Promise<boolean> {
  const { rows } = await sql<{ locked: boolean }>`
    update rabaed_engineer set
      failed_sign_ins = case when failed_sign_ins + 1 >= ${policy.failuresBeforeLockout} then 0 else failed_sign_ins + 1 end,
      locked_until = case when failed_sign_ins + 1 >= ${policy.failuresBeforeLockout} then ${at(now)} + ${ms(policy.lockoutMs)} else locked_until end
    where id = ${engineerId}
    returning failed_sign_ins = 0 as locked
  `.execute(db);
  return rows[0]?.locked ?? false;
}

// Engineers have no language setting yet, so their emails are in English.
const sendLockedEmail = (mailer: Mailer, to: string) =>
  mailer.send({ to, template: "sign-in-locked", locale: "en", values: { minutes: policy.lockoutMs / 60_000 } });

/** Whether the Engineer is locked out; in a transaction, it holds their row until the end of it. */
async function isLocked(db: Executor, engineerId: string, now: Date): Promise<boolean> {
  const { rows } = await sql<{ locked: boolean }>`
    select coalesce(locked_until > ${at(now)}, false) as locked from rabaed_engineer where id = ${engineerId} for update
  `.execute(db);
  return rows[0]?.locked ?? true;
}

/**
 * Step one: the password. When it is right, and the Engineer is not locked
 * out, a code is emailed and the browser gets a challenge for step two. Every
 * failure answers the same, takes the same time and sends nothing, so it never
 * tells whether an email belongs to an Engineer or is locked out.
 */
export async function checkPassword(
  db: Db,
  mailer: Mailer,
  input: { email: string; password: string },
  seen: Seen,
  now: Date,
): Promise<PasswordOutcome> {
  const email = input.email.trim().toLowerCase();
  const { rows } = await sql<{ engineer_id: string; password_hash: string }>`
    select engineer_id, password_hash from app.engineer_sign_in_candidate(${email})
  `.execute(db);
  const candidate = rows[0];
  const ok = await verifyPassword(input.password, candidate?.password_hash ?? (await dummyHash()));
  if (!candidate) {
    await log(db, "password_failed", { engineerId: null, email }, seen, now);
    return { kind: "invalid_credentials" };
  }
  const who = { engineerId: candidate.engineer_id, email };

  // The lockout is checked and counted with the Engineer's row locked, so a
  // burst of guesses at once cannot slip past the limit.
  const refused = await db.transaction().execute(async (trx) => {
    if (await isLocked(trx, who.engineerId, now)) {
      await log(trx, "refused_while_locked", who, seen, now);
      return { locked: false };
    }
    if (ok) return null;
    await log(trx, "password_failed", who, seen, now);
    const locked = await countFailure(trx, who.engineerId, now);
    if (locked) await log(trx, "locked_out", who, seen, now);
    return { locked };
  });
  if (refused) {
    // After the commit: a failed email must not undo the lockout.
    if (refused.locked) await sendLockedEmail(mailer, email);
    return { kind: "invalid_credentials" };
  }

  const recent = await db
    .selectFrom("engineer_sign_in_code")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("engineer_id", "=", who.engineerId)
    .where("created_at", ">", sql<Date>`${at(now)} - ${ms(policy.codeWindowMs)}`)
    .executeTakeFirstOrThrow();
  if (Number(recent.n) >= policy.codesPerWindow) {
    await log(db, "code_rate_limited", who, seen, now);
    return { kind: "too_many_codes" };
  }

  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const challenge = newToken();
  const expiresAt = new Date(now.getTime() + policy.codeTtlMs);
  // Only the newest code works: asking again voids the earlier ones.
  await db.updateTable("engineer_sign_in_code").set({ used_at: now }).where("engineer_id", "=", who.engineerId).where("used_at", "is", null).execute();
  await db
    .insertInto("engineer_sign_in_code")
    .values({ engineer_id: who.engineerId, challenge_hash: challenge.hash, code_hash: hashToken(code), created_at: now, expires_at: expiresAt })
    .execute();
  await mailer.send({ to: email, template: "sign-in-code", locale: "en", values: { code, validMinutes: policy.codeTtlMs / 60_000 } });
  await log(db, "code_sent", who, seen, now);
  return { kind: "code_sent", email, challenge: { token: challenge.token, expiresAt } };
}

/**
 * Step two: the emailed code, with the challenge the same browser got in step
 * one. A code works once, for ten minutes, and not after three wrong tries;
 * each wrong code counts towards the lockout. Success starts a session, and
 * a browser the Engineer hasn't signed in from before triggers an email alert.
 */
export async function checkCode(
  db: Db,
  mailer: Mailer,
  input: { challenge: string | undefined; code: string; deviceToken: string | undefined },
  seen: Seen,
  now: Date,
): Promise<CodeOutcome> {
  if (!input.challenge) return { kind: "invalid_code" };
  const challengeHash = hashToken(input.challenge);

  type Result = CodeOutcome & { mail?: () => Promise<void> };
  const result: Result = await db.transaction().execute(async (trx): Promise<Result> => {
    const pending = await trx
      .selectFrom("engineer_sign_in_code as c")
      .innerJoin("rabaed_engineer as e", "e.id", "c.engineer_id")
      .select(["c.id", "c.engineer_id", "c.code_hash", "c.failed_attempts", "e.email", "e.status"])
      .select(sql<boolean>`c.used_at is null and c.expires_at > ${at(now)}`.as("live"))
      .where("c.challenge_hash", "=", challengeHash)
      .forUpdate("c")
      .executeTakeFirst();
    // An unknown challenge has no Engineer to log it against.
    if (!pending) return { kind: "invalid_code" };
    const who = { engineerId: pending.engineer_id, email: pending.email };
    if (pending.status !== "active") {
      await log(trx, "code_failed", who, seen, now);
      return { kind: "invalid_code" };
    }

    if (await isLocked(trx, who.engineerId, now)) {
      await log(trx, "refused_while_locked", who, seen, now);
      return { kind: "invalid_code" };
    }
    const usable = pending.live && pending.failed_attempts < policy.wrongCodesPerChallenge;
    const right = usable && timingSafeEqual(hashToken(input.code), pending.code_hash);
    if (!right) {
      await log(trx, "code_failed", who, seen, now);
      if (!usable) return { kind: "invalid_code" };
      await trx.updateTable("engineer_sign_in_code").set({ failed_attempts: pending.failed_attempts + 1 }).where("id", "=", pending.id).execute();
      const locked = await countFailure(trx, who.engineerId, now);
      if (locked) await log(trx, "locked_out", who, seen, now);
      return {
        kind: "invalid_code",
        mail: locked
          ? () => sendLockedEmail(mailer, who.email)
          : undefined,
      };
    }

    await trx.updateTable("engineer_sign_in_code").set({ used_at: now }).where("id", "=", pending.id).execute();
    await trx.updateTable("rabaed_engineer").set({ failed_sign_ins: 0 }).where("id", "=", who.engineerId).execute();

    const session = newToken();
    const expiresAt = new Date(now.getTime() + policy.sessionMaxMs);
    await trx
      .insertInto("engineer_session")
      .values({ token_hash: session.hash, engineer_id: who.engineerId, created_at: now, last_seen_at: now, expires_at: expiresAt })
      .execute();
    await log(trx, "signed_in", who, seen, now);

    // A browser keeps one device token for every Engineer who signs in on it.
    const device = input.deviceToken ? { token: input.deviceToken, hash: hashToken(input.deviceToken) } : newToken();
    const added = await trx
      .insertInto("engineer_device")
      .values({ engineer_id: who.engineerId, device_hash: device.hash, first_seen_at: now })
      .onConflict((oc) => oc.constraint("engineer_device_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (added) await log(trx, "new_device", who, seen, now);

    return {
      kind: "signed_in",
      session: { token: session.token, expiresAt },
      newDeviceToken: input.deviceToken ? null : device.token,
      mail: added
        ? () => mailer.send({ to: who.email, template: "new-device-sign-in", locale: "en", values: { when: utcMinute(now), ip: seen.ip ?? "unknown" } })
        : undefined,
    };
  });

  // After the commit: a failed email must not undo the sign-in or the lockout.
  const { mail, ...outcome } = result;
  await mail?.();
  return outcome;
}

/** e.g. `2026-10-02 09:15 UTC`: Latin digits, the same in both languages. */
function utcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The Engineer a session token belongs to, or null. A session idle for 30
 * minutes is ended here, and logged; any other request moves its idle clock on.
 */
export async function resolveSession(db: Db, token: string, seen: Seen, now: Date): Promise<string | null> {
  const row = await db
    .selectFrom("engineer_session as s")
    .innerJoin("rabaed_engineer as e", "e.id", "s.engineer_id")
    .select(["s.id", "s.engineer_id", "e.email"])
    .select(sql<boolean>`s.last_seen_at > ${at(now)} - ${ms(policy.idleMs)}`.as("active"))
    .where("s.token_hash", "=", hashToken(token))
    .where("s.revoked_at", "is", null)
    .where("s.expires_at", ">", at(now))
    .where("e.status", "=", "active")
    .executeTakeFirst();
  if (!row) return null;
  if (!row.active) {
    await db.updateTable("engineer_session").set({ revoked_at: at(now) }).where("id", "=", row.id).execute();
    await log(db, "idle_signed_out", { engineerId: row.engineer_id, email: row.email }, seen, now);
    return null;
  }
  await db.updateTable("engineer_session").set({ last_seen_at: at(now) }).where("id", "=", row.id).execute();
  return row.engineer_id;
}

/** Sign-out: the session ends on the server, not just in the browser. */
export async function endSession(db: Db, token: string, seen: Seen, now: Date): Promise<void> {
  const ended = await db
    .updateTable("engineer_session as s")
    .set({ revoked_at: at(now) })
    .from("rabaed_engineer as e")
    .whereRef("e.id", "=", "s.engineer_id")
    .where("s.token_hash", "=", hashToken(token))
    .where("s.revoked_at", "is", null)
    .returning(["s.engineer_id", "e.email"])
    .executeTakeFirst();
  if (ended) await log(db, "signed_out", { engineerId: ended.engineer_id, email: ended.email }, seen, now);
}
