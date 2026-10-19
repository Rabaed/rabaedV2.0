import { Kysely, PostgresDialect, type PostgresPool, type PostgresPoolClient } from "kysely";
import pg from "pg";
import type { Db } from "../src/client.ts";
import type { Database } from "../src/schema.ts";

/** One statement a connection ran, and the role it ran as (`current_user` just before it). */
export interface RoleOfStatement {
  sql: string;
  role: string;
}

/**
 * A Kysely db on `url` (one connection) that records the role every statement runs as:
 * for a test that a step runs under `set local role` (RP-960). Clear `statements` between steps.
 */
export function statementRoles(url: string): { db: Db; statements: RoleOfStatement[] } {
  const statements: RoleOfStatement[] = [];
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: {
        connect: async () => {
          const client = await pool.connect();
          const recording = {
            release: () => client.release(),
            query: async (text: string, parameters?: unknown[]) => {
              const { rows } = await client.query<{ role: string }>("select current_user as role");
              statements.push({ sql: text, role: rows[0]!.role });
              return client.query(text, parameters);
            },
          };
          return recording as unknown as PostgresPoolClient;
        },
        end: () => pool.end(),
        // Kysely reads these to cancel queries on a separate connection.
        options: pool.options,
        Client: (pool as unknown as { Client: PostgresPool["Client"] }).Client,
      },
    }),
  });
  return { db, statements };
}
