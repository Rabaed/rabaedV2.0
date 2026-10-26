import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE, loginSuffixOf, loginUrl, withDatabaseName, type DatabaseUrls } from "../packages/db/src/config.ts";
import { TRANSACTION_POOLER_PORT } from "../packages/db/src/supabase-gate.ts";
import { ROLE_PASSWORDS_FLAG, ROLE_PASSWORDS_ON_CREATE, DEMO_FLAG, DEMO_ON } from "../packages/db/src/task-flags.ts";

// The UAT deploy's helper (ADR 0026, RP-1043), run by .github/workflows/deploy-uat.yml and
// reset-uat.yml with environment `uat`'s secrets and variables. It prints no secret.
//
//   node scripts/uat-deploy.ts migrate            bootstrap and migrate UAT's database (session pooler)
//   node scripts/uat-deploy.ts demo ensure|reset  seed the demo unless it is there | drop, migrate and seed it again
//   node scripts/uat-deploy.ts project <web|api|admin>   apply the project's settings and Sensitive variables
//   node scripts/uat-deploy.ts bypass admin       print Admin's Protection Bypass for Automation secret (mask it first)
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

/** UAT's connections, from DATABASE_SUPERUSER_URL (the session pooler), the roles' passwords and SUPABASE_PROJECT_REF. */
export function uatDatabase(env: NodeJS.ProcessEnv): UatDatabase {
  const superuser = required(env, "DATABASE_SUPERUSER_URL");
  if (!URL.canParse(superuser)) throw new Error("DATABASE_SUPERUSER_URL must be a URL");
  const host = new URL(superuser);
  if (!POOLER_HOST.test(host.hostname)) throw new Error("DATABASE_SUPERUSER_URL must be Supabase's session pooler (*.pooler.supabase.com)");
  if ((host.port || SESSION_POOLER_PORT) !== SESSION_POOLER_PORT) throw new Error("DATABASE_SUPERUSER_URL must be Supabase's session pooler (port 5432): migrations hold a session advisory lock");
  if (loginSuffixOf(superuser) !== required(env, "SUPABASE_PROJECT_REF")) throw new Error("DATABASE_SUPERUSER_URL logs in to another project than SUPABASE_PROJECT_REF");
  const database = env.DATABASE_NAME || UAT_DATABASE;
  // The gate drops `*_gate` and seam 2 resets `*_test`: UAT's data must never be either.
  if (!/^[a-z_][a-z0-9_]*$/.test(database) || /_(gate|test)(_|$)/.test(database)) throw new Error("DATABASE_NAME must be a plain name, neither the gate's (*_gate) nor a test database (*_test)");
  const role = (name: string, variable: "MIGRATOR" | "APP" | "ADMIN") => loginUrl(withDatabaseName(superuser, database), name, required(env, `DATABASE_${variable}_PASSWORD`));
  const transaction = (url: string) => {
    const u = new URL(url);
    u.port = TRANSACTION_POOLER_PORT;
    return u.toString();
  };
  const session = { superuser, migrator: role(MIGRATOR_ROLE, "MIGRATOR"), app: role(APP_ROLE, "APP"), admin: role(ADMIN_ROLE, "ADMIN") };
  return { session, appTransaction: transaction(session.app), adminTransaction: transaction(session.admin) };
}

/** The deploy's secrets a migration or demo command never needs. */
const NOT_FOR_COMMANDS = ["VERCEL_TOKEN", "ADMIN_VERCEL_PASSWORD", "SENDGRID_API_KEY", "CRON_SECRET", "SUPABASE_PUBLISHABLE_KEY", "FONTS_ACCESS_KEY_ID", "FONTS_SECRET_ACCESS_KEY", "FILE_STORE_ACCESS_KEY_ID", "FILE_STORE_SECRET_ACCESS_KEY"];

/** The environment `pnpm --filter @rabaed/db setup` and the demo command run in: UAT's session-pooler URLs, on-create passwords, a demo environment. */
export function commandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { session } = uatDatabase(env);
  const command: NodeJS.ProcessEnv = { ...env };
  for (const name of NOT_FOR_COMMANDS) delete command[name];
  return {
    ...command,
    DATABASE_SUPERUSER_URL: session.superuser,
    DATABASE_MIGRATOR_URL: session.migrator,
    DATABASE_APP_URL: session.app,
    DATABASE_ADMIN_URL: session.admin,
    [ROLE_PASSWORDS_FLAG]: ROLE_PASSWORDS_ON_CREATE,
    [DEMO_FLAG]: DEMO_ON,
  };
}

/** The project's settings, for PATCH /v9/projects/{id}; the rest is in its vercel.json. */
export function projectSettings(project: ProjectName, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const common = {
    nodeVersion: "24.x",
    sourceFilesOutsideRootDirectory: true,
    serverlessFunctionRegion: "fra1",
    // Vercel Authentication on previews (ADR 0026).
    ssoProtection: { deploymentType: "preview" },
    // Run in the Root Directory, so the path climbs to the repository's.
    commandForIgnoringBuildStep: "node ../../scripts/vercel-preview-gate.ts",
  };
  if (project === "web") return { ...common, rootDirectory: "apps/web", framework: "nextjs" };
  if (project === "api") return { ...common, rootDirectory: "apps/api", framework: null };
  // `all`: the production *.vercel.app address too. The gate builds no preview of Admin (it holds the bypass role).
  return {
    ...common,
    commandForIgnoringBuildStep: `${common.commandForIgnoringBuildStep} admin`,
    rootDirectory: "apps/admin",
    framework: null,
    passwordProtection: { deploymentType: "all", password: required(env, "ADMIN_VERCEL_PASSWORD") },
  };
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
  const mail = { WEB_URL: httpsUrl(env, "UAT_WEB_URL"), MAIL_FROM: required(env, "MAIL_FROM"), SENDGRID_API_KEY: required(env, "SENDGRID_API_KEY") };
  const values: Record<ProjectName, () => Record<string, string>> = {
    web: () => ({ API_URL: httpsUrl(env, "UAT_API_URL") }),
    api: () => ({
      ...functions,
      DATABASE_APP_URL: uatDatabase(env).appTransaction,
      DATABASE_POOL_MAX: "2",
      SESSION_COOKIE_SECURE: "true",
      PROJECT_FILES_BUCKET: required(env, "PROJECT_FILES_BUCKET"),
      FILE_STORE_ENDPOINT: httpsUrl(env, "FILE_STORE_ENDPOINT"),
      FILE_STORE_ACCESS_KEY_ID: required(env, "FILE_STORE_ACCESS_KEY_ID"),
      FILE_STORE_SECRET_ACCESS_KEY: required(env, "FILE_STORE_SECRET_ACCESS_KEY"),
      FILE_STORE_REGION: "auto",
      ...mail,
      CRON_SECRET: required(env, "CRON_SECRET"),
    }),
    admin: () => ({ ...functions, DATABASE_ADMIN_URL: uatDatabase(env).adminTransaction, DATABASE_POOL_MAX: "2", SESSION_COOKIE_SECURE: "true", ...mail }),
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

const VERCEL_API = "https://api.vercel.com";

/** A Vercel REST API call for the team; fails on a refusal with Vercel's code and message only. */
async function vercelCall(env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch, method: string, path: string, what: string, body?: unknown, query: Record<string, string> = {}) {
  const url = new URL(path, VERCEL_API);
  for (const [name, value] of Object.entries({ ...query, teamId: required(env, "VERCEL_ORG_ID") })) url.searchParams.set(name, value);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${required(env, "VERCEL_TOKEN")}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new Error(`Vercel refused ${what}: ${res.status} ${answer.error?.code ?? ""}: ${answer.error?.message ?? ""}`.replace(/ +:/, ":"));
  return answer;
}

const projectId = (project: ProjectName, env: NodeJS.ProcessEnv) => required(env, `VERCEL_${project.toUpperCase()}_PROJECT_ID`);

/** Applies the project's settings, then upserts its variables. */
export async function applyProject(project: ProjectName, env: NodeJS.ProcessEnv, version: string, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<void> {
  const id = projectId(project, env);
  const settings = projectSettings(project, env);
  const variables = projectEnv(project, env, version);
  await vercelCall(env, fetch, "PATCH", `/v9/projects/${encodeURIComponent(id)}`, `PATCH project ${id}`, settings);
  const saved = (await vercelCall(env, fetch, "POST", `/v10/projects/${encodeURIComponent(id)}/env`, `the variables of ${id}`, variables, { upsert: "true" })) as {
    failed?: { error?: { code?: string; message?: string; key?: string } }[];
  };
  const failed = saved.failed ?? [];
  if (failed.length > 0) {
    throw new Error(failed.map(({ error }) => `Vercel did not save ${error?.key ?? "a variable"} on ${id}: ${error?.code ?? ""}: ${error?.message ?? ""}`).join("; "));
  }
}

type Bypasses = Record<string, { scope?: string }> | undefined;
const automationSecret = (bypasses: Bypasses) => Object.entries(bypasses ?? {}).find(([, value]) => value.scope === "automation-bypass")?.[0];

/**
 * The project's Protection Bypass for Automation secret, generated if it has none (Vercel
 * REST API, "Update Protection Bypass for Automation"). The smoke sends it to Admin as
 * `x-vercel-protection-bypass`, past Password Protection.
 */
export async function automationBypass(project: ProjectName, env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<string> {
  const id = projectId(project, env);
  const found = automationSecret((await vercelCall(env, fetch, "GET", `/v9/projects/${encodeURIComponent(id)}`, `GET project ${id}`)).protectionBypass as Bypasses);
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

async function main([command, argument]: string[]): Promise<void> {
  const env = process.env;
  if (command === "migrate") return run("pnpm", ["--filter", "@rabaed/db", "setup"], commandEnv(env));
  if (command === "demo") {
    if (argument !== "ensure" && argument !== "reset") throw new Error("demo ensure|reset");
    return run("pnpm", ["--filter", "@rabaed/api", "exec", "tsx", "src/cli/demo-environment.ts", argument], commandEnv(env));
  }
  if (command === "project") {
    await applyProject(project(argument), env, required(env, "VERSION"));
    return console.log(`uat-deploy: ${argument}'s settings and variables applied`);
  }
  if (command === "bypass") return void process.stdout.write(`${await automationBypass(project(argument), env)}\n`);
  throw new Error("Usage: node scripts/uat-deploy.ts migrate | demo ensure|reset | project <web|api|admin> | bypass admin");
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`uat-deploy: ${(error as Error).message}`);
    process.exit(1);
  });
}
