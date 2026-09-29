import pg from "pg";
import { bootstrap, type BootstrapOptions } from "./bootstrap.ts";
import { databaseNameOf, withDatabaseName, type DatabaseUrls } from "./config.ts";
import { migrate } from "./migrate.ts";

/**
 * Drops the database, closing every connection to it, and builds it again:
 * roles, database, migrations. For the demo only: locally behind pnpm
 * db:reset's guard, and in dev by the demo task (RP-213), where rotation owns
 * the role passwords (`passwords: "on-create"`).
 */
export async function resetDatabase(urls: DatabaseUrls, options: BootstrapOptions = {}): Promise<{ database: string; applied: string[] }> {
  const database = databaseNameOf(urls.migrator);
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`Unsafe database name: ${database}`);
  const client = new pg.Client({ connectionString: withDatabaseName(urls.superuser, "postgres") });
  await client.connect();
  try {
    await client.query(`drop database if exists ${database} with (force)`);
  } finally {
    await client.end();
  }
  await bootstrap(urls, options);
  const { applied } = await migrate(urls.migrator);
  return { database, applied };
}
