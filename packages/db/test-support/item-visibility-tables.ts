import { sql } from "kysely";
import type { Db } from "../src/client.ts";
import { APP_ROLE } from "../src/config.ts";

// A policy that lets a row through because the caller sees its item:
// app.sees_work_item, app.item_row_seen, or a subquery on work_item (whose own
// policy is app.sees_work_item).
const ITEM_VISIBILITY = String.raw`app\.sees_work_item\s*\(|app\.item_row_seen\s*\(|\mfrom work_item\M`;
// A condition on who the caller is, beyond seeing the item: their Member,
// Company or Participant, or whether their Participant holds the item.
const VIEWER = String.raw`app\.current_(member_id|company_id|authorized_company_id|participant_ids|admin_project_ids)\s*\(|app\.holds_work_item\s*\(`;

/**
 * Every table the app role may SELECT from, or SELECT some columns of, that a
 * permissive SELECT policy for it opens to everyone who sees the row's item:
 * the policy asks about item visibility and nothing about the caller's Member,
 * Company or Participant, and no restrictive policy adds such a condition.
 * Every column the app role reads there goes to every Participant who sees the
 * item (RP-309: `step_assignment` gave away another Participant's internal
 * Steps; `work_item_access.since` the Draft's start time; RP-367).
 *
 * Known limit: the policy text is matched, not parsed, so a caller condition
 * anywhere in it exempts the table, even in an OR branch that item visibility
 * alone still satisfies (`sees_work_item(...) or current_member_id() = ...`).
 */
export async function tablesReadableThroughItemVisibility(db: Db): Promise<string[]> {
  const { rows } = await sql<{ t: string }>`
    with readable as (
      select c.oid, c.oid::regclass::text as t
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
        and pg_catalog.has_any_column_privilege(${APP_ROLE}, c.oid, 'SELECT')
    ),
    app_policy as (
      select pol.polrelid, pol.polpermissive, coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'true') as qual
      from pg_catalog.pg_policy pol
      where pol.polcmd in ('r', '*')
        and (0 = any (pol.polroles)
          or exists (select 1 from unnest(pol.polroles) r where pg_catalog.pg_has_role(${APP_ROLE}, r, 'USAGE')))
    )
    select r.t from readable r
    where exists (
        select 1 from app_policy p
        where p.polrelid = r.oid and p.polpermissive and p.qual ~* ${ITEM_VISIBILITY} and p.qual !~* ${VIEWER}
      )
      and not exists (
        select 1 from app_policy p where p.polrelid = r.oid and not p.polpermissive and p.qual ~* ${VIEWER}
      )
    order by 1
  `.execute(db);
  return rows.map((row) => row.t);
}
