import { testDatabaseUrls } from "./index.ts";
import { prepareTestDatabase } from "./reset-test-database.ts";

// Seam suites run against a real Postgres: drop and recreate the test database
// (closing any other connection to it, and refusing a name that doesn't end in
// _test), then create its roles and apply every migration, as CI does on a
// fresh database. A rerun never meets what the last run left behind. Once per
// Vitest process, under a lock another run of the same database refuses
// (prepareTestDatabase says why).
export default async function setup(): Promise<() => Promise<void>> {
  return prepareTestDatabase(testDatabaseUrls());
}
