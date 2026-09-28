import { databaseNameOf, databaseUrlsFromEnv, withDatabaseName, type DatabaseUrls } from "../src/config.ts";

/**
 * The URLs from the environment, pointed at `<database>_test` so the suites
 * never touch the dev database.
 */
export function testDatabaseUrls(): DatabaseUrls {
  const urls = databaseUrlsFromEnv();
  const name = `${databaseNameOf(urls.app)}_test`;
  return {
    superuser: urls.superuser,
    migrator: withDatabaseName(urls.migrator, name),
    app: withDatabaseName(urls.app, name),
  };
}
