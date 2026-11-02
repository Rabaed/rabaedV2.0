// Adds the sample Project (RP-1217), Al Nakheel District – Block A, to a local database the demo
// is already in, without a reset: `pnpm demo:add-sample-project` runs it, then spreads its Step Age
// (scripts/sample-project-age.ts). Running it again changes nothing. `pnpm demo` seeds it anyway.
//
// The demo people sign in with the password in .env.demo, as `pnpm demo:seed` wrote it.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertLocalDatabases, createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { buildApp } from "../app.ts";
import { apiConfigFromEnv } from "../config.ts";
import { demoMailbox, seedingConfig } from "../demo/mailbox.ts";
import { addSampleProject } from "../demo/sample-project.ts";
import { createFileStore, ensureLocalBucket, fileStoreSettingsFromEnv } from "../documents/file-store.ts";

const passwordFile = fileURLToPath(new URL("../../../../.env.demo", import.meta.url));
const password = existsSync(passwordFile) ? /^DEMO_PASSWORD=(.+)$/m.exec(readFileSync(passwordFile, "utf8"))?.[1]?.trim() : undefined;
if (!password) {
  console.error("demo:add-sample-project: no .env.demo; seed the demo first (pnpm demo)");
  process.exit(1);
}

const urls = databaseUrlsFromEnv();
try {
  assertLocalDatabases([urls.migrator, urls.app]);
} catch (error) {
  console.error(`demo:add-sample-project: ${(error as Error).message}`);
  process.exit(1);
}

const db = createDb(urls.app, { max: 6 });
const migrator = createDb(urls.migrator, { max: 1 });
const settings = fileStoreSettingsFromEnv();
await ensureLocalBucket(settings);
const app = await buildApp({ db, config: seedingConfig(apiConfigFromEnv()), logger: false, files: createFileStore(settings), mailer: demoMailbox().mailer });
try {
  await addSampleProject(app, migrator, password, { log: console.log });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
  await Promise.all([db.destroy(), migrator.destroy()]);
}
