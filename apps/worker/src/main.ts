import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, notificationEmailHandler, pingDatabase, processOutbox, runStepAgeReports } from "@rabaed/db";
import type { StepAgeReport } from "@rabaed/domain";
import { mailerFromEnv, notificationMessage, stepAgeReportMessage, type Mailer } from "@rabaed/mailer";
import { z } from "zod";
import { createLogger } from "./log.ts";

// The outbox processor: each poll delivers the due outbox rows (in-app
// notifications) and sends the notification emails routed "immediately", in
// the recipient's language, linking to the item on the customer web (WEB_URL). The api reports the backlog for the outbox alarms, so they
// see a stopped worker (apps/api/src/outbox-report.ts). It connects as the app
// role with no Member set, which the outbox functions require. Each poll also
// runs the weekly Step Age report job (RP-359): on Sunday from 07:00 Riyadh
// time it plans the week's reports once, then sends the ones due.
const env = z
  .object({ WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000), WEB_URL: z.url() })
  .parse(process.env);

const log = createLogger();
const db = createDbFromEnv("app", { max: 2 });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

// Built at the first email, not at start-up: an environment without a verified
// sender yet still starts, and its emails are retried, then dead-lettered.
let mailer: Mailer | undefined;
const handlers = {
  email: notificationEmailHandler(async (email) => {
    mailer ??= mailerFromEnv();
    await mailer.send(notificationMessage(email, env.WEB_URL));
  }),
};
const sendStepAgeReport = async (report: StepAgeReport) => {
  mailer ??= mailerFromEnv();
  await mailer.send(stepAgeReportMessage(report, env.WEB_URL));
};

let lastOk: boolean | undefined;
log.info("worker started");
while (!stop.signal.aborted) {
  const ok = await pingDatabase(db);
  if (ok !== lastOk) {
    if (ok) log.info("database ok");
    else log.warn("database unavailable");
  }
  lastOk = ok;
  if (ok) {
    try {
      // Counts only: never a row's payload.
      const run = await processOutbox(db, { handlers });
      if (run.processed || run.failed || run.dead) log.info({ run }, "outbox run");
    } catch (error) {
      // Through the err serializer: a database error by its code only.
      log.error({ err: error instanceof Error ? error : new Error(String(error)) }, "outbox run failed");
    }
    try {
      // The weekly Step Age report (RP-359): planned on Sunday from 07:00 Riyadh time, then sent. Counts only.
      const reports = await runStepAgeReports(db, sendStepAgeReport);
      if (reports.planned || reports.sent || reports.failed || reports.dead) log.info({ reports }, "step age reports run");
    } catch (error) {
      log.error({ err: error instanceof Error ? error : new Error(String(error)) }, "step age reports run failed");
    }
  }
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await db.destroy();
log.info("worker stopped");
