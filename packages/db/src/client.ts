import { Kysely, PostgresDialect, sql, type PostgresPool, type Transaction } from "kysely";
import pg from "pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { connectionFromEnv } from "./config.ts";
import { connectWithRetry, rotatingPassword, type RotatingPassword } from "./rotating-password.ts";
import type { Database } from "./schema.ts";
import { secretPassword } from "./secret-password.ts";

export type Db = Kysely<Database>;

export interface CreateDbOptions {
  max?: number;
  /** Read at each new connection instead of the URL's password (see rotating-password.ts). */
  password?: RotatingPassword;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Db {
  const max = options.max ?? 10;
  const { password } = options;
  if (!password) return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }) });

  // The URL's parts, not the URL itself: pg lets a connection string's (empty)
  // password win over the password function.
  const { password: _ignored, ...config } = parseIntoClientConfig(connectionString);
  const pool = new pg.Pool({ ...config, max, password: () => password.get() });
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: {
        connect: () => connectWithRetry(() => pool.connect(), () => password.invalidate()),
        end: () => pool.end(),
        // Kysely reads these to cancel queries on a separate connection.
        options: pool.options,
        Client: (pool as unknown as { Client: PostgresPool["Client"] }).Client,
      },
    }),
  });
}

/** How api and worker open the database as the app or admin role: from the URL, or with the password in Secrets Manager. */
export function createDbFromEnv(role: "app" | "admin", options: Omit<CreateDbOptions, "password"> = {}): Db {
  const { url, passwordSecret } = connectionFromEnv(role);
  return createDb(url, { ...options, password: passwordSecret ? rotatingPassword(secretPassword(passwordSecret)) : undefined });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction acting as `memberId`: RLS policies see this Member
 * through app.current_member_id(). The setting is transaction-local, so it never
 * leaks to the next request that borrows the pooled connection.
 */
export async function withMember<T>(db: Db, memberId: string, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  if (!uuid.test(memberId)) throw new Error("memberId must be a UUID");
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.member_id', ${memberId}, true)`.execute(trx);
    return fn(trx);
  });
}

export async function pingDatabase(db: Db): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
