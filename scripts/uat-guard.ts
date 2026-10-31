import { parseEnv } from "node:util";
import { databaseNameOf } from "../packages/db/src/config.ts";
import { LANE_SCHEME, isValidLane, lanePorts } from "./lanes.ts";
import { uatRoleUrl } from "./uat-deploy.ts";

// The UAT tool's guard rails (RP-922): `uat:age` and `uat:run-job` change data on two kinds of
// target only, and refuse everything else before they connect.
//
//  - A lane: its own Postgres on this machine (localhost, 127.0.0.1 or ::1, the lane's port, the
//    lane's database rabaed or rabaed_<suffix>), every URL in the env local, and mail to the lane's
//    Mailpit (MAIL_CATCHER_URL), never SendGrid or SES.
//  - UAT (comment 15225), from the GitHub Action with environment `uat` only: RABAED_ENVIRONMENT=uat,
//    UAT's database on Supabase's session pooler (scripts/uat-deploy.ts checks the host, port and
//    project), named rabaed_uat, and mail through UAT's SendGrid.
//
// Both refuse production or staging config, and both need the migrator's URL (the tool writes as the
// migrator, never as rabaed_app) and the app role's (the jobs run as the worker does). A refusal names
// variables, never their values: the URLs hold passwords.

export type Target = { kind: "lane"; lane: number } | { kind: "uat" };

export interface Guarded {
  /** What the tool prints as its target: no host of UAT's, no password. */
  label: string;
  migratorUrl: string;
  appUrl: string;
  /** Where the emails link to. */
  webUrl: string;
  /** The mailer the env sets up (@rabaed/mailer mailerFromEnv). */
  mail: "catcher" | "sendgrid";
}

export type GuardResult = Guarded | { refused: string[] };

/** The variables the tool reads; anything else in the shell (pnpm's registry URL, PATH) is left out. */
const TOOL_KEYS =
  /^(?:DATABASE_[A-Z_]+|MAIL_[A-Z_]+|SMTP_[A-Z_]+|SENDGRID_API_KEY|NODE_ENV|RABAED_ENV|RABAED_ENVIRONMENT|APP_ENV|VERCEL_ENV|WEB_URL|UAT_WEB_URL|API_URL|FILE_STORE_ENDPOINT|SUPABASE_PROJECT_REF|COMPOSE_PROJECT_NAME)$/;

/** The tool's environment: the worktree's `.env` text, then the shell's values over it, only the variables it reads. */
export function toolEnv(dotenv: string, shell: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...parseEnv(dotenv), ...shell };
  return Object.fromEntries(Object.entries(merged).filter(([key, value]) => TOOL_KEYS.test(key) && value !== undefined));
}

/** The lane the env's compose project names (`rabaed-lane42` → 42, `rabaed` → 0), or undefined. */
export function laneOfEnv(env: NodeJS.ProcessEnv): number | undefined {
  const project = env.COMPOSE_PROJECT_NAME;
  if (project === "rabaed") return 0;
  const m = /^rabaed-lane(\d+)$/.exec(project ?? "");
  return m ? Number(m[1]) : undefined;
}

const PRODUCTION_WORDS = ["production", "prod", "staging", "stage"];
const ENV_KEYS = ["NODE_ENV", "RABAED_ENV", "APP_ENV", "VERCEL_ENV"];

/** Production or staging config, by any of the variables that name an environment. */
function productionRefusals(env: NodeJS.ProcessEnv): string[] {
  return ENV_KEYS.flatMap((key) => {
    const word = PRODUCTION_WORDS.find((w) => w === env[key]?.trim().toLowerCase());
    return word ? [`${key} is ${word}: the tool never runs in production or staging config`] : [];
  });
}

const blank = (value: string | undefined) => value === undefined || value.trim() === "";

/** On this machine: the loopback names, and any `*.localhost` (a lane's web host). */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".localhost");
}

const notLocal = (key: string) => `${key} is not on this machine (localhost, 127.0.0.1 or ::1)`;

/** Every URL in the env whose host is not local. */
function remoteUrls(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env).flatMap(([key, value]) => {
    if (!value || !value.includes("://") || !URL.canParse(value)) return [];
    const { hostname } = new URL(value);
    return hostname && !isLocalHost(hostname) ? [notLocal(key)] : [];
  });
}

/** A lane's own database: rabaed, or a lane:env --db one (rabaed_<suffix>); never a test database. */
const laneDatabase = (name: string) => /^rabaed(?:_[a-z][a-z0-9]*)?$/.test(name) && !/_test(?:_|$)/.test(name);

function laneGuard(env: NodeJS.ProcessEnv, lane: number): GuardResult {
  if (!isValidLane(lane)) return { refused: [`${lane} is not a lane: ${LANE_SCHEME}`] };
  const port = lanePorts(lane).postgres;
  const refused = [...productionRefusals(env), ...remoteUrls(env)];
  const roles = [
    { key: "DATABASE_MIGRATOR_URL", missing: "the tool writes as the migrator, never as rabaed_app" },
    { key: "DATABASE_APP_URL", missing: "the jobs run as rabaed_app, as the worker does" },
  ];
  const databases: string[] = [];
  for (const { key, missing } of roles) {
    const value = env[key];
    if (blank(value)) {
      refused.push(`${key} is missing: ${missing}`);
      continue;
    }
    if (!URL.canParse(value!)) {
      refused.push(`${key} is not a URL`);
      continue;
    }
    const url = new URL(value!);
    if (!isLocalHost(url.hostname)) refused.push(notLocal(key));
    else if (Number(url.port || 5432) !== port) refused.push(`${key} is on port ${url.port || 5432}, not lane ${lane}'s Postgres (${port})`);
    const database = databaseNameOf(value!);
    if (!laneDatabase(database)) refused.push(`${key} is on database ${database}, not the lane's (rabaed or rabaed_<suffix>, never a test database)`);
    else databases.push(database);
  }
  if (databases.length === 2 && databases[0] !== databases[1]) refused.push("DATABASE_MIGRATOR_URL and DATABASE_APP_URL are on different databases");
  if (blank(env.MAIL_CATCHER_URL)) refused.push("MAIL_CATCHER_URL is missing: a lane's mail must land in its own Mailpit");
  for (const key of ["SENDGRID_API_KEY", "MAIL_SES_CONFIGURATION_SET"]) {
    if (!blank(env[key])) refused.push(`${key} is set: a lane's mail must land in its own Mailpit`);
  }
  if (blank(env.WEB_URL)) refused.push("WEB_URL is missing: the emails link to it");
  if (refused.length > 0) return { refused: [...new Set(refused)] };
  return {
    label: `lane ${lane} (database ${databases[0]} on localhost:${port})`,
    migratorUrl: env.DATABASE_MIGRATOR_URL!,
    appUrl: env.DATABASE_APP_URL!,
    webUrl: env.WEB_URL!,
    mail: "catcher",
  };
}

const UAT_DATABASE = "rabaed_uat";

function uatGuard(env: NodeJS.ProcessEnv): GuardResult {
  const refused = productionRefusals(env);
  if (env.RABAED_ENVIRONMENT !== "uat") refused.push("RABAED_ENVIRONMENT must be uat: the UAT target runs only in the age-uat GitHub job");
  const database = env.DATABASE_NAME || UAT_DATABASE;
  if (database !== UAT_DATABASE) refused.push(`DATABASE_NAME must be ${UAT_DATABASE}, UAT's database`);
  const urls: Partial<Record<"MIGRATOR" | "APP", string>> = {};
  if (database === UAT_DATABASE) {
    // uat-deploy.ts checks the pooler's host and port, the project and each role's password; its errors name variables only.
    for (const role of ["MIGRATOR", "APP"] as const) {
      try {
        urls[role] = uatRoleUrl(env, role, "session");
      } catch (error) {
        refused.push((error as Error).message);
      }
    }
  }
  if (blank(env.SENDGRID_API_KEY)) refused.push("SENDGRID_API_KEY is missing: UAT's mail goes through SendGrid");
  for (const key of ["MAIL_CATCHER_URL", "MAIL_SES_CONFIGURATION_SET"]) {
    if (!blank(env[key])) refused.push(`${key} is set: UAT's mail goes through SendGrid only`);
  }
  const web = env.UAT_WEB_URL ?? "";
  if (!URL.canParse(web) || new URL(web).protocol !== "https:") refused.push("UAT_WEB_URL must be an https URL");
  if (refused.length > 0) return { refused: [...new Set(refused)] };
  return {
    label: `UAT (database ${UAT_DATABASE}, Supabase project ${env.SUPABASE_PROJECT_REF})`,
    migratorUrl: urls.MIGRATOR!,
    appUrl: urls.APP!,
    webUrl: web.replace(/\/+$/, ""),
    mail: "sendgrid",
  };
}

/** Checks `env` for `target`: the connections and mail it may use, or every reason it may not. */
export function guardTarget(env: NodeJS.ProcessEnv, target: Target): GuardResult {
  return target.kind === "lane" ? laneGuard(env, target.lane) : uatGuard(env);
}
