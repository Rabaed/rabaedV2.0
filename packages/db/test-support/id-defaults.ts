import { sql } from "kysely";
import type { Db } from "../src/client.ts";

/**
 * Every `id` column, and every other uuid column with a default, of a table
 * outside the system schemas whose default isn't a random UUIDv4
 * (`gen_random_uuid()`), as `schema.table.column: default`. A time-ordered id
 * (UUIDv7, a sequence) tells anyone who sees it when its row was made, such as
 * when a Draft was started (ADR 0015, visibility.md "Creation Date").
 */
export async function idColumnsNotRandom(db: Db): Promise<string[]> {
  const { rows } = await sql<{ found: string }>`
    select format('%s.%s.%s: %s', n.nspname, c.relname, a.attname, coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default')) as found
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
      and (a.attname = 'id' or (a.atttypid = 'uuid'::regtype and d.adbin is not null))
      and pg_get_expr(d.adbin, d.adrelid) is distinct from 'gen_random_uuid()'
    order by found
  `.execute(db);
  return rows.map((row) => row.found);
}
