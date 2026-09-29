import { sql } from "kysely";
import type { Db } from "./client.ts";
import { APP_ROLE } from "./config.ts";

// What the app role must never be able to do, checked from the inside as the
// role itself: in AWS a one-off task runs this against the deployed database
// after every deploy (RP-213), so the guarantee is tested where it matters,
// not only in the test database. It reads, and changes nothing.

/** Tables the check expects to be empty to a connection with no Member set. */
const RLS_TABLES = ["company", "member", "project", "participant", "work_item", "work_item_event"] as const;

/** Append-only: the legal trail of Work Items (docs/workflow-engine.md) and Rabaed Admin's actions (visibility.md V9). */
const AUDIT_TABLES = ["work_item_event", "admin_action"] as const;

/** Returns what is wrong; empty when `db` is a role that cannot get round row-level security or rewrite the audit trail. */
export async function checkAppRole(db: Db): Promise<string[]> {
  const failures: string[] = [];

  const { rows: [role] } = await sql<{ name: string; superuser: boolean; bypass: boolean }>`
    select rolname as name, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user
  `.execute(db);
  if (!role) return ["cannot read its own role"];
  if (role.name !== APP_ROLE) failures.push(`connected as ${role.name}; ${role.name} is not ${APP_ROLE}`);
  if (role.superuser) failures.push(`${role.name} is a superuser`);
  if (role.bypass) failures.push(`${role.name} bypasses row-level security`);

  // With no Member set, every policy matches nothing.
  for (const table of RLS_TABLES) {
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(db);
    if (rows[0]!.n > 0) failures.push(`${role.name} sees ${rows[0]!.n} rows of ${table} with no Member set`);
  }

  // Turning row security off must be refused, not obeyed.
  if (await rowSecurityOffWorks(db)) failures.push(`${role.name} can switch row-level security off`);

  for (const table of AUDIT_TABLES) {
    const { rows: [may] } = await sql<{ update: boolean; delete: boolean; truncate: boolean }>`
      select has_table_privilege(current_user, ${table}, 'UPDATE') as update,
             has_table_privilege(current_user, ${table}, 'DELETE') as delete,
             has_table_privilege(current_user, ${table}, 'TRUNCATE') as truncate
    `.execute(db);
    if (may!.update) failures.push(`${role.name} may update ${table}`);
    if (may!.delete) failures.push(`${role.name} may delete from ${table}`);
    if (may!.truncate) failures.push(`${role.name} may truncate ${table}`);
  }

  return failures;
}

class RolledBack extends Error {}

/** Whether a query runs with row_security off; PostgreSQL refuses it for a role subject to RLS. */
async function rowSecurityOffWorks(db: Db): Promise<boolean> {
  try {
    await db.transaction().execute(async (trx) => {
      await sql`set local row_security = off`.execute(trx);
      await sql`select count(*) from project`.execute(trx);
      throw new RolledBack();
    });
  } catch (error) {
    if (error instanceof RolledBack) return true;
    if ((error as { code?: string }).code === "42501") return false;
    throw error;
  }
  return true;
}
