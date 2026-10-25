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
// schema exposed (Supabase's troubleshooting guide), so its refusals name it.
const NO_EXPOSED_SCHEMAS = "pg_pgrst_no_exposed_schemas";

// The table the probe asks for: one every Rabaed database has. Not the OpenAPI root
// /rest/v1/, which Supabase refuses to a publishable or anon key whether the Data API
// is on or off (changelog 42949); a table path is what any client key may ask for.
const PROBE_PATH = "rest/v1/company";
const PROBE_QUERY = "select=id&limit=1";

// PostgreSQL's "insufficient privilege": PostgREST answers it 401 to the anon role a
// publishable key runs as, so a 401 that carries it came from the database, not the gateway.
const INSUFFICIENT_PRIVILEGE = "42501";

export type DataApiCheck =
  /** Passes: the call with the key got the Data-API-off answer. */
  | { outcome: "off"; status: number }
  /** Fails: a 2xx, the table answered. */
  | { outcome: "open"; status: number }
  /** Fails: PostgREST reached the database, whose grants refused the key's role: the Data API is on. */
  | { outcome: "on"; status: number; code: string; message?: string }
  /** Fails: the gateway refused the key, which says nothing about the Data API. */
  | { outcome: "key refused"; status: number; message?: string }
  /** Fails: some other answer; `code` is PostgREST's error code when it gave one. */
  | { outcome: "unexpected"; status: number; code?: string; message?: string }
  | { outcome: "skipped" };

// Room for a PostgREST or gateway message; more is noise in the gate's log.
const MESSAGE_LIMIT = 200;

/** The answer's code and message (PostgREST's JSON, or the gateway's text), the key hidden, the message one short line. */
function answerOf(body: string, publishableKey: string): { code?: string; message?: string } {
  let code: string | undefined;
  let message = body;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === "string") code = parsed.code;
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // Not JSON: the text itself.
  }
  const line = message.split(publishableKey).join("***").replace(/\s+/g, " ").trim().slice(0, MESSAGE_LIMIT);
  return { ...(code ? { code } : {}), ...(line ? { message: line } : {}) };
}

/**
 * ADR 0026: the Data API is off, so no table is reachable around our api. The
 * call asks for a table with Supabase's publishable key (without a key the
 * gateway answers 401 whether the Data API is on or off), on the `apikey`
 * header alone, as Supabase's docs say. It passes only on an answer naming the
 * placeholder schema Supabase exposes with the Data API off.
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
  const response = await fetch(`https://${projectRef}.supabase.co/${PROBE_PATH}?${PROBE_QUERY}`, {
    headers: { apikey: publishableKey },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const { status } = response;
  const body = await response.text();
  // A table that answers is open, whatever its rows say.
  if (response.ok) return { outcome: "open", status };
  if (body.includes(NO_EXPOSED_SCHEMAS)) return { outcome: "off", status };
  const { code, message } = answerOf(body, publishableKey);
  const said = message ? { message } : {};
  if (code === INSUFFICIENT_PRIVILEGE) return { outcome: "on", status, code, ...said };
  if ((status === 401 || status === 403) && !code) return { outcome: "key refused", status, ...said };
  return { outcome: "unexpected", status, ...(code ? { code } : {}), ...said };
}

/** What the gate says when the Data API check fails. */
function dataApiFailure(result: Exclude<DataApiCheck, { outcome: "off" | "skipped" }>): string {
  switch (result.outcome) {
    case "open":
      return `${PROBE_PATH}answered ${result.status}: the Data API is on, a way to the tables around the api`;
    case "on":
      return `${PROBE_PATH}answered ${result.status} (${result.code}${result.message ? `: ${result.message}` : ""}): the Data API is on and reached the database, whose grants refused the login the publishable key runs as`;
    case "key refused":
      return `${PROBE_PATH}refused the publishable key (${result.status}${result.message ? `: ${result.message}` : ""}), which proves nothing about the Data API: check the SUPABASE_PUBLISHABLE_KEY secret`;
    case "unexpected": {
      const said = [result.code, result.message].filter(Boolean).join(": ");
      return `${PROBE_PATH}answered ${result.status}${said ? ` (${said})` : ""}, not the Data-API-off answer (no schema exposed)`;
    }
  }
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

/** The gate's steps, in order (supabase-gate-run.ts runs them), from the environment `env`. */
export function gateSteps({
  fetch,
  seamTwo,
  onUrls,
  env = process.env,
}: {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  /** Seam 2 as CI runs it, against the gate's database. */
  seamTwo: (urls: GateUrls) => Promise<void>;
  /** Given the connections once read, so the log can hide their passwords. */
  onUrls: (urls: GateUrls) => string;
}): GateStep[] {
  const projectRef = env.SUPABASE_PROJECT_REF || undefined;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || undefined;
  let urls: GateUrls | undefined;
  const gate = (): GateUrls => {
    if (!urls) throw new Error("The connections were not read");
    return urls;
  };
  return [
    {
      name: "Read the connections",
      run: async () => {
        urls = gateUrlsFromEnv(env);
        // Checked first, so a missing key fails in seconds, not after seam 2.
        if (projectRef && !publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_PROJECT_REF is set");
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
    // Before seam 2, which takes hours on Supabase and may fail: its failure must not hide this answer,
    // and this one's lets seam 2 run, so one run shows both.
    {
      name: "Supabase's Data API is off",
      keepsGoing: true,
      run: async () => {
        const result = await checkDataApiOff({ projectRef, publishableKey, fetch });
        if (result.outcome === "skipped") return "skipped: no SUPABASE_PROJECT_REF (a local run)";
        if (result.outcome === "off") return `${PROBE_PATH} with the publishable key answered ${result.status}: no schema exposed`;
        throw new Error(dataApiFailure(result));
      },
    },
    { name: "Seam 2", run: () => seamTwo(gate()) },
  ];
}
