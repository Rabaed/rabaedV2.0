// Who may EXECUTE each function (RP-319). PostgreSQL lets PUBLIC run a new
// function unless the migration revokes it, so a forgotten `revoke all ... from
// public` leaves a security definer function open to every role (RP-302 did).
// Read from the live catalog, so it sees what the migrations really did.
import { sql } from "kysely";
import type { Db } from "../src/client.ts";

export type FunctionGrant = {
  /** `schema.name(argument types)`, unique per overload. */
  fn: string;
  /** `schema.name`, the key of the allow-list. */
  name: string;
  owner: string;
  /** Roles that may execute it; `PUBLIC` when everyone may. */
  grantees: string[];
};

/** Every function and procedure outside the system schemas and extensions, with who may execute it. */
export async function readFunctionGrants(db: Db): Promise<FunctionGrant[]> {
  const { rows } = await sql<FunctionGrant>`
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
           n.nspname || '.' || p.proname as name,
           pg_get_userbyid(p.proowner) as owner,
           coalesce(
             (array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
               filter (where a.privilege_type = 'EXECUTE'))::text[],
             '{}') as grantees
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    -- A null proacl is the default grant: the owner and PUBLIC.
    left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
    where p.prokind in ('f', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
      and n.nspname not like 'pg_temp%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    group by p.oid, n.nspname, p.proname, p.proowner
    order by 1`.execute(db);
  return rows;
}

/**
 * Allow-list: the roles besides the owner that may execute a function. A
 * function not listed is for `rabaed_app` alone, so any other grant, to
 * `rabaed_admin` or anyone, is a visible decision made here.
 */
export type GrantAllowList = Record<string, readonly string[]>;
export const defaultGrantees: readonly string[] = ["rabaed_app"];

/** One line per function that PUBLIC may execute, or that a role outside its allow-list may. */
export function functionGrantProblems(grants: FunctionGrant[], allow: GrantAllowList): string[] {
  const problems: string[] = [];
  for (const { fn, name, owner, grantees } of grants) {
    if (grantees.includes("PUBLIC")) {
      problems.push(`${fn}: PUBLIC may execute it (revoke all on function ${fn} from public, then grant to the role that needs it)`);
    }
    const permitted = new Set([owner, ...(allow[name] ?? defaultGrantees)]);
    const extra = grantees.filter((g) => g !== "PUBLIC" && !permitted.has(g));
    if (extra.length > 0) problems.push(`${fn}: ${extra.join(", ")} may execute it, not in its allow-list`);
  }
  return problems;
}
