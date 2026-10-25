// Scratch login roles for the seam tests, a new name each run (RP-1037).
// Behind Supabase's pooler, Supavisor caches each login's SCRAM secret by name: a role
// dropped and created again under the same name gets a new salt, and the next pooled
// login as it fails with 28P01 ("password authentication failed") against the old copy.
import { randomBytes } from "node:crypto";
import { withClient } from "../src/bootstrap.ts";

// Lowercase, so it needs no quoting; 8 characters short of PostgreSQL's 63, for the suffix.
const prefixPattern = /^[a-z_][a-z0-9_]{0,54}$/;

/** `<prefix>_<8 hex>`: a role name no earlier run used. */
export function freshRoleName(prefix: string): string {
  if (!prefixPattern.test(prefix)) throw new Error(`A role prefix is a lowercase identifier of at most 55 characters; got "${prefix}"`);
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

/** A regular expression (for `rolname ~ $1`) matching the names `freshRoleName(prefix)` gives: left by a run that stopped before its cleanup. */
export function leftoverRolePattern(prefix: string): string {
  if (!prefixPattern.test(prefix)) throw new Error(`A role prefix is a lowercase identifier of at most 55 characters; got "${prefix}"`);
  return `^${prefix}_[0-9a-f]{8}$`;
}

/** Drops the roles an earlier run under `prefix` left behind (see `leftoverRolePattern`), as the superuser. */
export async function dropLeftoverRoles(superuserUrl: string, prefix: string): Promise<void> {
  const pattern = leftoverRolePattern(prefix);
  await withClient(superuserUrl, async (c) => {
    const { rows } = await c.query<{ name: string }>("select rolname as name from pg_roles where rolname ~ $1", [pattern]);
    for (const { name } of rows) await c.query(`drop role if exists ${name}`);
  });
}
