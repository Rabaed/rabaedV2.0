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
  /** Told when the server closes an idle connection (see poolErrorLog); defaults to a JSON line on stderr. */
  onPoolError?: (error: unknown) => void;
}

/**
 * What an idle-connection failure is logged as: the error by class and code
 * only, because PostgreSQL messages can quote row values (CODING_STANDARDS
 * "Logging and errors"; the same shape as the outbox failureOf and the worker log).
 */
export function poolErrorLog(error: unknown) {
  const type = error instanceof Error ? (error.constructor?.name ?? error.name) : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { level: "warn", msg: "idle database connection failed", err: { type, code } };
}

/**
 * node-postgres emits "error" on the pool when the server closes an idle
 * connection (a database reset, an RDS restart or failover); with no listener
 * Node crashes the process. The pool drops that connection itself and the next
 * query opens a new one, so log it and carry on.
 */
function listenForPoolErrors(pool: pg.Pool, onPoolError: CreateDbOptions["onPoolError"]): pg.Pool {
  pool.on("error", onPoolError ?? ((error) => process.stderr.write(JSON.stringify(poolErrorLog(error)) + "\n")));
  return pool;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): Db {
  const max = options.max ?? 10;
  const { password, onPoolError } = options;
  if (!password) return new Kysely<Database>({ dialect: new PostgresDialect({ pool: listenForPoolErrors(new pg.Pool({ connectionString, max }), onPoolError) }) });

  // The URL's parts, not the URL itself: pg lets a connection string's (empty)
  // password win over the password function.
  const { password: _ignored, ...config } = parseIntoClientConfig(connectionString);
  const pool = listenForPoolErrors(new pg.Pool({ ...config, max, password: () => password.get() }), onPoolError);
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
