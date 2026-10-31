import { sql, type Transaction } from "kysely";
import type { Db } from "../src/client.ts";
import type { OutboxHandler } from "../src/outbox.ts";
import type { Database } from "../src/schema.ts";

// `uat:run-job` (RP-922): the daily digest or the weekly Step Age report, now, whatever the day and hour.
// One transaction: it queues what the scheduled job queues (the same app.enqueue_* function), keeps
// only the chosen Member's rows when `--member` names one (the others it queued are dropped before
// anything commits, so nobody else gets an email), hands each row to the worker's own handler and marks
// it processed. It never claims the scheduled run (app.claim_scheduled_run), so the real schedule still
// runs. A row whose send fails is left queued, for the worker's retries.
//
// It runs as the migrator, not as rabaed_app: the app role cannot see the outbox rows it queued (row-level
// security, no policy), and every function a job and its handlers call is security definer, run as
// their owner, the migrator, whoever calls them; the jobs' own checks of who may read what (the
// recipient's visibility, their settings, a closed Project) are inside those functions. With no
// app.member_id set, as the worker (app.require_worker).

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
  /** Rows whose send failed: left queued for the worker. */
  failed: { row: JobRow; error: string }[];
  /** How many rows the job would have queued for other Members (dropped with `memberEmail`). */
  leftOut: number;
}

export interface RunJobOptions {
  /** The worker's handlers, by outbox kind: `digest` and `step_age_report` with the mailer. */
  handlers: Record<string, OutboxHandler>;
  /** Only this Member's rows (any case). */
  memberEmail?: string;
  dryRun: boolean;
}

/** Thrown to roll a dry run back. */
class DryRun extends Error {
  constructor(readonly run: JobRun) {
    super("dry run");
  }
}

/** What a failure says: a database error by its code only (its text can quote row values). */
function failureOf(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (code && /^[0-9A-Z]{5}$/.test(code)) return `database error ${code}`;
  return error instanceof Error ? error.message : String(error);
}

async function runIn(trx: Transaction<Database>, job: JobName, { handlers, memberEmail, dryRun }: RunJobOptions): Promise<JobRun> {
  const { kind, enqueue } = JOBS[job];
  const handler = handlers[kind];
  if (!handler) throw new Error(`no handler for outbox kind ${kind}`);
  let memberId: string | undefined;
  if (memberEmail !== undefined) {
    const { rows } = await sql<{ id: string }>`select id from member where lower(email) = lower(${memberEmail.trim()})`.execute(trx);
    if (rows.length === 0) throw new Error(`no Member has the email ${memberEmail.trim()}`);
    memberId = rows[0]!.id;
  }
  await enqueue.execute(trx);
  // This transaction's rows: created at its own now(), never processed.
  const { rows: queued } = await sql<{ id: string; payload: Record<string, unknown>; project_id: string | null; member_id: string; email: string }>`
    select o.id, o.payload, o.project_id, m.id as member_id, m.email
    from outbox o join member m on m.id = (o.payload ->> 'member_id')::uuid
    where o.kind = ${kind} and o.created_at = now() and o.processed_at is null
    order by m.email, o.project_id, o.id`.execute(trx);
  const chosen = memberId === undefined ? queued : queued.filter((r) => r.member_id === memberId);
  const others = queued.filter((r) => !chosen.includes(r)).map((r) => r.id);
  if (others.length > 0) await sql`delete from outbox where id = any(${others}::uuid[])`.execute(trx);
  const rowOf = (r: (typeof queued)[number]): JobRow => ({ outboxId: r.id, memberId: r.member_id, email: r.email, projectId: r.project_id });
  const run: JobRun = { job, queued: chosen.map(rowOf), processed: [], failed: [], leftOut: others.length };
  if (dryRun) throw new DryRun(run);
  for (const r of chosen) {
    await sql`savepoint send`.execute(trx);
    try {
      await handler(trx, { id: r.id, kind, payload: r.payload, attempts: 1 });
      await sql`release savepoint send`.execute(trx);
      await sql`select app.outbox_processed(${r.id}::uuid)`.execute(trx);
      run.processed.push(rowOf(r));
    } catch (error) {
      await sql`rollback to savepoint send`.execute(trx);
      run.failed.push({ row: rowOf(r), error: failureOf(error) });
    }
  }
  return run;
}

/** Runs `job` now, as the migrator with no Member set, in one transaction (see above). */
export async function runJob(db: Db, job: JobName, options: RunJobOptions): Promise<JobRun> {
  try {
    return await db.transaction().execute((trx) => runIn(trx, job, options));
  } catch (error) {
    if (error instanceof DryRun) return error.run;
    throw error;
  }
}
