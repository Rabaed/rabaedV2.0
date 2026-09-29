import pg from "pg";
import { bootstrap, type BootstrapOptions } from "./bootstrap.ts";
import { databaseNameOf, withDatabaseName, type DatabaseUrls } from "./config.ts";
import { assertLocalDatabases } from "./local-database.ts";
import { migrate } from "./migrate.ts";

export interface ResetOptions extends BootstrapOptions {
  /**
   * Only the dev demo task sets this (RP-213), after checking it runs in a
   * demo environment. Otherwise every database must be on this machine.
   */
  readonly notLocal?: "demo environment";
}

/**
 * Drops the database, closing every connection to it, and builds it again:
 * roles, database, migrations. For the demo only: pnpm db:reset locally, and
 * the demo task in dev, where rotation owns the role passwords
 * (`passwords: "on-create"`).
 */
export async function resetDatabase(urls: DatabaseUrls, { notLocal, ...options }: ResetOptions = {}): Promise<{ database: string; applied: string[] }> {
  if (notLocal !== "demo environment") assertLocalDatabases([urls.superuser, urls.migrator, urls.app, urls.admin]);
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
