import { databaseNameOf, type DatabaseUrls } from "../src/config.ts";
import { resetDatabase } from "../src/reset-database.ts";

/** Throws unless the database is a test database: its name ends in `_test`. */
export function assertTestDatabase(urls: DatabaseUrls): void {
  const name = databaseNameOf(urls.migrator);
  if (!name.endsWith("_test")) throw new Error(`Refusing to drop ${name || "(none)"}: a test database's name ends in _test.`);
}

/**
 * Drops `<db>_test` and builds it again (roles, migrations), so a seam run never
 * sees what an earlier run left behind. Other connections to it are closed;
 * no other database is touched.
 */
export async function resetTestDatabase(urls: DatabaseUrls): Promise<void> {
  assertTestDatabase(urls);
  await resetDatabase(urls);
}
