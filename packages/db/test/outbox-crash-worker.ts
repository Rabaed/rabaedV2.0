// A worker that dies in a handler, for outbox-crash.test.ts (RP-958): it takes one
// due row, oldest first, and its 'notification' handler exits the process, as an
// out-of-memory kill would. Run with Node; the app role's URL in OUTBOX_CRASH_URL.
import { createDb } from "../src/client.ts";
import { processOutbox } from "../src/outbox.ts";

const db = createDb(process.env.OUTBOX_CRASH_URL!, { max: 1 });
await processOutbox(db, {
  limit: 1,
  maxAttempts: Number(process.env.OUTBOX_CRASH_MAX_ATTEMPTS),
  handlers: { notification: async () => process.exit(1) },
});
// Reached only when the row was not run.
await db.destroy();
