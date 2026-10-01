import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { buildApp } from "../../src/app.ts";
import { ensureDemo } from "../../src/demo/ensure.ts";
import { DEFAULT_PASSWORD, testConfig } from "./harness.ts";

// Seam suites run against the seeded setup (RP-196): once the database global
// setup has migrated the test database, the demo that `pnpm demo` builds is
// seeded into it, once per database (both seam projects may start at once).
// Each suite's own Companies and scenarios run beside it; demo-seed.test.ts
// walks through it. The test database's demo people sign in with the
// harness's test password; the local demo's comes from .env.demo.
export default async function setup(): Promise<void> {
  const urls = testDatabaseUrls();
  const migrator = createDb(urls.migrator, { max: 2 });
  const db = createDb(urls.app, { max: 2 });
  const adminDb = createDb(urls.admin, { max: 1 });
  try {
    await ensureDemo({ migrator, admin: adminDb }, () => buildApp({ db, config: testConfig, logger: false }), DEFAULT_PASSWORD);
  } finally {
    await Promise.all([migrator.destroy(), db.destroy(), adminDb.destroy()]);
  }
}
