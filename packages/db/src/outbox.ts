import type { BilingualText, Locale, NotificationEmail, NotificationEmailKind } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Db } from "./client.ts";
import type { Database } from "./schema.ts";

// The outbox processor (workflow-engine.md §5): the worker takes one due row at
// a time in its own transaction, hands it to the handler for its kind, and
// marks it processed. A handler that throws is rolled back to a savepoint, and
// the row is retried later or, after its last attempt, dead-lettered; the next
// row goes ahead either way. Rows hold ids only, so they are safe to log.

export interface OutboxRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

export type OutboxHandler = (trx: Transaction<Database>, row: OutboxRow) => Promise<void>;

/** Delivers an in-app notification to whoever the item reached, if they still see it. */
export const deliverNotification: OutboxHandler = async (trx, row) => {
  await sql`select app.deliver_notification(${row.id}::uuid)`.execute(trx);
};

/** Sends one notification email: the worker's mailer. Throws when it could not. */
export type SendNotificationEmail = (email: NotificationEmail) => Promise<void>;

/**
 * Emails one notification routed "immediately" (RP-357), as its recipient may
 * see it now: nothing when they no longer see the item or may not read the
 * event, when email is paused, the Project muted or closed, or the notification
 * withdrawn (app.take_notification_email). A failed send throws, so the row is
 * retried, then dead-lettered.
 */
export function notificationEmailHandler(send: SendNotificationEmail): OutboxHandler {
  return async (trx, row) => {
    const { rows } = await sql<{
      to_address: string;
      language: Locale;
      kind: NotificationEmailKind;
      work_item_id: string;
      document_number: string | null;
      subject: string;
      step_name: BilingualText | null;
      event_type: NonNullable<NotificationEmail["content"]["event"]>["type"] | null;
      transition_label: BilingualText | null;
      outcome: string | null;
      company_name: BilingualText | null;
      signer_name: BilingualText | null;
    }>`select * from app.take_notification_email(${row.id}::uuid)`.execute(trx);
    const email = rows[0];
    if (!email) return;
    await send({
      to: email.to_address,
      language: email.language,
      kind: email.kind,
      content: {
        workItemId: email.work_item_id,
        documentNumber: email.document_number,
        subject: email.subject,
        step: email.step_name,
        event: email.event_type
          ? {
              type: email.event_type,
              transition: email.transition_label,
              outcome: email.outcome,
              companyName: email.company_name,
              signerName: email.signer_name,
            }
          : null,
      },
    });
  };
}

/** No email handler by default: the worker passes one with its mailer. */
const defaultHandlers: Record<string, OutboxHandler> = { notification: deliverNotification };

export interface ProcessOutboxOptions {
  /** Replaces the handler of a kind (tests use this to make deliveries fail). */
  handlers?: Record<string, OutboxHandler>;
  /** Attempts before a row is dead-lettered. */
  maxAttempts?: number;
  /** How long to wait before retrying, after `attempts` failed attempts. */
  retryDelayMs?: (attempts: number) => number;
  /** Rows to take in this run at most. */
  limit?: number;
}

export interface OutboxRun {
  processed: number;
  failed: number;
  dead: number;
}

/**
 * What a failure is recorded as: a database error by its code only (its text
 * can quote row values), anything else by its message, without NUL bytes.
 */
export function failureOf(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (code && /^[0-9A-Z]{5}$/.test(code)) return `database error ${code}`;
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll("\0", "").slice(0, 500) || "failed";
}

/** 30 s, 1 min, 2 min… up to an hour. */
const backoff = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);

/** Processes the due outbox rows, one transaction each. `db` connects as the app role, with no Member set. */
export async function processOutbox(db: Db, options: ProcessOutboxOptions = {}): Promise<OutboxRun> {
  const handlers = { ...defaultHandlers, ...options.handlers };
  const { maxAttempts = 8, retryDelayMs = backoff, limit = 100 } = options;
  const run: OutboxRun = { processed: 0, failed: 0, dead: 0 };

  type Result = "none" | "processed" | "failed" | "dead" | "gone";
  const recordFailure = async (trx: Transaction<Database>, row: OutboxRow, error: unknown): Promise<Result> => {
    const retryAfterMs = Math.round(retryDelayMs(row.attempts + 1));
    const { rows } = await sql<{ outcome: "retry" | "dead" | "gone" }>`
      select app.outbox_failed(${row.id}::uuid, ${failureOf(error)}, ${maxAttempts}, ${retryAfterMs}::integer) as outcome
    `.execute(trx);
    return rows[0]!.outcome === "retry" ? "failed" : rows[0]!.outcome;
  };

  for (let i = 0; i < limit; i++) {
    let taken: OutboxRow | undefined;
    let result: Result;
    try {
      // Counted once committed: "none" when nothing is due.
      result = await db.transaction().execute(async (trx): Promise<Result> => {
        const { rows } = await sql<OutboxRow>`select * from app.take_outbox_row()`.execute(trx);
        const row = (taken = rows[0]);
        if (!row) return "none";
        await sql`savepoint deliver`.execute(trx);
        try {
          const handler = handlers[row.kind];
          if (!handler) throw new Error(`no handler for outbox kind ${row.kind}`);
          await handler(trx, row);
        } catch (error) {
          await sql`rollback to savepoint deliver`.execute(trx);
          return recordFailure(trx, row, error);
        }
        await sql`release savepoint deliver`.execute(trx);
        await sql`select app.outbox_processed(${row.id}::uuid)`.execute(trx);
        return "processed";
      });
    } catch (error) {
      // The row's whole transaction failed (even recording the failure): record it
      // afresh, so it can't stay first in line and hold up every row behind it.
      if (!taken) throw error;
      const row = taken;
      result = await db.transaction().execute((trx) => recordFailure(trx, row, error));
    }
    if (result === "none") break;
    if (result !== "gone") run[result]++;
  }
  return run;
}

export interface OutboxStats {
  /** Rows not processed, dead-lettered ones included. */
  readonly backlog: number;
  /** Age of the oldest of them; 0 when there are none. */
  readonly oldestAgeSeconds: number;
}

/** Rows not processed and the age of the oldest (0 when none), for the api's outbox report and so the outbox alarms (RP-245). As the app role with no Member set. */
export async function outboxStats(db: Db): Promise<OutboxStats> {
  const { rows } = await sql<{ backlog: number; oldest_age_seconds: number }>`
    select * from app.outbox_stats()
  `.execute(db);
  return { backlog: rows[0]!.backlog, oldestAgeSeconds: rows[0]!.oldest_age_seconds };
}
