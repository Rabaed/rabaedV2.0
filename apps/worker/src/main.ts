import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, notificationEmailHandler, pingDatabase, processOutbox } from "@rabaed/db";
import { mailerFromEnv, notificationMessage, type Mailer } from "@rabaed/mailer";
import { z } from "zod";
import { createLogger } from "./log.ts";

// The outbox processor: each poll delivers the due outbox rows (in-app
// notifications) and sends the notification emails routed "immediately", in
// the recipient's language, linking to the item on the customer web (WEB_URL). The api reports the backlog for the outbox alarms, so they
// see a stopped worker (apps/api/src/outbox-report.ts). It connects as the app
// role with no Member set, which the outbox functions require.
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
  }
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await db.destroy();
log.info("worker stopped");
