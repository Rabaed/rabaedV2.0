// Scratch login roles for the seam tests, a new name each run (RP-1037).
// Behind Supabase's pooler, Supavisor caches each login's SCRAM secret by name: a role
// dropped and created again under the same name gets a new salt, and the next pooled
// login as it fails with 28P01 ("password authentication failed") against the old copy.
import { randomBytes } from "node:crypto";
import { withClient } from "../src/bootstrap.ts";

// The suffix: `_`, the creation time in base-36 seconds (6 characters until 2059), `_`, 8 hex.
const SUFFIX_LENGTH = 16;
// Lowercase, so it needs no quoting; short enough that prefix and suffix fit PostgreSQL's 63.
const prefixPattern = new RegExp(`^[a-z_][a-z0-9_]{0,${63 - SUFFIX_LENGTH - 1}}$`);

// Roles are cluster-wide: another run on the same server (a lane's Postgres shared by two
// implementers) may be using its role now. Only a role older than any run is left over;
// the Supabase gate's job stops at 330 minutes.
const LEFTOVER_AFTER_MS = 6 * 60 * 60_000;

function assertPrefix(prefix: string): void {
  if (!prefixPattern.test(prefix)) throw new Error(`A role prefix is a lowercase identifier of at most ${63 - SUFFIX_LENGTH} characters; got "${prefix}"`);
}

/** `<prefix>_<creation time>_<8 hex>`: a role name no earlier run used. */
export function freshRoleName(prefix: string, now: number = Date.now()): string {
  assertPrefix(prefix);
  return `${prefix}_${Math.floor(now / 1000).toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * Of `names`, those an earlier run under `prefix` left behind: names `freshRoleName(prefix)`
 * gives, created over six hours before `now`; and the bare `prefix`, the fixed name the
 * tests used before.
 */
export function leftoverRoleNames(names: readonly string[], prefix: string, now: number = Date.now()): string[] {
  assertPrefix(prefix);
  const fresh = new RegExp(`^${prefix}_([0-9a-z]{6})_[0-9a-f]{8}$`);
  return names.filter((name) => {
    if (name === prefix) return true;
    const created = fresh.exec(name)?.[1];
    return created !== undefined && now - parseInt(created, 36) * 1000 > LEFTOVER_AFTER_MS;
  });
}

/** Drops the roles an earlier run under `prefix` left behind (see `leftoverRoleNames`), as the superuser. */
export async function dropLeftoverRoles(superuserUrl: string, prefix: string): Promise<void> {
  assertPrefix(prefix);
  await withClient(superuserUrl, async (c) => {
    const { rows } = await c.query<{ name: string }>("select rolname as name from pg_roles where starts_with(rolname, $1)", [prefix]);
    for (const name of leftoverRoleNames(rows.map((r) => r.name), prefix)) await c.query(`drop role if exists ${name}`);
  });
}
