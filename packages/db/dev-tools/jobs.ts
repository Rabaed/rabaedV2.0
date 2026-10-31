import { sql, type Transaction } from "kysely";
import type { Db } from "../src/client.ts";
import { failureOf, type OutboxHandler } from "../src/outbox.ts";
import type { Database } from "../src/schema.ts";

// `uat:run-job` (RP-922): the daily digest or the weekly Step Age report, now, whatever the day and hour.
// It never claims the scheduled run (app.claim_scheduled_run), so the real schedule still runs.
//
// 1. Queue, as the migrator, in one transaction: the scheduled job's own app.enqueue_* function, then
//    the rows it queued, read back (rabaed_app cannot see outbox rows: row-level security, no policy).
//    With `--member`, every row queued for anyone else is dropped before it commits, so nobody else gets
//    an email. A dry run lists the rows and rolls back.
// 2. Send, on the worker's own connection: rabaed_app with no Member set, the role the worker and the
//    api's cron pass use. Each row in its own transaction, as processOutbox's second step does it: held
//    (app.hold_outbox_row: false when the worker already took it), handed to the worker's own handler,
//    which builds the email from what its recipient may see now, and marked processed. A send that
//    fails is rolled back and the row left queued, for the worker's retries.

export const JOBS = {
  digest: { kind: "digest", enqueue: sql<{ n: number }>`select app.enqueue_notification_digests() as n` },
  "weekly-report": { kind: "step_age_report", enqueue: sql<{ n: number }>`select app.enqueue_step_age_reports() as n` },
} as const;

export type JobName = keyof typeof JOBS;

export interface JobRow {
  outboxId: string;
  memberId: string;
  email: string;
  /** The Project of a weekly report; null for a digest (it covers every Project). */
  projectId: string | null;
}

export interface JobRun {
  job: JobName;
  /** The rows queued, the chosen Member's only with `memberEmail`. */
  queued: JobRow[];
  /** Handed to the handler and marked processed: none on a dry run. */
  processed: JobRow[];
  /** Taken by the worker between the queueing and the sending. */
  takenByWorker: JobRow[];
  /** Rows whose send failed: left queued for the worker. */
  failed: { row: JobRow; error: string }[];
  /** How many rows the job would have queued for other Members (dropped with `memberEmail`). */
  leftOut: number;
}

export interface JobConnections {
  /** Queues and reads back the rows. */
  migrator: Db;
  /** The worker's: rabaed_app with no Member set. Every row is sent through it. */
  worker: Db;
}

export interface RunJobOptions {
  /** The worker's handlers, by outbox kind: `digest` and `step_age_report` with the mailer. */
  handlers: Record<string, OutboxHandler>;
  /** Only this Member's rows (any case). */
  memberEmail?: string;
  dryRun: boolean;
}

type Queued = { row: JobRow; payload: Record<string, unknown> };

/** Thrown to roll a dry run back. */
class DryRun extends Error {
  // Plain fields, not parameter properties: Node's type stripping (node scripts/uat-run-job.ts) refuses those.
  readonly queued: Queued[];
  readonly leftOut: number;
  constructor(queued: Queued[], leftOut: number) {
    super("dry run");
    this.queued = queued;
    this.leftOut = leftOut;
  }
}

/** Step 1: queue as the scheduled job does, keep the chosen Member's rows only. */
async function addRows(trx: Transaction<Database>, job: JobName, { memberEmail, dryRun }: RunJobOptions): Promise<{ queued: Queued[]; leftOut: number }> {
  const { kind, enqueue } = JOBS[job];
  let memberId: string | undefined;
  if (memberEmail !== undefined) {
    const { rows } = await sql<{ id: string }>`select id from member where lower(email) = lower(${memberEmail.trim()})`.execute(trx);
    // Never the email itself: inside the GitHub job the log is public.
    if (rows.length === 0) throw new Error("no Member has the --member email");
    memberId = rows[0]!.id;
  }
  await enqueue.execute(trx);
  // This transaction's rows: created at its own now(), never processed.
  const { rows } = await sql<{ id: string; payload: Record<string, unknown>; project_id: string | null; member_id: string; email: string }>`
    select o.id, o.payload, o.project_id, m.id as member_id, m.email
    from outbox o join member m on m.id = (o.payload ->> 'member_id')::uuid
    where o.kind = ${kind} and o.created_at = now() and o.processed_at is null
    order by m.email, o.project_id, o.id`.execute(trx);
  const chosen = memberId === undefined ? rows : rows.filter((r) => r.member_id === memberId);
  const others = rows.filter((r) => !chosen.includes(r)).map((r) => r.id);
  if (others.length > 0) await sql`delete from outbox where id = any(${others}::uuid[])`.execute(trx);
  const queued = chosen.map((r) => ({ row: { outboxId: r.id, memberId: r.member_id, email: r.email, projectId: r.project_id }, payload: r.payload }));
  if (dryRun) throw new DryRun(queued, others.length);
  return { queued, leftOut: others.length };
}

/** Step 2, for one row, on the worker's connection: "processed", "taken" by the worker meanwhile, or the failure. */
async function send(worker: Db, kind: string, handler: OutboxHandler, { row, payload }: Queued): Promise<"processed" | "taken" | { error: string }> {
  return worker.transaction().execute(async (trx) => {
    // Never taken, so its attempts are 0; locked while the handler runs, as the worker locks it.
    const { rows } = await sql<{ held: boolean }>`select app.hold_outbox_row(${row.outboxId}::uuid, 0) as held`.execute(trx);
    if (!rows[0]!.held) return "taken";
    await sql`savepoint send`.execute(trx);
    try {
      await handler(trx, { id: row.outboxId, kind, payload, attempts: 1 });
    } catch (error) {
      await sql`rollback to savepoint send`.execute(trx);
      return { error: failureOf(error) };
    }
    await sql`release savepoint send`.execute(trx);
    await sql`select app.outbox_processed(${row.outboxId}::uuid)`.execute(trx);
    return "processed";
  });
}

/** Runs `job` now: queued as the migrator, sent on the worker's connection (see above). */
export async function runJob({ migrator, worker }: JobConnections, job: JobName, options: RunJobOptions): Promise<JobRun> {
  const { kind } = JOBS[job];
  const handler = options.handlers[kind];
  if (!handler) throw new Error(`no handler for outbox kind ${kind}`);
  let queued: Queued[];
  let leftOut: number;
  try {
    ({ queued, leftOut } = await migrator.transaction().execute((trx) => addRows(trx, job, options)));
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
    return { job, queued: error.queued.map((q) => q.row), processed: [], takenByWorker: [], failed: [], leftOut: error.leftOut };
  }
  const run: JobRun = { job, queued: queued.map((q) => q.row), processed: [], takenByWorker: [], failed: [], leftOut };
  for (const q of queued) {
    const outcome = await send(worker, kind, handler, q);
    if (outcome === "processed") run.processed.push(q.row);
    else if (outcome === "taken") run.takenByWorker.push(q.row);
    else run.failed.push({ row: q.row, error: outcome.error });
  }
  return run;
}
