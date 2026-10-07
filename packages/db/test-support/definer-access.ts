import { sql } from "kysely";
import type { Db } from "../src/client.ts";
import { APP_ROLE } from "../src/config.ts";

/**
 * Every `security definer` function in the `app` schema that the app role may
 * execute, takes a work-item id (an input argument of type uuid whose name ends
 * in `item_id`, such as `p_work_item_id`) and never calls `app.sees_work_item`
 * in its body, as `app.name(argument types)`. Such a function runs as its owner,
 * past row-level security, so unless it checks, a direct call tells the caller
 * about an item they can't see (RP-334: `app.item_row_seen`; RP-367).
 * A function the app role can't execute is reached only through one it can,
 * which this checks instead. A call only in a comment (`--` to the end of the
 * line, or `/* … *\/`) is no check: comments are taken out first.
 */
export async function appDefinerFunctionsWithoutAccessCheck(db: Db): Promise<string[]> {
  const { rows } = await sql<{ fn: string }>`
    select p.oid::regprocedure::text as fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and pg_catalog.has_function_privilege(${APP_ROLE}, p.oid, 'EXECUTE')
      and pg_catalog.regexp_replace(pg_catalog.regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '/\\*.*?\\*/', '', 'g')
        !~ 'app\\.sees_work_item\\s*\\('
      and exists (
        select 1
        from unnest(
          p.proargnames,
          coalesce(p.proargmodes, pg_catalog.array_fill('i'::"char", array[p.pronargs::int])),
          coalesce(p.proallargtypes, p.proargtypes::oid[])
        ) as a(name, mode, type)
        where a.mode in ('i', 'b') and a.type = 'uuid'::regtype and a.name ~ 'item_id$'
      )
    order by fn
  `.execute(db);
  return rows.map((row) => row.fn);
}
