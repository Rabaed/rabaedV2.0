import { sql } from "kysely";
import type { Db } from "../src/client.ts";

/**
 * Every `security definer` function in the `app` schema written in
 * `language sql`, as `app.name(argument types)`. PostgreSQL never inlines such a
 * function and keeps no plan for it, so each call plans its body again (RP-310).
 */
export async function appDefinerFunctionsInSql(db: Db): Promise<string[]> {
  const { rows } = await sql<{ fn: string }>`
    select p.oid::regprocedure::text as fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'app' and p.prosecdef and l.lanname = 'sql'
    order by fn
  `.execute(db);
  return rows.map((row) => row.fn);
}
