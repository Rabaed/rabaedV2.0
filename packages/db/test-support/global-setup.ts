import { bootstrap } from "../src/bootstrap.ts";
import { migrate } from "../src/migrate.ts";
import { testDatabaseUrls } from "./index.ts";

// Seam suites run against a real Postgres: create the test database and roles,
// then apply every migration, exactly as `pnpm db:setup` does for dev.
export default async function setup(): Promise<void> {
  const urls = testDatabaseUrls();
  await bootstrap(urls);
  await migrate(urls.migrator);
}
