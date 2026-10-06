import { dailyDigestSchedule, dueRun, type WeeklySchedule } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Db } from "./client.ts";
import type { Database } from "./schema.ts";

// The worker's scheduled jobs (RP-358): the daily digest, and the weekly Step
// Age report (RP-359). On each poll the worker asks every job whether a run is
// due (the pure schedule, @rabaed/domain `dueRun`); a due run is claimed in the
// database (app.claim_scheduled_run) and the job runs in the claim's
// transaction. So each run time runs once, however many workers poll, and a job
// that throws is rolled back with its claim and runs again at the next poll.
// A job should only write outbox rows, so the sending gets the outbox's retries
// and dead letters, one recipient at a time.

export interface ScheduledJob {
  /** Its name in the run records; never change it, or its run times start afresh. */
  readonly name: string;
  readonly schedule: WeeklySchedule;
  /** Runs once per run time, in the transaction that claimed it, as the app role with no Member set. */
  readonly run: (trx: Transaction<Database>, runAt: Date) => Promise<void>;
}

export interface ScheduledRun {
  job: string;
  /** The run time it was for. */
  runAt: Date;
  outcome: "ran" | "already_ran" | "failed";
  error?: unknown;
}

/** Runs each of `jobs` that is due at `now` and hasn't run for that time yet. Returns the due ones. `db` connects as the app role, with no Member set. */
export async function runScheduledJobs(db: Db, jobs: readonly ScheduledJob[], now: Date = new Date()): Promise<ScheduledRun[]> {
  const runs: ScheduledRun[] = [];
  for (const job of jobs) {
    const runAt = dueRun(job.schedule, now);
    if (!runAt) continue;
    try {
      const claimed = await db.transaction().execute(async (trx) => {
        const { rows } = await sql<{ claimed: boolean }>`
          select app.claim_scheduled_run(${job.name}, ${runAt}::timestamptz) as claimed
        `.execute(trx);
        if (!rows[0]!.claimed) return false;
        await job.run(trx, runAt);
        return true;
      });
      runs.push({ job: job.name, runAt, outcome: claimed ? "ran" : "already_ran" });
    } catch (error) {
      runs.push({ job: job.name, runAt, outcome: "failed", error });
    }
  }
  return runs;
}

/** The daily email digest (RP-358): one outbox row per Member with notifications collected for it. */
export const dailyDigestJob: ScheduledJob = {
  name: "daily_digest",
  schedule: dailyDigestSchedule,
  run: async (trx) => {
    await sql`select app.enqueue_notification_digests()`.execute(trx);
  },
};
