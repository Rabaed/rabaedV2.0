import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { buildApp } from "../../src/app.ts";
import { seedDemo } from "../../src/demo/seed.ts";
import { testConfig } from "./harness.ts";

// Seam suites run against the seeded setup (RP-196): after the database global
// setup has migrated the test database, the demo Project is seeded into it
// (with unique emails and CR numbers, so it sits beside every run before it),
// and each suite's own Companies and scenarios run alongside it.
export default async function setup(): Promise<void> {
  const urls = testDatabaseUrls();
  const db = createDb(urls.app, { max: 2 });
  const adminDb = createDb(urls.admin, { max: 1 });
  const migrator = createDb(urls.migrator, { max: 1 });
  const app = await buildApp({ db, adminDb, config: testConfig, logger: false });
  try {
    await seedDemo(app, migrator, { password: `demo-${randomUUID()}`, unique: true });
  } finally {
    await app.close();
    await Promise.all([db.destroy(), adminDb.destroy(), migrator.destroy()]);
  }
}
