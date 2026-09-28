import { setTimeout as sleep } from "node:timers/promises";
import { createDbFromEnv, pingDatabase } from "@rabaed/db";
import { z } from "zod";

// The outbox processor. For now it only proves it can reach the database as the
// app role; delivering outbox rows (in-app notifications) arrives in RP-195.
const env = z
  .object({ WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000) })
  .parse(process.env);

const db = createDbFromEnv("app", { max: 2 });
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

let lastOk: boolean | undefined;
console.log("worker: started");
while (!stop.signal.aborted) {
  const ok = await pingDatabase(db);
  if (ok !== lastOk) console.log(`worker: database ${ok ? "ok" : "unavailable"}`);
  lastOk = ok;
  await sleep(env.WORKER_POLL_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
}
await db.destroy();
console.log("worker: stopped");
