// The Supabase gate (RP-1037, ADR 0026): proves a server runs Rabaed as RDS does.
// Run by supabase-gate-run.ts; each step here is testable on its own.

import { sql } from "kysely";
import { z } from "zod";
import { withClient } from "./bootstrap.ts";
import { createDb, withMember } from "./client.ts";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE, databaseNameOf, loginFor, loginSuffixOf, withDatabaseName, type DatabaseUrls } from "./config.ts";

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
  // Locally the worktree's .env has whole URLs: the gate builds its own database beside theirs.
  const localUrl = source.DATABASE_MIGRATOR_URL;
  const database = source.DATABASE_NAME || (localUrl ? `${databaseNameOf(localUrl)}_gate` : "rabaed_gate");
  if (!gateDatabase.test(database)) throw new Error("DATABASE_NAME must end in _gate: the gate drops and rebuilds it");
  const roleUrl = (role: string, variable: "MIGRATOR" | "APP" | "ADMIN"): string => {
    const whole = source[`DATABASE_${variable}_URL`];
    const password = source[`DATABASE_${variable}_PASSWORD`] || (whole ? decodeURIComponent(new URL(whole).password) : "");
    if (!password) throw new Error(`DATABASE_${variable}_PASSWORD is required`);
    const u = new URL(withDatabaseName(superuser, database));
    u.username = encodeURIComponent(loginFor(role, superuser));
    u.password = encodeURIComponent(password);
    return u.toString();
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
// schema exposed (Supabase's troubleshooting guide), so its refusals name it.
const NO_EXPOSED_SCHEMAS = "pg_pgrst_no_exposed_schemas";

export type DataApiCheck =
  /** Passes: the call with the key got the Data-API-off answer. */
  | { outcome: "off"; status: number }
  /** Fails: a 2xx, the API answers. */
  | { outcome: "open"; status: number }
  /** Fails: the gateway refused the key, which says nothing about the Data API. */
  | { outcome: "key refused"; status: number }
  /** Fails: some other answer; `code` is PostgREST's error code when it gave one. */
  | { outcome: "unexpected"; status: number; code?: string }
  | { outcome: "skipped" };

function postgrestCodeOf(body: string): string | undefined {
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * ADR 0026: the Data API is off, so no table is reachable around our api. The
 * call carries Supabase's publishable key, since without a key the gateway
 * answers 401 whether the Data API is on or off; it passes only on PostgREST's
 * answer that no schema is exposed.
 */
export async function checkDataApiOff({
  projectRef,
  publishableKey,
  fetch = globalThis.fetch,
}: {
  projectRef: string | undefined;
  publishableKey?: string;
  fetch?: Fetch;
}): Promise<DataApiCheck> {
  if (!projectRef) return { outcome: "skipped" };
  if (!projectRefPattern.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be a bare project ref (lowercase letters and digits)");
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_PROJECT_REF is set");
  const response = await fetch(`https://${projectRef}.supabase.co/rest/v1/`, {
    headers: { apikey: publishableKey },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const { status } = response;
  const body = await response.text();
  // First: at the root PostgREST may describe the placeholder schema, with a 2xx.
  if (body.includes(NO_EXPOSED_SCHEMAS)) return { outcome: "off", status };
  if (response.ok) return { outcome: "open", status };
  if (status === 401 || status === 403) return { outcome: "key refused", status };
  const code = postgrestCodeOf(body);
  return code ? { outcome: "unexpected", status, code } : { outcome: "unexpected", status };
}
