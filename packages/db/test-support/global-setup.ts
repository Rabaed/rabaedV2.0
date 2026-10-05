import { resetTestDatabase } from "./reset-test-database.ts";
import { testDatabaseUrls } from "./index.ts";

// Seam suites run against a real Postgres: drop and recreate the test database
// (closing any other connection to it, and refusing a name that doesn't end in
// _test), then create its roles and apply every migration, as CI does on a
// fresh database. A rerun never meets what the last run left behind.
export default async function setup(): Promise<void> {
  await resetTestDatabase(testDatabaseUrls());
}
