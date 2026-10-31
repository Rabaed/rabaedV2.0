import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE, loginSuffixOf, loginUrl, withDatabaseName, type DatabaseUrls } from "../packages/db/src/config.ts";
import { TRANSACTION_POOLER_PORT } from "../packages/db/src/supabase-gate.ts";
import { ROLE_PASSWORDS_FLAG, ROLE_PASSWORDS_ON_CREATE, DEMO_FLAG, DEMO_ON } from "../packages/db/src/task-flags.ts";

// The UAT deploy's helper (ADR 0026, RP-1043), run by .github/workflows/deploy-uat.yml and
// reset-uat.yml with environment `uat`'s secrets and variables. It prints no secret, but for
// `records-env`, whose lines go straight into `flyctl secrets import` (deploy-records-uat.yml, RP-1042).
//
//   node scripts/uat-deploy.ts migrate            bootstrap and migrate UAT's database (session pooler)
//   node scripts/uat-deploy.ts app-role-check     as rabaed_app: RLS applies, the audit trail can't be rewritten (packages/db/src/check-app-role.ts)
//   node scripts/uat-deploy.ts demo ensure|reset  seed the demo unless it is there | drop, migrate and seed it again;
//                                                 with the file store (FILE_STORE_*), ensure also stores any missing demo image (RP-672)
//   node scripts/uat-deploy.ts records-env        the Records container's secrets (VERSION too), as NAME=VALUE lines (RP-1042)
//   node scripts/uat-deploy.ts project <web|api|admin>   apply the project's settings and Sensitive variables
//   node scripts/uat-deploy.ts bypass admin       print Admin's Protection Bypass for Automation secret while it has
//                                                 Password Protection, else an empty line (mask it first)
//
// Connections are built as the Supabase gate builds them (packages/db/src/supabase-gate.ts):
// every role logs in to Supabase's pooler as `<role>.<project ref>`; migrations and the demo
// go through the session pooler (DATABASE_SUPERUSER_URL's port 5432: they hold a session
// advisory lock), the apps through the transaction pooler (port 6543). Both run with
// DATABASE_ROLE_PASSWORDS=on-create: Supavisor caches each role's SCRAM secret, so a
// password set anew on every deploy would lock the apps out (RP-1043 comment 14538).
//
// Each project's settings and variables follow docs/tech-stack.md › "The three Vercel
// projects (RP-1038)": Vercel REST API, "Update an existing project" (PATCH /v9/projects)
// and "Create one or more environment variables" (POST /v10/projects/{id}/env, upsert);
// every variable Sensitive (type `sensitive`, Vercel docs "Config and Secret environment
// variables"). Admin alone gets the bypass role's URL (ADR 0010). No project gets the
// superuser URL, the migrator's password, the Vercel token, Supabase's keys or the
// read-only fonts key (the runner fetches the fonts before `vercel build`).

export const PROJECTS = ["web", "api", "admin"] as const;
export type ProjectName = (typeof PROJECTS)[number];

const UAT_DATABASE = "rabaed_uat";
const SESSION_POOLER_PORT = "5432";
const POOLER_HOST = /\.pooler\.supabase\.com$/i;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpsUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!URL.canParse(value) || new URL(value).protocol !== "https:") throw new Error(`${name} must be an https URL`);
  return value.replace(/\/+$/, "");
}

export interface UatDatabase {
  /** Over the session pooler: what migrations, the bootstrap and the demo use. */
  session: DatabaseUrls;
  /** rabaed_app over the transaction pooler: the api's connection. */
  appTransaction: string;
  /** rabaed_admin over the transaction pooler: Rabaed Admin's connection. */
  adminTransaction: string;
}

type Role = "MIGRATOR" | "APP" | "ADMIN";
const roleName: Record<Role, string> = { MIGRATOR: MIGRATOR_ROLE, APP: APP_ROLE, ADMIN: ADMIN_ROLE };

/**
 * One role's connection to UAT's database: over the session pooler (`DATABASE_SUPERUSER_URL`'s
 * host and port) or the transaction pooler (port 6543), with `DATABASE_<ROLE>_PASSWORD` only,
 * so a step building one project's variables needs no other role's password.
 */
export function uatRoleUrl(env: NodeJS.ProcessEnv, role: Role, pooler: "session" | "transaction"): string {
  const { superuser, database } = uatServer(env);
  const url = new URL(loginUrl(withDatabaseName(superuser, database), roleName[role], required(env, `DATABASE_${role}_PASSWORD`)));
  if (pooler === "transaction") url.port = TRANSACTION_POOLER_PORT;
  return url.toString();
}

/** All of UAT's connections, from DATABASE_SUPERUSER_URL (the session pooler), the roles' passwords and SUPABASE_PROJECT_REF. */
export function uatDatabase(env: NodeJS.ProcessEnv): UatDatabase {
  const { superuser } = uatServer(env);
  const session = { superuser, migrator: uatRoleUrl(env, "MIGRATOR", "session"), app: uatRoleUrl(env, "APP", "session"), admin: uatRoleUrl(env, "ADMIN", "session") };
  return { session, appTransaction: uatRoleUrl(env, "APP", "transaction"), adminTransaction: uatRoleUrl(env, "ADMIN", "transaction") };
}

/** The checked superuser URL (Supabase's session pooler, this project) and UAT's database name. */
function uatServer(env: NodeJS.ProcessEnv): { superuser: string; database: string } {
  const superuser = required(env, "DATABASE_SUPERUSER_URL");
  if (!URL.canParse(superuser)) throw new Error("DATABASE_SUPERUSER_URL must be a URL");
  const host = new URL(superuser);
  if (!POOLER_HOST.test(host.hostname)) throw new Error("DATABASE_SUPERUSER_URL must be Supabase's session pooler (*.pooler.supabase.com)");
  if ((host.port || SESSION_POOLER_PORT) !== SESSION_POOLER_PORT) throw new Error("DATABASE_SUPERUSER_URL must be Supabase's session pooler (port 5432): migrations hold a session advisory lock");
  if (loginSuffixOf(superuser) !== required(env, "SUPABASE_PROJECT_REF")) throw new Error("DATABASE_SUPERUSER_URL logs in to another project than SUPABASE_PROJECT_REF");
  const database = env.DATABASE_NAME || UAT_DATABASE;
  // The gate drops `*_gate` and seam 2 resets `*_test`: UAT's data must never be either.
  if (!/^[a-z_][a-z0-9_]*$/.test(database) || /_(gate|test)(_|$)/.test(database)) throw new Error("DATABASE_NAME must be a plain name, neither the gate's (*_gate) nor a test database (*_test)");
  return { superuser, database };
}

/** The deploy's secrets a migration or demo command never needs. */
const NOT_FOR_COMMANDS = ["VERCEL_TOKEN", "ADMIN_VERCEL_PASSWORD", "SENDGRID_API_KEY", "CRON_SECRET", "SUPABASE_PUBLISHABLE_KEY", "FONTS_ACCESS_KEY_ID", "FONTS_SECRET_ACCESS_KEY"];
/** UAT's file store (R2), as the api reaches it: for the demo command only. */
const FILE_STORE = ["PROJECT_FILES_BUCKET", "FILE_STORE_ENDPOINT", "FILE_STORE_ACCESS_KEY_ID", "FILE_STORE_SECRET_ACCESS_KEY", "FILE_STORE_REGION"];

/**
 * The environment `pnpm --filter @rabaed/db run setup` and the demo command run in: UAT's
 * session-pooler URLs, on-create passwords, a demo environment. With `fileStore` (the demo
 * command only) it also gets UAT's file store when the step passes its key, so the api it
 * builds stores the demo's images as it stores anyone's (ADR 0007, RP-672); otherwise none of it.
 */
export function commandEnv(env: NodeJS.ProcessEnv, { fileStore = false }: { fileStore?: boolean } = {}): NodeJS.ProcessEnv {
  const { session } = uatDatabase(env);
  const child: NodeJS.ProcessEnv = { ...env };
  for (const name of [...NOT_FOR_COMMANDS, ...FILE_STORE]) delete child[name];
  const passFileStore = fileStore && Boolean(env.FILE_STORE_ACCESS_KEY_ID && env.FILE_STORE_SECRET_ACCESS_KEY);
  return {
    ...child,
    // R2 takes the region `auto`, as the api's own variables say (projectEnv).
    ...(passFileStore
      ? {
          PROJECT_FILES_BUCKET: required(env, "PROJECT_FILES_BUCKET"),
          FILE_STORE_ENDPOINT: httpsUrl(env, "FILE_STORE_ENDPOINT"),
          FILE_STORE_ACCESS_KEY_ID: env.FILE_STORE_ACCESS_KEY_ID,
          FILE_STORE_SECRET_ACCESS_KEY: env.FILE_STORE_SECRET_ACCESS_KEY,
          FILE_STORE_REGION: "auto",
        }
      : {}),
    DATABASE_SUPERUSER_URL: session.superuser,
    DATABASE_MIGRATOR_URL: session.migrator,
    DATABASE_APP_URL: session.app,
    DATABASE_ADMIN_URL: session.admin,
    [ROLE_PASSWORDS_FLAG]: ROLE_PASSWORDS_ON_CREATE,
    [DEMO_FLAG]: DEMO_ON,
  };
}

/**
 * The project's settings, for PATCH /v9/projects/{id}, in the order `applyProject` sends
 * them, one per request; the rest is in its vercel.json.
 */
export function projectSettings(project: ProjectName, env: NodeJS.ProcessEnv): Record<string, unknown> {
  // Run in the Root Directory, so the path climbs to the repository's. The gate builds
  // no preview of Admin (it holds the bypass role).
  const gate = `node ../../scripts/vercel-preview-gate.ts${project === "admin" ? " admin" : ""}`;
  const settings: Record<string, unknown> = {
    nodeVersion: "24.x",
    sourceFilesOutsideRootDirectory: true,
    rootDirectory: `apps/${project}`,
    framework: project === "web" ? "nextjs" : null,
    commandForIgnoringBuildStep: gate,
    serverlessFunctionRegion: "fra1",
    // Vercel Authentication on previews (ADR 0026).
    ssoProtection: { deploymentType: "preview" },
  };
  // Admin's Password Protection (`all`: the production *.vercel.app address too) awaits
  // the owner's yes or no: with no ADMIN_VERCEL_PASSWORD the setting is left as it is,
  // neither applied nor removed.
  const password = env.ADMIN_VERCEL_PASSWORD;
  if (project === "admin" && password) settings.passwordProtection = { deploymentType: "all", password };
  return settings;
}

export interface ProjectVariable {
  key: string;
  value: string;
  type: "sensitive";
  target: ("production" | "preview")[];
}

/** The project's variables, every one Sensitive; `version` (the commit) goes to production only. */
export function projectEnv(project: ProjectName, env: NodeJS.ProcessEnv, version: string): ProjectVariable[] {
  const functions = { NODE_OPTIONS: "--experimental-transform-types", NODEJS_HELPERS: "0" };
  // Read only for the project that gets them: each workflow step passes its project's secrets alone.
  const mail = () => ({ WEB_URL: httpsUrl(env, "UAT_WEB_URL"), MAIL_FROM: required(env, "MAIL_FROM"), SENDGRID_API_KEY: required(env, "SENDGRID_API_KEY") });
  const values: Record<ProjectName, () => Record<string, string>> = {
    web: () => ({ API_URL: httpsUrl(env, "UAT_API_URL") }),
    api: () => ({
      ...functions,
      DATABASE_APP_URL: uatRoleUrl(env, "APP", "transaction"),
      DATABASE_POOL_MAX: "2",
      SESSION_COOKIE_SECURE: "true",
      PROJECT_FILES_BUCKET: required(env, "PROJECT_FILES_BUCKET"),
      FILE_STORE_ENDPOINT: httpsUrl(env, "FILE_STORE_ENDPOINT"),
      FILE_STORE_ACCESS_KEY_ID: required(env, "FILE_STORE_ACCESS_KEY_ID"),
      FILE_STORE_SECRET_ACCESS_KEY: required(env, "FILE_STORE_SECRET_ACCESS_KEY"),
      FILE_STORE_REGION: "auto",
      ...mail(),
      CRON_SECRET: required(env, "CRON_SECRET"),
    }),
    admin: () => ({ ...functions, DATABASE_ADMIN_URL: uatRoleUrl(env, "ADMIN", "transaction"), DATABASE_POOL_MAX: "2", SESSION_COOKIE_SECURE: "true", ...mail() }),
  };
  // Previews of web and the api run a branch's code against UAT (ADR 0026), as the gate
  // allows. Admin has none (vercel-preview-gate.ts), and nothing of its may reach one: it
  // holds the bypass role (ADR 0010). The cron secret is production's: Vercel runs crons
  // on production only. Web's previews call the api's production address, since an api
  // preview sits behind Vercel Authentication.
  const productionOnly = (key: string) => project === "admin" || key === "CRON_SECRET";
  const sensitive = (key: string, value: string, target: ProjectVariable["target"]): ProjectVariable => ({ key, value, type: "sensitive", target });
  return [
    sensitive("APP_VERSION", version, ["production"]),
    ...Object.entries(values[project]()).map(([key, value]) => sensitive(key, value, productionOnly(key) ? ["production"] : ["production", "preview"])),
  ];
}

/**
 * The UAT Records container's secrets (RP-1042, ADR 0026), from the same `uat` environment: the
 * app role over the transaction pooler, the Project files store (the records are stored beside
 * the files, as in AWS) and the web's address the records' QR links to. deploy-records-uat.yml
 * imports them as the Fly app's secrets; its sealing settings are in its Fly config, and the UAT
 * authority is the owner's own Fly secret, never here.
 */
export function recordsContainerEnv(env: NodeJS.ProcessEnv, version: string): Record<string, string> {
  return {
    APP_VERSION: version,
    DATABASE_APP_URL: uatRoleUrl(env, "APP", "transaction"),
    DATABASE_POOL_MAX: "2",
    PROJECT_FILES_BUCKET: required(env, "PROJECT_FILES_BUCKET"),
    FILE_STORE_ENDPOINT: httpsUrl(env, "FILE_STORE_ENDPOINT"),
    FILE_STORE_ACCESS_KEY_ID: required(env, "FILE_STORE_ACCESS_KEY_ID"),
    FILE_STORE_SECRET_ACCESS_KEY: required(env, "FILE_STORE_SECRET_ACCESS_KEY"),
    FILE_STORE_REGION: "auto",
    WEB_URL: httpsUrl(env, "UAT_WEB_URL"),
  };
}

/** `vars` as `fly secrets import` reads them from stdin: one NAME=VALUE a line. A line break in a value is refused. */
export function recordsSecretsImport(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      if (/[\r\n]/.test(value)) throw new Error(`${key} has a line break: it cannot be imported as one secret`);
      return `${key}=${value}\n`;
    })
    .join("");
}

const VERCEL_API = "https://api.vercel.com";

type VercelAnswer = { error?: { code?: string; message?: string } } & Record<string, unknown>;

/** A Vercel REST API request for the team: its status and JSON answer, refused or not. */
async function vercelRequest(env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch, method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  const url = new URL(path, VERCEL_API);
  for (const [name, value] of Object.entries({ ...query, teamId: required(env, "VERCEL_ORG_ID") })) url.searchParams.set(name, value);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${required(env, "VERCEL_TOKEN")}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await res.json().catch(() => ({}))) as VercelAnswer;
  return { ok: res.ok, answer, refusal: refusalText(String(res.status), answer.error) };
}

/** Vercel's refusal as "<status> <code>: <message>", leaving out what it did not say. */
const refusalText = (status: string, error: { code?: string; message?: string } | undefined) =>
  [status, error?.code].filter(Boolean).join(" ") + (error?.message ? `: ${error.message}` : "");

/** A Vercel REST API call for the team; fails on a refusal with Vercel's code and message only. */
async function vercelCall(env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch, method: string, path: string, what: string, body?: unknown, query: Record<string, string> = {}) {
  const { ok, answer, refusal } = await vercelRequest(env, fetch, method, path, body, query);
  if (!ok) throw new Error(`Vercel refused ${what}: ${refusal}`);
  return answer;
}

const projectId = (project: ProjectName, env: NodeJS.ProcessEnv) => required(env, `VERCEL_${project.toUpperCase()}_PROJECT_ID`);

/**
 * Applies the project's settings one per PATCH, so a setting Vercel refuses names itself
 * and the others still apply (Deploy UAT run 40395859131 got one 403 for them all), then
 * upserts its variables. Logs one line per setting; after trying every one, fails naming
 * each refusal with Vercel's status, code and message, never a value. The variables wait
 * for every setting: with ssoProtection refused, previews would hold the secrets openly.
 */
export async function applyProject(
  project: ProjectName,
  env: NodeJS.ProcessEnv,
  version: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  log: (line: string) => void = console.log,
): Promise<void> {
  const id = projectId(project, env);
  const settings = projectSettings(project, env);
  const variables = projectEnv(project, env, version);
  // Missing, they would fail every request below one by one.
  required(env, "VERCEL_TOKEN");
  required(env, "VERCEL_ORG_ID");
  const path = `/v9/projects/${encodeURIComponent(id)}`;
  // Should Vercel quote a value back, Admin's password is the one a setting carries.
  const password = env.ADMIN_VERCEL_PASSWORD;
  const hide = (text: string) => (password ? text.split(password).join("***") : text);
  const refused: string[] = [];
  for (const [field, value] of Object.entries(settings)) {
    const refusal = await vercelRequest(env, fetch, "PATCH", path, { [field]: value }).then(
      ({ ok, refusal }) => (ok ? undefined : hide(refusal)),
      (error: unknown) => `no answer (${hide((error as Error).message)})`,
    );
    log(`${id} ${field}: ${refusal === undefined ? "applied" : `refused (${refusal})`}`);
    if (refusal !== undefined) refused.push(`Vercel refused ${field} on ${id}: ${refusal}`);
  }
  if (refused.length > 0) {
    log(`${id} variables: not sent, a setting was refused`);
    throw new Error(refused.join("; "));
  }
  const saved = await vercelRequest(env, fetch, "POST", `/v10/projects/${encodeURIComponent(id)}/env`, variables, { upsert: "true" });
  if (!saved.ok) throw new Error(`Vercel refused the variables of ${id}: ${saved.refusal}`);
  const failed = (saved.answer as { failed?: { error?: { code?: string; message?: string; key?: string } }[] }).failed ?? [];
  if (failed.length > 0) throw new Error(failed.map(({ error }) => `Vercel did not save ${error?.key ?? "a variable"} on ${id}: ${refusalText("", error)}`).join("; "));
}

type Bypasses = Record<string, { scope?: string }> | undefined;
const automationSecret = (bypasses: Bypasses) => Object.entries(bypasses ?? {}).find(([, value]) => value.scope === "automation-bypass")?.[0];

/**
 * While the project has Password Protection, its Protection Bypass for Automation secret,
 * generated if it has none (Vercel REST API, "Update Protection Bypass for Automation");
 * without protection, "". The smoke sends it to Admin as `x-vercel-protection-bypass`,
 * past Password Protection, and then checks Admin refuses a request without it. It
 * follows Vercel's state, not ADMIN_VERCEL_PASSWORD: an empty secret leaves an earlier
 * protection in place.
 */
export async function automationBypass(project: ProjectName, env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<string> {
  const id = projectId(project, env);
  const current = await vercelCall(env, fetch, "GET", `/v9/projects/${encodeURIComponent(id)}`, `GET project ${id}`);
  if (!current.passwordProtection) return "";
  const found = automationSecret(current.protectionBypass as Bypasses);
  if (found) return found;
  // eslint-disable-next-line rabaed/no-avoid-terms -- `note` is the Vercel API's field: the bypass's label in Vercel's dashboard
  const made = await vercelCall(env, fetch, "PATCH", `/v1/projects/${encodeURIComponent(id)}/protection-bypass`, `a protection bypass for ${id}`, { generate: { note: "deploy-uat.yml smoke (RP-1043)" } });
  const generated = automationSecret(made.protectionBypass as Bypasses);
  if (!generated) throw new Error(`Vercel made no automation bypass for ${id}`);
  return generated;
}

function project(name: string | undefined): ProjectName {
  if (!PROJECTS.includes(name as ProjectName)) throw new Error(`name a project: ${PROJECTS.join(", ")}`);
  return name as ProjectName;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  // shell: pnpm is a .cmd on Windows; the arguments are fixed words, never input.
  const result = spawnSync(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

/**
 * pnpm's arguments for `migrate`, `app-role-check` and `demo ensure|reset`. A package's
 * script goes through `run`, a binary through `exec`: without `run`, db's `setup` ran
 * pnpm's own `setup`, which refuses the --recursive that --filter implies.
 */
export function pnpmCommand(command: string | undefined, argument?: string): string[] | undefined {
  if (command === "migrate") return ["--filter", "@rabaed/db", "run", "setup"];
  if (command === "app-role-check") return ["--filter", "@rabaed/db", "exec", "tsx", "src/check-app-role.ts"];
  if (command === "demo") {
    if (argument !== "ensure" && argument !== "reset") throw new Error("demo ensure|reset");
    return ["--filter", "@rabaed/api", "exec", "tsx", "src/cli/demo-environment.ts", argument];
  }
  return undefined;
}

async function main([command, argument]: string[]): Promise<void> {
  const env = process.env;
  const pnpmArgs = pnpmCommand(command, argument);
  if (pnpmArgs) return run("pnpm", pnpmArgs, commandEnv(env, { fileStore: command === "demo" }));
  if (command === "project") {
    await applyProject(project(argument), env, required(env, "VERSION"));
    // A GitHub Actions notice: Admin is not behind Password Protection from this deploy.
    if (argument === "admin" && !env.ADMIN_VERCEL_PASSWORD) console.log("::notice::ADMIN_VERCEL_PASSWORD is empty: Rabaed Admin's Password Protection was not applied (left as it is in Vercel).");
    return console.log(`uat-deploy: ${argument}'s settings and variables applied`);
  }
  if (command === "bypass") return void process.stdout.write(`${await automationBypass(project(argument), env)}\n`);
  // Secrets on stdout, for `| flyctl secrets import` only: never into a log (RP-1042).
  if (command === "records-env") return void process.stdout.write(recordsSecretsImport(recordsContainerEnv(env, required(env, "VERSION"))));
  throw new Error("Usage: node scripts/uat-deploy.ts migrate | app-role-check | demo ensure|reset | project <web|api|admin> | bypass admin | records-env");
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`uat-deploy: ${(error as Error).message}`);
    process.exit(1);
  });
}
