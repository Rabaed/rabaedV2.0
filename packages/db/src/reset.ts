import { databaseUrlsFromEnv } from "./config.ts";
import { assertLocalDatabases } from "./local-database.ts";
import { resetDatabase } from "./reset-database.ts";

// `pnpm db:reset`: drops the local database and builds it again (roles,
// migrations), for the demo (RP-196). It refuses unless every database URL is
// on this machine, so it can never reach an AWS one.

const urls = databaseUrlsFromEnv();
try {
  assertLocalDatabases([urls.superuser, urls.migrator, urls.app, urls.admin]);
} catch (error) {
  console.error(`db:reset: ${(error as Error).message}`);
  process.exit(1);
}

const { database, applied } = await resetDatabase(urls);
console.log(`Reset ${database}: applied ${applied.length} migrations.`);
