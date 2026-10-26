import { createDbFromEnv } from "@rabaed/db";
import { buildApp } from "../src/app.ts";
import { apiConfigFromEnv } from "../src/config.ts";
import { outboxCronFromEnv } from "../src/cron/outbox-cron.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { fastifyHandler } from "../src/vercel.ts";

// The api as a Vercel Function (ADR 0026); vercel.json sends every path here.
// Unlike src/server.ts (local): no listen, no outbox report on a timer and no
// signal handlers, since Vercel starts and stops the instance; and the file
// store's bucket is never created from here. Vercel Cron delivers the outbox
// through this function (RP-1039, src/cron/outbox-cron.ts).
export default fastifyHandler(() => {
  const db = createDbFromEnv("app");
  return buildApp({ db, config: apiConfigFromEnv(), files: createFileStore(fileStoreSettingsFromEnv()), cron: outboxCronFromEnv(db) });
});
