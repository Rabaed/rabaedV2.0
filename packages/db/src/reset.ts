import pg from "pg";
import { bootstrap } from "./bootstrap.ts";
import { databaseNameOf, databaseUrlsFromEnv, withDatabaseName } from "./config.ts";
import { assertLocalDatabases } from "./local-database.ts";
import { migrate } from "./migrate.ts";

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

const database = databaseNameOf(urls.migrator);
if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`Unsafe database name: ${database}`);
const client = new pg.Client({ connectionString: withDatabaseName(urls.superuser, "postgres") });
await client.connect();
try {
  await client.query(`drop database if exists ${database} with (force)`);
} finally {
  await client.end();
}
await bootstrap(urls);
const { applied } = await migrate(urls.migrator);
console.log(`Reset ${database}: applied ${applied.length} migrations.`);
