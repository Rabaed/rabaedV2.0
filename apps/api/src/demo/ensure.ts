import type { Db } from "@rabaed/db";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { DEMO_ENGINEER_EMAIL, seedDemo } from "./seed.ts";

// Any constant; distinct from the bootstrap and migration locks.
const SEED_LOCK_KEY = 718_200_196;

/**
 * Seeds the demo unless the database has it already (its Rabaed Engineer
 * exists). Serialised on `migrator`'s connection, so two callers at once seed
 * it once: both seam suites' global setups, or two deploys in dev. `app` is
 * built only when the seed runs.
 */
export async function ensureDemo(migrator: Db, app: () => Promise<FastifyInstance>, password: string): Promise<"seeded" | "present"> {
  return migrator.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${SEED_LOCK_KEY})`.execute(connection);
    try {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from rabaed_engineer where email = ${DEMO_ENGINEER_EMAIL}
      `.execute(connection);
      if (rows[0]!.n > 0) return "present";
      const api = await app();
      try {
        await seedDemo(api, migrator, password);
      } finally {
        await api.close();
      }
      return "seeded";
    } finally {
      await sql`select pg_advisory_unlock(${SEED_LOCK_KEY})`.execute(connection);
    }
  });
}
