import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";

// Tables are added here as their migrations land.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export type Db = Kysely<Database>;

export function createDb(connectionString: string, options: { max?: number } = {}): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: options.max ?? 10 }),
    }),
  });
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
