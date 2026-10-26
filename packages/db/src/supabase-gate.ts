// The Supabase gate (RP-1037, ADR 0026): proves a server runs Rabaed as RDS does.
// Run by supabase-gate-run.ts; each step here is testable on its own.

import { sql } from "kysely";
import { z } from "zod";
import { bootstrap, withClient } from "./bootstrap.ts";
import { createDb, withMember } from "./client.ts";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE, databaseNameOf, loginSuffixOf, loginUrl, withDatabaseName, type DatabaseUrls } from "./config.ts";
import { REMOTE_TEST_SERVER_VARIABLE, remoteTestServerOf } from "./local-database.ts";
import { migrate } from "./migrate.ts";
import { ROLE_PASSWORDS_FLAG, ROLE_PASSWORDS_ON_CREATE } from "./task-flags.ts";

/** The budget, in ms, of each seam test and hook; vitest.config.ts reads it, and runs 180 s without it. */
export const SEAM_TIMEOUT_VARIABLE = "RABAED_SEAM_TIMEOUT_MS";
/** Seam 2's budget on Supabase: 30 minutes, which still stops a hung test well inside the job's 330 (supabase-gate.yml). */
const SUPABASE_SEAM_TIMEOUT_MS = 30 * 60_000;

// The gate's own database: dropped and rebuilt each run, so every migration applies from empty.
const gateDatabase = /^[a-z_][a-z0-9_]*_gate$/;

/** Drops the gate's database left by an earlier run, closing its connections. Refuses any other name. */
export async function dropGateDatabase(superuserUrl: string, database: string): Promise<void> {
  if (!gateDatabase.test(database)) throw new Error(`Refusing to drop ${database}: the gate's database name ends in _gate`);
  await withClient(withDatabaseName(superuserUrl, "postgres"), (c) => c.query(`drop database if exists ${database} with (force)`));
}

/**
 * Before the bootstrap: PostgreSQL 16 lets only a superuser, or a role with
 * BYPASSRLS itself, create a role with BYPASSRLS (Rabaed Admin's, ADR 0007).
 * Supabase's `postgres`, like RDS's master login, is not a superuser.
 */
export async function checkBootstrapRole(superuserUrl: string): Promise<void> {
  const { rows } = await withClient(superuserUrl, (c) =>
    c.query<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>("select rolname as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user"),
  );
  const bootstrapper = rows[0];
  if (!bootstrapper || bootstrapper.rolsuper || bootstrapper.rolbypassrls) return;
  throw new Error(`The bootstrap role ${bootstrapper.name} has neither SUPERUSER nor BYPASSRLS, so PostgreSQL refuses to create ${ADMIN_ROLE} with BYPASSRLS`);
}

/** After the bootstrap: Rabaed Admin's role exists and bypasses row-level security. */
export async function checkBypassRole(superuserUrl: string): Promise<void> {
  const { rows } = await withClient(superuserUrl, (c) => c.query<{ rolbypassrls: boolean }>("select rolbypassrls from pg_roles where rolname = $1", [ADMIN_ROLE]));
  if (!rows[0]) throw new Error(`The bootstrap finished but ${ADMIN_ROLE} does not exist`);
  if (!rows[0].rolbypassrls) throw new Error(`The bootstrap finished but ${ADMIN_ROLE} is not BYPASSRLS: the server dropped the attribute`);
}

export interface PoolerProbe {
  /** The Member set in the transaction was seen by a parameterised query in it. */
  memberSeen: boolean;
  /** The Member a later transaction on the same pool sees: null, since the setting is transaction-local. */
  memberAfterCommit: string | null;
  /** The role Rabaed Admin's connection runs as after `set local role` (RP-960). */
  adminSwitchedTo: string;
}

// Any fixed UUID: the probe sets it as the Member and reads it back; no row is written.
const PROBE_MEMBER = "00000000-0000-4000-8000-000000001037";

/**
 * What the api and Rabaed Admin do per request, each in one transaction, which is
 * all a transaction-mode pooler keeps together: the api sets the Member with
 * `set_config(..., true)` (withMember) and queries with parameters; Admin
 * switches to the app role with `set local role` for Register Import steps.
 */
export async function poolerProbe({ app, admin }: { app: string; admin: string }): Promise<PoolerProbe> {
  const appDb = createDb(app, { max: 1 });
  const adminDb = createDb(admin, { max: 1 });
  try {
    const memberSeen = await withMember(appDb, PROBE_MEMBER, async (trx) => {
      const { rows } = await sql<{ seen: boolean }>`select app.current_member_id() = ${PROBE_MEMBER}::uuid as seen`.execute(trx);
      return rows[0]?.seen === true;
    });
    const after = await appDb.transaction().execute((trx) => sql<{ member: string | null }>`select app.current_member_id()::text as member`.execute(trx));
    const adminSwitchedTo = await adminDb.transaction().execute(async (trx) => {
      await sql`set local role ${sql.raw(APP_ROLE)}`.execute(trx);
      const { rows } = await sql<{ role: string }>`select current_user as role where ${1} = 1`.execute(trx);
      return rows[0]?.role ?? "";
    });
    return { memberSeen, memberAfterCommit: after.rows[0]?.member ?? null, adminSwitchedTo };
  } finally {
    await Promise.all([appDb.destroy(), adminDb.destroy()]);
  }
}

/** Supabase's transaction pooler: the same host as the session pooler, this port. */
export const TRANSACTION_POOLER_PORT = "6543";

export interface GateUrls extends DatabaseUrls {
  /** The app role as the apps connect on Supabase: through the transaction pooler. Locally, the app URL. */
  appTransaction: string;
  /** Rabaed Admin's role through the transaction pooler likewise. */
  adminTransaction: string;
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  return z.string().min(1, `${name} is required`).parse(source[name] ?? "");
}

/** The gate's own database: DATABASE_NAME, else rabaed_gate (locally <the .env database>_gate). */
function gateDatabaseNameOf(source: NodeJS.ProcessEnv): string {
  // Locally the worktree's .env has whole URLs: the gate builds its own database beside theirs.
  const localUrl = source.DATABASE_MIGRATOR_URL;
  const database = source.DATABASE_NAME || (localUrl ? `${databaseNameOf(localUrl)}_gate` : "rabaed_gate");
  if (!gateDatabase.test(database)) throw new Error("DATABASE_NAME must end in _gate: the gate drops and rebuilds it");
  return database;
}

/**
 * The gate's connections. Every role reaches the server `DATABASE_SUPERUSER_URL`
 * reaches (on Supabase the session pooler, since the direct connection is
 * IPv6-only from GitHub runners), with its password from its own variable.
 */
export function gateUrlsFromEnv(source: NodeJS.ProcessEnv = process.env): GateUrls {
  const superuser = z.url().parse(required(source, "DATABASE_SUPERUSER_URL"), { error: () => "DATABASE_SUPERUSER_URL must be a URL" });
  const projectRef = source.SUPABASE_PROJECT_REF || undefined;
  const suffix = loginSuffixOf(superuser);
  if (projectRef && suffix && suffix !== projectRef) {
    throw new Error("DATABASE_SUPERUSER_URL logs in to another project than SUPABASE_PROJECT_REF");
  }
  const database = gateDatabaseNameOf(source);
  const roleUrl = (role: string, variable: "MIGRATOR" | "APP" | "ADMIN"): string => {
    const whole = source[`DATABASE_${variable}_URL`];
    const password = source[`DATABASE_${variable}_PASSWORD`] || (whole ? decodeURIComponent(new URL(whole).password) : "");
    if (!password) throw new Error(`DATABASE_${variable}_PASSWORD is required`);
    return loginUrl(withDatabaseName(superuser, database), role, password);
  };
  const viaTransactionPooler = (url: string): string => {
    const u = new URL(url);
    if (projectRef) u.port = TRANSACTION_POOLER_PORT;
    return u.toString();
  };
  const app = roleUrl(APP_ROLE, "APP");
  const admin = roleUrl(ADMIN_ROLE, "ADMIN");
  return {
    superuser,
    migrator: roleUrl(MIGRATOR_ROLE, "MIGRATOR"),
    app,
    admin,
    appTransaction: viaTransactionPooler(app),
    adminTransaction: viaTransactionPooler(admin),
  };
}

/**
 * The environment the gate runs seam 2 in: `base` (the gate's own), with its
 * connections to the gate's database winning over any .env or stale variable.
 * Seam 2's reset bootstraps again; it must not set the roles' passwords again:
 * Supavisor caches each role's SCRAM secret, and a password set anew (a new
 * salt, even for the same value) fails the next pooled login with 28P01
 * (Supabase: "password authentication failed" after a password change).
 */
export function seamTwoEnv(urls: GateUrls, projectRef: string | undefined, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    DATABASE_SUPERUSER_URL: urls.superuser,
    DATABASE_MIGRATOR_URL: urls.migrator,
    DATABASE_APP_URL: urls.app,
    DATABASE_ADMIN_URL: urls.admin,
    [ROLE_PASSWORDS_FLAG]: ROLE_PASSWORDS_ON_CREATE,
  };
  // The reset of the test database refuses a remote server unless named (local-database.ts).
  if (projectRef) env[REMOTE_TEST_SERVER_VARIABLE] = remoteTestServerOf(urls.superuser);
  else delete env[REMOTE_TEST_SERVER_VARIABLE];
  // A US runner reaches Frankfurt at about 0.45 s a query, some 50 times slower than a
  // local run: a hook past 180 s fails, and keeps running beside the next describe
  // (vitest.config.ts reads this budget).
  if (projectRef) env[SEAM_TIMEOUT_VARIABLE] = String(SUPABASE_SEAM_TIMEOUT_MS);
  else delete env[SEAM_TIMEOUT_VARIABLE];
  return env;
}

const urlCredentials = /\b(postgres(?:ql)?:\/\/)[^@\s/]+@/gi;

/** Hides `secrets` (as given and URL-encoded) and any connection URL's credentials: the gate prints nothing else. */
export function redactor(secrets: readonly string[]): (text: string) => string {
  const hidden = [...new Set(secrets.filter(Boolean).flatMap((s) => [s, encodeURIComponent(s)]))].sort((a, b) => b.length - a.length);
  return (text) => hidden.reduce((out, secret) => out.split(secret).join("***"), text.replace(urlCredentials, "$1***@"));
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// Supabase project refs are 20 lowercase letters; checked so the request can't be sent elsewhere.
const projectRefPattern = /^[a-z0-9]{10,40}$/;

// With the Data API off, Supabase keeps PostgREST running with only this placeholder
// schema exposed, and the schema doesn't exist ("schema pg_pgrst_no_exposed_schemas
// does not exist", https://supabase.com/docs/guides/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist).
const NO_EXPOSED_SCHEMAS = "pg_pgrst_no_exposed_schemas";

// The table the probe asks for: one every Rabaed database has. Not the OpenAPI root
// /rest/v1/, which Supabase refuses to a publishable or anon key whether the Data API
// is on or off (changelog 42949); a table path is what any client key may ask for.
const PROBE_PATH = "rest/v1/company";
const PROBE_QUERY = "select=id&limit=1";

// PostgREST answers from an exposed schema: the Data API is on. 42501, PostgreSQL's
// "insufficient privilege", which PostgREST answers 401 to the anon login a publishable
// key runs as (so that 401 came from the database, not the gateway); PGRST205, no such
// table in the schema it serves (Supabase's `postgres` database need not have ours).
const ANSWERED_FROM_EXPOSED_SCHEMA = new Set(["42501", "PGRST205"]);
// PostgREST's JWT errors (PGRST3xx): the key, as the gateway passed it on, was refused.
const jwtError = /^PGRST3\d\d$/;

// PGRST002 (503): PostgREST could not build its schema cache, and says it is retrying
// (https://docs.postgrest.org/en/v12/references/errors.html, "Group 2 - Schema Cache").
// A passing cause: it rebuilds the cache after DDL, so the check asks again, six asks over
// two minutes, and judges a PGRST002 that changes by what it changes into. A lasting one,
// which Supabase's guide gives: a schema PostgREST is told to expose doesn't exist
// (https://supabase.com/docs/guides/troubleshooting/postgrest-error-pgrst002-could-not-query-the-database-for-the-schema-cache-c396e9).
// With the Data API off that schema is the placeholder, which doesn't exist (above), so
// PostgREST never loads a cache and answers every call so: a 503 PGRST002 through the
// whole window is the Data-API-off answer (data-api-only run 40382032283; the owner,
// 2026-10-26). The database-side check (checkSupabaseRolesHoldNothing) backs it up.
const SCHEMA_CACHE_NOT_LOADED = "PGRST002";
const SCHEMA_CACHE_WAITS_MS = [5_000, 10_000, 20_000, 40_000, 45_000];
const SCHEMA_CACHE_ASKS = SCHEMA_CACHE_WAITS_MS.length + 1;
const SCHEMA_CACHE_WINDOW_S = SCHEMA_CACHE_WAITS_MS.reduce((a, b) => a + b, 0) / 1000;

export type DataApiCheck =
  /**
   * Passes: the call with the key got a Data-API-off answer: PGRST106 naming the
   * placeholder, or PGRST002 on every ask (no schema for PostgREST to serve).
   */
  | { outcome: "off"; status: number; code: "PGRST106" | "PGRST002" }
  /** Fails: a 2xx, the table answered. */
  | { outcome: "open"; status: number }
  /** Fails: PostgREST answered from an exposed schema, though not with rows: the Data API is on. */
  | { outcome: "on"; status: number; code: string; message?: string }
  /** Fails: the gateway (or PostgREST, as a JWT) refused the key, which says nothing about the Data API. */
  | { outcome: "key refused"; status: number; code?: string; message?: string }
  /** Fails: some other answer; `code` is PostgREST's error code when it gave one. */
  | { outcome: "unexpected"; status: number; code?: string; message?: string }
  | { outcome: "skipped" };

// Room for a PostgREST or gateway message; more is noise in the gate's log.
const MESSAGE_LIMIT = 200;

/** An answer as the check reads it: PostgREST's JSON fields, or (`json` false) the gateway's text. */
interface Answer {
  ok: boolean;
  status: number;
  json: boolean;
  code?: string;
  message?: string;
  hint?: string;
}

function answerFrom(ok: boolean, status: number, body: string): Answer {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  try {
    const parsed = (JSON.parse(body) ?? {}) as { code?: unknown; message?: unknown; hint?: unknown };
    return { ok, status, json: true, code: text(parsed.code), message: text(parsed.message), hint: text(parsed.hint) };
  } catch {
    return { ok, status, json: false, message: body };
  }
}

/** The answer's code and message, the key hidden, the message one short line. */
function saidIn({ code, message = "" }: Answer, publishableKey: string): { code?: string; message?: string } {
  const line = message.split(publishableKey).join("***").replace(/\s+/g, " ").trim().slice(0, MESSAGE_LIMIT);
  return { ...(code ? { code } : {}), ...(line ? { message: line } : {}) };
}

/**
 * The placeholder's refusal: PostgREST's PGRST106, 406, "the schema specified
 * ... is not present in the db-schemas configuration"
 * (https://docs.postgrest.org/en/v12/references/errors.html), naming the placeholder as the
 * only schema exposed, in its hint ("Only the following schemas are exposed: ...") or, in
 * older PostgREST, its message ("The schema must be one of the following: ...").
 */
function namesThePlaceholder({ status, json, code, message, hint }: Answer): boolean {
  return status === 406 && json && code === "PGRST106" && [hint, message].some((text) => text?.includes(NO_EXPOSED_SCHEMAS));
}

/** PostgREST's 503 PGRST002, the cache not loaded; checkDataApiOff asks until it changes or the window ends. */
function isSchemaCacheNotLoaded({ status, json, code }: Answer): boolean {
  return status === 503 && json && code === SCHEMA_CACHE_NOT_LOADED;
}

/** The Supabase settings the Data API check needs, checked before it calls anywhere. Refuses a ref that would send the call elsewhere. */
function checkSupabaseSettings(projectRef: string, publishableKey: string | undefined): asserts publishableKey is string {
  if (!projectRefPattern.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be a bare project ref (lowercase letters and digits)");
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_PROJECT_REF is set");
}

/**
 * ADR 0026: the Data API is off, so no table is reachable around our api. The
 * call asks for a table with Supabase's publishable key (without a key the
 * gateway answers 401 whether the Data API is on or off), on the `apikey`
 * header alone, as Supabase's docs say. It passes only on a Data-API-off answer:
 * one naming the placeholder schema Supabase exposes with the Data API off, or
 * PGRST002 through the whole retry window, PostgREST unable to load that schema.
 * Any 2xx, 42501 or PGRST205 fails as on; 401/403 from the gateway as key refused.
 */
export async function checkDataApiOff({
  projectRef,
  publishableKey,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  projectRef: string | undefined;
  publishableKey?: string;
  fetch?: Fetch;
  /** Waits between asks while PostgREST loads its schema cache; tests pass one that doesn't wait. */
  sleep?: (ms: number) => Promise<void>;
}): Promise<DataApiCheck> {
  if (!projectRef) return { outcome: "skipped" };
  checkSupabaseSettings(projectRef, publishableKey);
  const ask = async (): Promise<Answer> => {
    const response = await fetch(`https://${projectRef}.supabase.co/${PROBE_PATH}?${PROBE_QUERY}`, {
      headers: { apikey: publishableKey },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    return answerFrom(response.ok, response.status, await response.text());
  };
  let answer = await ask();
  for (const wait of SCHEMA_CACHE_WAITS_MS) {
    if (answer.ok || answer.code !== SCHEMA_CACHE_NOT_LOADED) break;
    await sleep(wait);
    answer = await ask();
  }
  const { status } = answer;
  // A table that answers is open, whatever its rows say.
  if (answer.ok) return { outcome: "open", status };
  if (namesThePlaceholder(answer)) return { outcome: "off", status, code: "PGRST106" };
  // Still PGRST002 after every ask (the loop stops at any other answer): no schema to serve.
  if (isSchemaCacheNotLoaded(answer)) return { outcome: "off", status, code: SCHEMA_CACHE_NOT_LOADED };
  const { code, message } = saidIn(answer, publishableKey);
  const said = message ? { message } : {};
  if (code && ANSWERED_FROM_EXPOSED_SCHEMA.has(code)) return { outcome: "on", status, code, ...said };
  if ((status === 401 || status === 403) && (!code || jwtError.test(code))) return { outcome: "key refused", status, ...(code ? { code } : {}), ...said };
  return { outcome: "unexpected", status, ...(code ? { code } : {}), ...said };
}

/** What the gate says when the Data API check fails. */
function dataApiFailure(result: Exclude<DataApiCheck, { outcome: "off" | "skipped" }>): string {
  if (result.outcome === "open") return `${PROBE_PATH} answered ${result.status}: the Data API is on, a way to the tables around the api`;
  const said = [result.code, result.message].filter(Boolean).join(": ");
  switch (result.outcome) {
    case "on":
      return `${PROBE_PATH} answered ${result.status} (${said}): the Data API is on, PostgREST answering from an exposed schema`;
    case "key refused":
      return `${PROBE_PATH} refused the publishable key (${[result.status, said].filter(Boolean).join(": ")}), which proves nothing about the Data API: check the SUPABASE_PUBLISHABLE_KEY secret`;
    case "unexpected":
      return `${PROBE_PATH} answered ${result.status}${said ? ` (${said})` : ""}, not a Data-API-off answer (no schema exposed)`;
  }
}

/** The roles Supabase's PostgREST runs a call as: `anon` (a publishable key) and `authenticated` (a signed-in user's JWT). */
export const SUPABASE_API_ROLES = ["anon", "authenticated"] as const;
/** Rabaed's schemas: the tables in `public`, the functions in `app` (migrations/). */
export const RABAED_SCHEMAS = ["public", "app"] as const;
/** UAT's database (scripts/uat-deploy.ts), when the `uat` variable DATABASE_NAME doesn't name another. */
const UAT_DATABASE = "rabaed_uat";
// The roles that own Rabaed's objects: a relation one of them owns is Rabaed's.
const RABAED_ROLES = [MIGRATOR_ROLE, APP_ROLE, ADMIN_ROLE];

/** A privilege a Supabase API role holds on one of Rabaed's objects, directly or through PUBLIC. */
export interface RolePrivilege {
  database: string;
  role: string;
  privilege: string;
  /** table, view, materialized view, foreign table, sequence, function, procedure, aggregate, schema or database. */
  kind: string;
  object: string;
}

export type SupabaseRolesCheck =
  /** Neither role exists: not a Supabase server (a local Postgres). */
  | { outcome: "skipped" }
  | {
      outcome: "checked";
      /** The Supabase API roles the server has. */
      roles: string[];
      /** The Rabaed databases read: the named ones that exist, then any other rabaed_migrator owns. */
      checked: string[];
      /** The named databases that don't exist. */
      missing: string[];
      /** Every privilege found: the check fails on any. */
      privileges: RolePrivilege[];
      /** Rabaed's relations in the `postgres` database, which Supabase's PostgREST serves: the check fails on any. */
      tablesInPostgres: string[];
    };

// has_*_privilege counts grants to PUBLIC and to roles the API role belongs to. SELECT,
// INSERT, UPDATE and REFERENCES go through has_any_column_privilege, which also sees a
// grant on a single column. Extensions' objects (pg_trgm's, in public) are not Rabaed's.
const PRIVILEGES_HELD = `
  with roles as (select unnest($1::text[]) as role),
  relations as (
    select c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) as object
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($2::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  ),
  functions as (
    select p.oid, p.prokind, format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as object
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any($2::text[])
      and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  )
  select r.role, x.privilege,
         case o.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else 'table' end as kind,
         o.object
  from roles r cross join relations o
  cross join lateral unnest(case when o.relkind = 'S' then array['USAGE', 'SELECT', 'UPDATE']
                                 else array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] end) as x(privilege)
  where case when o.relkind = 'S' then pg_catalog.has_sequence_privilege(r.role, o.oid, x.privilege)
             when x.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') then pg_catalog.has_any_column_privilege(r.role, o.oid, x.privilege)
             else pg_catalog.has_table_privilege(r.role, o.oid, x.privilege) end
  union all
  select r.role, 'EXECUTE', case f.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, f.object
  from roles r cross join functions f
  where pg_catalog.has_function_privilege(r.role, f.oid, 'EXECUTE')
  union all
  select r.role, x.privilege, 'schema', pg_catalog.quote_ident(n.nspname)
  from roles r cross join pg_catalog.pg_namespace n cross join unnest(array['USAGE', 'CREATE']) as x(privilege)
  where n.nspname = any($2::text[]) and pg_catalog.has_schema_privilege(r.role, n.oid, x.privilege)
  union all
  select r.role, x.privilege, 'database', pg_catalog.current_database()::text
  from roles r cross join unnest(array['CONNECT', 'CREATE', 'TEMPORARY']) as x(privilege)
  where pg_catalog.has_database_privilege(r.role, pg_catalog.current_database(), x.privilege)
  order by 4, 1, 2`;

/**
 * ADR 0026, behind the Data API being off: Supabase's API roles hold no privilege
 * on any of Rabaed's objects in `databases` (those that exist) or in any other
 * database rabaed_migrator owns (UAT's under another DATABASE_NAME), so even a
 * Data API switched back on, or pointed at a Rabaed database, reaches nothing; and
 * the `postgres` database, the one PostgREST serves, holds no Rabaed relation.
 * Reads the catalogue as the `superuserUrl`'s login; creates and changes nothing.
 */
export async function checkSupabaseRolesHoldNothing(superuserUrl: string, databases: readonly string[]): Promise<SupabaseRolesCheck> {
  const { roles, found, tablesInPostgres } = await withClient(withDatabaseName(superuserUrl, "postgres"), async (c) => {
    const roles = (await c.query<{ name: string }>("select rolname as name from pg_catalog.pg_roles where rolname = any($1::text[]) order by 1", [SUPABASE_API_ROLES])).rows;
    const found = (
      await c.query<{ name: string }>(
        `select datname as name from pg_catalog.pg_database
         where datname = any($1::text[]) or (pg_catalog.pg_get_userbyid(datdba) = $2 and datallowconn and not datistemplate)
         order by 1`,
        [databases, MIGRATOR_ROLE],
      )
    ).rows;
    const tables = await c.query<{ name: string }>(
      `select format('%I.%I', n.nspname, c.relname) as name
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f') and pg_catalog.pg_get_userbyid(c.relowner) = any($1::text[])
       order by 1`,
      [RABAED_ROLES],
    );
    return { roles: roles.map((r) => r.name), found: found.map((d) => d.name), tablesInPostgres: tables.rows.map((t) => t.name) };
  });
  if (!roles.length) return { outcome: "skipped" };
  // The named ones first, in their order, then the others rabaed_migrator owns.
  const candidates = [...databases.filter((d) => found.includes(d)), ...found.filter((d) => !databases.includes(d))];
  const read = await Promise.all(
    candidates.map(async (database) => {
      try {
        const { rows } = await withClient(withDatabaseName(superuserUrl, database), (c) =>
          c.query<Omit<RolePrivilege, "database">>(PRIVILEGES_HELD, [roles, RABAED_SCHEMAS]),
        );
        return { database, privileges: rows.map((row) => ({ database, ...row })) };
      } catch (error) {
        // Dropped since it was listed (a seam 2 reset): as missing as one never there.
        if ((error as { code?: string }).code === "3D000") return { database, privileges: undefined };
        throw error;
      }
    }),
  );
  const checked = read.filter((r) => r.privileges).map((r) => r.database);
  return {
    outcome: "checked",
    roles,
    checked,
    missing: databases.filter((d) => !checked.includes(d)),
    privileges: read.flatMap((r) => r.privileges ?? []),
    tablesInPostgres,
  };
}

// Enough to act on; a role granted everything would otherwise fill the log.
const FINDINGS_SHOWN = 20;

/** What the gate says of the Supabase roles' check: its detail when it passes; it throws, naming every finding, when it fails. */
function supabaseRolesSaid(result: SupabaseRolesCheck): string {
  if (result.outcome === "skipped") return `skipped: this server has no ${SUPABASE_API_ROLES.join(" or ")} (not Supabase)`;
  const findings = [
    ...result.privileges.map(({ database, role, privilege, kind, object }) => `${role} holds ${privilege} on ${kind} ${object} (${database})`),
    ...result.tablesInPostgres.map((table) => `the postgres database, the one PostgREST serves, has Rabaed's ${table}`),
  ];
  if (findings.length) {
    const more = findings.length - FINDINGS_SHOWN;
    throw new Error([...findings.slice(0, FINDINGS_SHOWN), ...(more > 0 ? [`and ${more} more`] : [])].join("; "));
  }
  // A check that read nothing proves nothing.
  if (!result.checked.length) throw new Error(`no Rabaed database on this server to read: ${result.missing.join(", ")} don't exist`);
  return [
    `${result.roles.join(", ")} hold no privilege in ${result.checked.join(", ")}`,
    result.missing.length && `skipped ${result.missing.join(", ")} (no such database)`,
    "no Rabaed table in the postgres database",
  ]
    .filter(Boolean)
    .join("; ");
}

/** A step of the gate. One that keeps going fails the gate but lets the steps after it run, so one run shows their results too. */
export interface GateStep {
  name: string;
  run: () => Promise<string | void>;
  keepsGoing?: boolean;
}

/**
 * Runs the steps in order, saying each one's result; stops at a failed step unless it keeps going.
 * Returns the names of the steps that failed, in order: none when the gate passed.
 */
export async function runGateSteps(steps: readonly GateStep[], say: (line: string) => void, failureOf: (error: unknown) => string): Promise<string[]> {
  const failed: string[] = [];
  for (const { name, run, keepsGoing } of steps) {
    say(`▶ ${name}`);
    try {
      const detail = await run();
      say(`✔ ${name}${detail ? `: ${detail}` : ""}`);
    } catch (error) {
      say(`✘ ${name}: ${failureOf(error)}`);
      failed.push(name);
      if (!keepsGoing) break;
    }
  }
  return failed;
}

/** Set to `data-api`, the gate runs only the Data API check and the Supabase roles' check: minutes, not seam 2's hours. Unset: the whole gate. */
export const GATE_ONLY_VARIABLE = "SUPABASE_GATE_ONLY";
const DATA_API_ONLY = "data-api";

/** The gate's steps, in order (supabase-gate-run.ts runs them), from the environment `env`. */
export function gateSteps({
  fetch,
  sleep,
  supabaseRoles = checkSupabaseRolesHoldNothing,
  seamTwo,
  onUrls,
  env = process.env,
}: {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  /** The Supabase roles' check (checkSupabaseRolesHoldNothing); tests pass a stub. */
  supabaseRoles?: (superuserUrl: string, databases: readonly string[]) => Promise<SupabaseRolesCheck>;
  /** The Data API check's wait while PostgREST loads its schema cache. */
  sleep?: (ms: number) => Promise<void>;
  /** Seam 2 as CI runs it, against the gate's database. */
  seamTwo: (urls: GateUrls) => Promise<void>;
  /** Given the connections once read, so the log can hide their passwords. */
  onUrls: (urls: GateUrls) => string;
}): GateStep[] {
  const projectRef = env.SUPABASE_PROJECT_REF || undefined;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || undefined;
  const only = env[GATE_ONLY_VARIABLE] || undefined;
  // A failed step, not a throw, so the gate's log names it like any other failure.
  if (only && only !== DATA_API_ONLY) {
    const refusal = `${GATE_ONLY_VARIABLE} is "${only}": the gate knows only "${DATA_API_ONLY}" (unset runs the whole gate)`;
    return [{ name: `Read ${GATE_ONLY_VARIABLE}`, run: () => Promise.reject(new Error(refusal)) }];
  }
  let urls: GateUrls | undefined;
  const gate = (): GateUrls => {
    if (!urls) throw new Error("The connections were not read");
    return urls;
  };
  // First: it needs no database, and asked after the migrations' DDL it met PostgREST still
  // reloading its schema cache (run 40234606464, PGRST002). It keeps going, so its failure
  // hides no later step's answer and one run shows both.
  const dataApiOff: GateStep = {
    name: "Supabase's Data API is off",
    keepsGoing: true,
    run: async () => {
      // A run that checks only this must not pass by skipping it.
      if (only && (!projectRef || !publishableKey)) throw new Error(`${GATE_ONLY_VARIABLE}=${DATA_API_ONLY} needs SUPABASE_PROJECT_REF and SUPABASE_PUBLISHABLE_KEY`);
      const result = await checkDataApiOff({ projectRef, publishableKey, fetch, sleep });
      if (result.outcome === "skipped") return "skipped: no SUPABASE_PROJECT_REF (a local run)";
      if (result.outcome === "off" && result.code === SCHEMA_CACHE_NOT_LOADED) {
        return `${PROBE_PATH} with the publishable key answered ${result.status} ${result.code} on all ${SCHEMA_CACHE_ASKS} asks over ${SCHEMA_CACHE_WINDOW_S} s: PostgREST has no schema to serve (the placeholder doesn't exist)`;
      }
      if (result.outcome === "off") return `${PROBE_PATH} with the publishable key answered ${result.status}: no schema exposed`;
      throw new Error(dataApiFailure(result));
    },
  };
  // Read-only, so in both modes; it keeps going, as the Data API check does. In the whole gate,
  // after the migrations, so it reads the grants they just made in the gate's database; UAT's
  // has what its last deploy applied, and the test database what an earlier seam 2 left.
  const supabaseRolesHoldNothing: GateStep = {
    name: "Supabase's anon and authenticated hold no privilege on Rabaed's objects",
    keepsGoing: true,
    run: async () => {
      const superuser = z.url().parse(required(env, "DATABASE_SUPERUSER_URL"), { error: () => "DATABASE_SUPERUSER_URL must be a URL" });
      const own = gateDatabaseNameOf(env);
      // The gate's database, the test database its seam 2 leaves, and UAT's (any other rabaed_migrator owns too).
      return supabaseRolesSaid(await supabaseRoles(superuser, [own, `${own}_test`, UAT_DATABASE]));
    },
  };
  if (only) return [dataApiOff, supabaseRolesHoldNothing];
  return [
    dataApiOff,
    {
      name: "Read the connections",
      run: async () => {
        // The Data API check refused these too, but keeps going: this stops the gate in seconds, not after seam 2.
        if (projectRef) checkSupabaseSettings(projectRef, publishableKey);
        urls = gateUrlsFromEnv(env);
        return onUrls(urls);
      },
    },
    { name: "The bootstrap login may create rabaed_admin with BYPASSRLS", run: () => checkBootstrapRole(gate().superuser) },
    { name: "Drop the gate's database from an earlier run", run: () => dropGateDatabase(gate().superuser, databaseNameOf(gate().migrator)) },
    // Passwords only for a role it creates: setting one again re-salts its SCRAM secret, and
    // Supavisor's cached copy then fails the next pooled login (UAT's apps' included) with 28P01.
    { name: "Bootstrap (rabaed_migrator, rabaed_app, rabaed_admin with BYPASSRLS)", run: () => bootstrap(gate(), { passwords: ROLE_PASSWORDS_ON_CREATE }) },
    { name: "rabaed_admin bypasses row-level security", run: () => checkBypassRole(gate().superuser) },
    {
      name: "Migrate the schema (every migrations/*.sql)",
      run: async () => {
        const { applied } = await migrate(gate().migrator);
        return `applied ${applied.length} from empty`;
      },
    },
    supabaseRolesHoldNothing,
    {
      name: projectRef ? "The transaction pooler carries an api call's transaction" : "An api call's transaction (no pooler locally)",
      run: async () => {
        const probe = await poolerProbe({ app: gate().appTransaction, admin: gate().adminTransaction });
        const problems = [
          !probe.memberSeen && "the Member set in the transaction was not seen by its parameterised query",
          probe.memberAfterCommit !== null && "the Member outlived its transaction",
          probe.adminSwitchedTo !== "rabaed_app" && `set local role ran as ${probe.adminSwitchedTo || "(nothing)"}, not rabaed_app`,
        ].filter(Boolean);
        if (problems.length) throw new Error(problems.join("; "));
      },
    },
    { name: "Seam 2", run: () => seamTwo(gate()) },
  ];
}
