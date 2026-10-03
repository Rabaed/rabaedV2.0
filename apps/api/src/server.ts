import { createDbFromEnv, outboxStats } from "@rabaed/db";
import { z } from "zod";
import { buildApp } from "./app.ts";
import { apiConfigFromEnv } from "./config.ts";
import { createFileStore, ensureLocalBucket, fileStoreSettingsFromEnv } from "./documents/file-store.ts";
import { startOutboxReport } from "./outbox-report.ts";

const env = z
  .object({
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().default(4000),
  })
  .parse(process.env);

const db = createDbFromEnv("app");
const fileStoreSettings = fileStoreSettingsFromEnv();
// Locally the store in Docker starts empty; in AWS the storage stack made the bucket.
if (fileStoreSettings.endpoint) await ensureLocalBucket(fileStoreSettings);
const app = await buildApp({ db, config: apiConfigFromEnv(), files: createFileStore(fileStoreSettings) });
// For the outbox alarms, measured in the database whether or not the worker runs.
// Every minute: the outbox alarms' 5-minute periods each need a few reports.
const OUTBOX_REPORT_INTERVAL_MS = 60_000;
const stopOutboxReport = startOutboxReport({ stats: () => outboxStats(db), log: app.log, intervalMs: OUTBOX_REPORT_INTERVAL_MS });

const shutdown = async () => {
  stopOutboxReport();
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
