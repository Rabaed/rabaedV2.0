import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, outboxStats, pingDatabase, processOutbox } from "@rabaed/db";
import { z } from "zod";
import { createLogger, logOutbox } from "./log.ts";

// The outbox processor: each poll delivers the due outbox rows (in-app
// notifications), then logs the backlog for the outbox alarms. It connects as
// the app role with no Member set, which the outbox functions require.
const env = z
  .object({ WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000) })
  .parse(process.env);

const log = createLogger();
const db = createDbFromEnv("app", { max: 2 });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

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
      const run = await processOutbox(db);
      if (run.processed || run.failed || run.dead) log.info({ run }, "outbox run");
      logOutbox(log, await outboxStats(db));
    } catch (error) {
      // The message only: a database error's detail can quote row values.
      log.error({ error: error instanceof Error ? error.message : String(error) }, "outbox run failed");
    }
  }
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await db.destroy();
log.info("worker stopped");
