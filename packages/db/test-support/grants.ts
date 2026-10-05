import { sql } from "kysely";
import type { Db } from "../src/client.ts";
import { APP_ROLE } from "../src/config.ts";

/**
 * Every function in the `app` schema that PUBLIC may execute, as
 * `app.name(argument types)`. A function with no explicit grants (`proacl` is
 * null) has the default privileges, which give EXECUTE to PUBLIC.
 */
export async function appFunctionsExecutableByPublic(db: Db): Promise<string[]> {
  const { rows } = await sql<{ fn: string }>`
    select p.oid::regprocedure::text as fn
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and exists (
        select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    order by fn
  `.execute(db);
  return rows.map((row) => row.fn);
}

/**
 * The table-level privileges the app role holds on `work_item`, directly, via
 * PUBLIC or via a role it belongs to. The app role reads `work_item` through
 * column grants only.
 */
export async function wholeTableGrantsOnWorkItem(db: Db): Promise<string[]> {
  const { rows } = await sql<{ privilege: string }>`
    select privilege
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege
    where pg_catalog.has_table_privilege(${APP_ROLE}, 'public.work_item', privilege)
    order by privilege
  `.execute(db);
  return rows.map((row) => row.privilege);
}
