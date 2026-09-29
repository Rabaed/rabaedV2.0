import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { buildApp } from "../../src/app.ts";
import { DEMO_ENGINEER_EMAIL, seedDemo } from "../../src/demo/seed.ts";
import { DEFAULT_PASSWORD, testConfig } from "./harness.ts";

// Seam suites run against the seeded setup (RP-196): once the database global
// setup has migrated the test database, the demo Project that `pnpm demo`
// builds is seeded into it, once per database (both seam projects may start at
// once, so under a lock). Each suite's own Companies and scenarios run beside
// it; demo-seed.test.ts walks through it. The test database's demo people sign
// in with the harness's test password; the local demo's comes from .env.demo.

// Any constant; distinct from the bootstrap and migration locks.
const SEED_LOCK_KEY = 718_200_196;

export default async function setup(): Promise<void> {
  const urls = testDatabaseUrls();
  // One connection: the session-level lock lives on it until destroy() closes it.
  const migrator = createDb(urls.migrator, { max: 1 });
  try {
    await sql`select pg_advisory_lock(${SEED_LOCK_KEY})`.execute(migrator);
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from rabaed_engineer where email = ${DEMO_ENGINEER_EMAIL}
    `.execute(migrator);
    if (rows[0]!.n > 0) return;
    const db = createDb(urls.app, { max: 2 });
    const adminDb = createDb(urls.admin, { max: 1 });
    const app = await buildApp({ db, adminDb, config: testConfig, logger: false });
    try {
      await seedDemo(app, migrator, DEFAULT_PASSWORD);
    } finally {
      await app.close();
      await Promise.all([db.destroy(), adminDb.destroy()]);
    }
  } finally {
    await migrator.destroy();
  }
}
