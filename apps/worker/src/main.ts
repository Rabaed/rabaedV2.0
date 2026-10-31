import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, pingDatabase, processOutbox, runScheduledJobs } from "@rabaed/db";
import { mailerFromEnv, type Mailer } from "@rabaed/mailer";
import { z } from "zod";
import { outboxHandlers, scheduledJobs } from "./jobs.ts";
import { workerRunFromEnv } from "./outbox-mode.ts";
import { documentalRecordHandler, recordJobFromEnv, reproduceHandler, workingCopyHandler } from "./record/index.ts";
import { snagReportHandler } from "./snag-report/index.ts";
import { createLogger } from "./log.ts";

// The outbox processor: each poll runs the scheduled jobs that are due (the
// daily digest and the weekly Step Age report, jobs.ts), then delivers the due outbox rows (in-app
// notifications) and sends the notification emails, digests and reports, in
// the recipient's language, linking to the item on the customer web (WEB_URL). The api reports the backlog for the outbox alarms, so they
// see a stopped worker (apps/api/src/outbox-report.ts). It connects as the app
// role with no Member set, which the outbox functions require.
// WORKER_OUTBOX=records (the UAT Records container, RP-1042; outbox-mode.ts) takes only the
// Record job kinds and runs no scheduled job: Vercel Cron does the rest there (RP-1039).
const env = z
  .object({ WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000), WEB_URL: z.url() })
  .parse(process.env);

const run = workerRunFromEnv();
const log = createLogger();
const db = createDbFromEnv("app", { max: 2 });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

// Built at the first email, not at start-up: an environment without a verified
// sender yet still starts, and its emails are retried, then dead-lettered.
let mailer: Mailer | undefined;
// The Documental Record job (RP-620): Chromium starts at the first record, and stops with the worker.
const record = recordJobFromEnv(env.WEB_URL);
const handlers = {
  ...outboxHandlers(() => (mailer ??= mailerFromEnv()), env.WEB_URL),
  documental_record: documentalRecordHandler(record),
  // A Rabaed Engineer's Re-produce of a record (RP-155).
  documental_record_reproduce: reproduceHandler(record),
  // A Working Copy a Member asked for (RP-621): printed with the record's layout, unsealed.
  working_copy: workingCopyHandler(record),
  // A Snag report (RP-677): a plain PDF of what a Member saw in the Snag List, with the record's renderer.
  snag_report: snagReportHandler(record),
};

let lastOk: boolean | undefined;
log.info({ outbox: run.kinds ?? "every kind", scheduledJobs: run.scheduledJobs }, "worker started");
while (!stop.signal.aborted) {
  const ok = await pingDatabase(db);
  if (ok !== lastOk) {
    if (ok) log.info("database ok");
    else log.warn("database unavailable");
  }
  lastOk = ok;
  if (ok) {
    // The scheduled jobs due now (the daily digest...), each once per run time; they queue outbox rows.
    for (const job of run.scheduledJobs ? await runScheduledJobs(db, scheduledJobs) : []) {
      if (job.outcome === "ran") log.info({ job: job.job, runAt: job.runAt }, "scheduled job ran");
      if (job.outcome === "failed") {
        log.error({ job: job.job, err: job.error instanceof Error ? job.error : new Error(String(job.error)) }, "scheduled job failed");
      }
    }
    try {
      // Counts only: never a row's payload.
      const done = await processOutbox(db, { handlers, ...(run.kinds ? { kinds: run.kinds } : {}) });
      if (done.processed || done.failed || done.dead) log.info({ run: done }, "outbox run");
    } catch (error) {
      // Through the err serializer: a database error by its code only.
      log.error({ err: error instanceof Error ? error : new Error(String(error)) }, "outbox run failed");
    }
  }
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await record.close();
await db.destroy();
log.info("worker stopped");
