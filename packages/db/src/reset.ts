import pg from "pg";
import { bootstrap } from "./bootstrap.ts";
import { databaseNameOf, databaseUrlsFromEnv, withDatabaseName } from "./config.ts";
import { migrate } from "./migrate.ts";

// `pnpm db:reset`: drops the local database and builds it again (roles,
// migrations), for the demo (RP-196). It refuses any database that isn't on
// this machine, so it can never reach an AWS one.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const urls = databaseUrlsFromEnv();
for (const url of [urls.superuser, urls.migrator]) {
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    console.error(`db:reset only resets a local database; ${hostname} is not local.`);
    process.exit(1);
  }
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
