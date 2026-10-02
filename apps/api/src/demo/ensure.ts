import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { DEMO_ENGINEER_EMAIL, DEMO_LAST_ITEM_TITLE, seedDemo, type SeedDatabases } from "./seed.ts";

// Any constant; distinct from the bootstrap and migration locks.
const SEED_LOCK_KEY = 718_200_196;

/**
 * Seeds the demo unless the database has it already. A seed that started (its
 * Rabaed Engineer exists) but never finished (its last Draft is missing) is an
 * error: only a reset can repair it. Serialised on the migrator's connection, so two callers at once seed
 * it once: both seam suites' global setups, or two deploys in dev. `app` is
 * built only when the seed runs.
 */
export async function ensureDemo(databases: SeedDatabases, app: () => Promise<FastifyInstance>, password: string): Promise<"seeded" | "present"> {
  return databases.migrator.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${SEED_LOCK_KEY})`.execute(connection);
    try {
      const { rows: [state] } = await sql<{ started: boolean; finished: boolean }>`
        select exists (select from rabaed_engineer where email = ${DEMO_ENGINEER_EMAIL}) as started,
               exists (select from work_item where title = ${DEMO_LAST_ITEM_TITLE}) as finished
      `.execute(connection);
      if (state!.started && state!.finished) return "present";
      if (state!.started) throw new Error("The demo was only partly seeded; reset it (drop the database and seed again).");
      const api = await app();
      try {
        await seedDemo(api, databases, password);
      } finally {
        await api.close();
      }
      return "seeded";
    } finally {
      await sql`select pg_advisory_unlock(${SEED_LOCK_KEY})`.execute(connection);
    }
  });
}
