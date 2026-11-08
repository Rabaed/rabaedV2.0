import { sql } from "kysely";
import type { Db } from "../src/client.ts";

// The Member id grant ratchet (RP-1258; visibility.md V14: no other Company reads a Member's id). Default privileges
// grant each new table whole to the app role, so a new `*_member_id` column is readable the day it lands. Every Member
// id column `role` may SELECT must be on MEMBER_ID_ALLOW with the reason no other Company reads it; every entry must
// still name one. Run at seam 2 as the app role (packages/db/test/rp-1258-visibility-rls.test.ts) and at seam 1 as
// the role the api's own pool connects as (apps/api/test/rp-1258-visibility.test.ts).

/** A column `role` may SELECT that holds a Member's id; `column` is null for a view, which is reported whole. */
export type ReadableMemberId = { table: string; column: string | null };

/**
 * Every Member id column `role` may SELECT in `public`: named `member_id` or `*_member_id`, or under a foreign key to
 * `member(id)`, and `member.id` itself, on a table, granted whole or by column, directly, through PUBLIC or a role it
 * belongs to (`has_column_privilege`); a view's columns by their name. A view or materialized view `role` may SELECT
 * any column of also comes back whole (`column` null): its columns carry no foreign key, so a Member id renamed in
 * it can't be told by its name.
 */
export async function readableMemberIdColumns(db: Db, role: string): Promise<ReadableMemberId[]> {
  const { rows } = await sql<ReadableMemberId>`
    select c.relname as "table", a.attname as "column"
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'f', 'v', 'm')
      and (a.attname ~ '(^|_)member_id$'
        or (c.oid = 'public.member'::regclass and a.attname = 'id')
        or exists (
          select 1 from pg_catalog.pg_constraint f
          where f.contype = 'f' and f.conrelid = c.oid and f.confrelid = 'public.member'::regclass and a.attnum = any (f.conkey)
        ))
      and pg_catalog.has_column_privilege(${role}, c.oid, a.attnum, 'SELECT')
    union all
    select c.relname, null
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and pg_catalog.has_any_column_privilege(${role}, c.oid, 'SELECT')
    order by 1, 2
  `.execute(db);
  return rows;
}

/** An allowed Member id column, as `table.column` (a view: its name alone), with the reason no other Company reads it (V14). */
export type MemberIdAllow = { column: string; reason: string };

const OWN_MEMBER = "own Member's rows only (RLS member_id = app.current_member_id())";
const OWN_PARTICIPANT = "own Participant's rows only (RLS participant_id in app.current_participant_ids())";

// RP-1139 (#705, #714) revoked the columns another Company read: work_item_event.actor_member_id,
// document.uploaded_by_member_id, work_item.created_by_member_id, numbering_pattern.set_by_member_id,
// participant.invited_by_member_id and withdrawn_by_member_id, project.creator_member_id. None may come back here.
export const MEMBER_ID_ALLOW: readonly MemberIdAllow[] = [
  { column: "command_idempotency.member_id", reason: "no SELECT policy for the app role: row-level security gives it no row at all" },
  { column: "company.authorized_person_id", reason: "own Company's row only (RLS id = app.current_company_id())" },
  {
    column: "document.removed_by_member_id",
    reason: "never set on a row anyone reads: set only with removed_at (check document_check1), and RLS shows no removed Document",
  },
  { column: "member.id", reason: "own Company's Members only (RLS company_id = app.current_company_id())" },
  { column: "member_appearance.member_id", reason: OWN_MEMBER },
  { column: "member_board_layout.member_id", reason: `${OWN_MEMBER}, on their own Projects` },
  { column: "member_list_columns.member_id", reason: OWN_MEMBER },
  { column: "member_notification_preference.member_id", reason: OWN_MEMBER },
  { column: "member_signature.member_id", reason: OWN_MEMBER },
  { column: "notification.member_id", reason: OWN_MEMBER },
  { column: "notification_setting.member_id", reason: OWN_MEMBER },
  {
    column: "project_admin.appointed_by_member_id",
    reason:
      "own Company's rows only (RLS member_id in member, own Company), and only app.create_project writes it (20260928210000, redefined 20270202000000), naming the creator themselves",
  },
  { column: "project_admin.member_id", reason: "own Company's Project Admins only (RLS member_id in member, own Company)" },
  { column: "project_member.member_id", reason: OWN_PARTICIPANT },
  {
    column: "project_member_position.project_member_id",
    reason: "own Participant's rows only (RLS project_member_id in project_member, itself own Participant's)",
  },
  { column: "project_mute.member_id", reason: `${OWN_MEMBER}, on their own Projects` },
  { column: "step_assignment.assignee_member_id", reason: `${OWN_PARTICIPANT}, on items they see` },
  { column: "submittal_register_import.default_member_id", reason: OWN_PARTICIPANT },
  { column: "submittal_register_import.run_by_member_id", reason: OWN_PARTICIPANT },
  {
    column: "submittal_register_import_row.assignee_member_id",
    reason: "own Participant's rows only (RLS import_id in submittal_register_import, itself own Participant's)",
  },
  {
    column: "visibility_grant.project_member_id",
    reason: "own Participant's rows only; a Project Admin also reads the Participant-wide rows, where it is null",
  },
  { column: "work_item_watch.member_id", reason: `${OWN_MEMBER}, on their own Projects` },
  { column: "work_item_dimension_value_seen", reason: "a view of work_item_id, project_id, dimension_id, dimension_value_id: no Member id" },
  { column: "work_item_scope_seen", reason: "a view of work_item_id, project_id, scope_id: no Member id" },
];

const ALLOW_FILE = "packages/db/test-support/member-id-grants.ts";

/** The name MEMBER_ID_ALLOW gives a readable Member id: `table.column`, or a view's name alone. */
const allowKey = (r: ReadableMemberId) => (r.column === null ? r.table : `${r.table}.${r.column}`);

/** What breaks the ratchet: a readable Member id column or view that is not allowed, and an entry that names none. */
export function memberIdGrantProblems(readable: readonly ReadableMemberId[], allow: readonly MemberIdAllow[]): string[] {
  const allowed = new Set(allow.map((a) => a.column));
  const found = new Set(readable.map(allowKey));
  const unlisted = readable.flatMap((r) => {
    const name = allowKey(r);
    if (allowed.has(name)) return [];
    return r.column === null
      ? [
          `${name} is a view the app role may SELECT, and it is not on MEMBER_ID_ALLOW: a view's columns carry no foreign key, so a Member id in it can't be found by its name alone; revoke it, or add it to MEMBER_ID_ALLOW in ${ALLOW_FILE} naming its columns (visibility.md V14)`,
        ]
      : [
          `${name} is a Member id column the app role may SELECT, and it is not on MEMBER_ID_ALLOW: revoke it from the app role, or add it to MEMBER_ID_ALLOW in ${ALLOW_FILE} with the reason no other Company reads it (visibility.md V14)`,
        ];
  });
  const stale = allow
    .filter((a) => !found.has(a.column))
    .map((a) => `MEMBER_ID_ALLOW names ${a.column}, which the app role can't SELECT (or is gone): remove the entry`);
  const blank = allow.filter((a) => a.reason.trim() === "").map((a) => `MEMBER_ID_ALLOW's entry ${a.column} gives no reason`);
  const twice = allow.filter((a, i) => allow.findIndex((b) => b.column === a.column) !== i).map((a) => `MEMBER_ID_ALLOW names ${a.column} twice`);
  return [...unlisted, ...stale, ...blank, ...twice];
}
