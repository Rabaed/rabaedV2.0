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

/** 30 s, 1 min, 2 min… up to an hour. */
const backoff = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);

/** Processes the due outbox rows, one transaction each. `db` connects as the app role, with no Member set. */
export async function processOutbox(db: Db, options: ProcessOutboxOptions = {}): Promise<OutboxRun> {
  const handlers = { ...defaultHandlers, ...options.handlers };
  const { maxAttempts = 8, retryDelayMs = backoff, limit = 100 } = options;
  const run: OutboxRun = { processed: 0, failed: 0, dead: 0 };

  for (let i = 0; i < limit; i++) {
    const taken = await db.transaction().execute(async (trx) => {
      const { rows } = await sql<OutboxRow>`select * from app.take_outbox_row()`.execute(trx);
      const row = rows[0];
      if (!row) return false;
      await sql`savepoint deliver`.execute(trx);
      try {
        const handler = handlers[row.kind];
        if (!handler) throw new Error(`no handler for outbox kind ${row.kind}`);
        await handler(trx, row);
      } catch (error) {
        await sql`rollback to savepoint deliver`.execute(trx);
        const message = error instanceof Error ? error.message : String(error);
        const retryAfterMs = Math.round(retryDelayMs(row.attempts + 1));
        const { rows: outcome } = await sql<{ outcome: "retry" | "dead" }>`
          select app.outbox_failed(${row.id}::uuid, ${message}, ${maxAttempts}, ${retryAfterMs}::integer) as outcome
        `.execute(trx);
        if (outcome[0]!.outcome === "dead") run.dead++;
        else run.failed++;
        return true;
      }
      await sql`release savepoint deliver`.execute(trx);
      await sql`select app.outbox_processed(${row.id}::uuid)`.execute(trx);
      run.processed++;
      return true;
    });
    if (!taken) break;
  }
  return run;
}

export interface OutboxStats {
  readonly backlog: number;
  readonly oldestAgeSeconds: number;
}

/** Rows still to process and the age of the oldest (0 when none), for the worker's log. */
export async function outboxStats(db: Db): Promise<OutboxStats> {
  const { rows } = await sql<{ backlog: number; oldest_age_seconds: number }>`
    select * from app.outbox_stats()
  `.execute(db);
  return { backlog: rows[0]!.backlog, oldestAgeSeconds: rows[0]!.oldest_age_seconds };
}
