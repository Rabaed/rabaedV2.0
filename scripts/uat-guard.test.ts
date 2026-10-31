import { describe, expect, it } from "vitest";
import { guardTarget, toolEnv, type Target } from "./uat-guard.ts";

// The UAT tool's guard rails (RP-922, test 1): `uat:age` and `uat:run-job` write only to a lane's
// own local database, with mail landing in that lane's Mailpit, or (comment 15225) to UAT's
// database on Supabase, with mail through UAT's SendGrid. Everything else is refused, production
// above all, and a refusal names variables, never a value. The URLs here carry no password.

const lane42 = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  COMPOSE_PROJECT_NAME: "rabaed-lane42",
  DATABASE_SUPERUSER_URL: "postgres://postgres@localhost:5852/postgres",
  DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator@localhost:5852/rabaed",
  DATABASE_APP_URL: "postgres://rabaed_app@localhost:5852/rabaed",
  DATABASE_ADMIN_URL: "postgres://rabaed_admin@localhost:5852/rabaed",
  WEB_URL: "http://lane42.localhost:3420",
  API_URL: "http://127.0.0.1:4420",
  MAIL_FROM: "no-reply@rabaed.test",
  MAIL_CATCHER_URL: "http://127.0.0.1:8445",
  SENDGRID_API_KEY: "",
  FILE_STORE_ENDPOINT: "http://127.0.0.1:9420",
  ...overrides,
});

const ref = "onpogmojabsgndojwjos";
const pooler = "aws-1-eu-central-1.pooler.supabase.com";
const uat = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  RABAED_ENVIRONMENT: "uat",
  SUPABASE_PROJECT_REF: ref,
  DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}@${pooler}:5432/postgres?sslmode=require`,
  DATABASE_NAME: "rabaed_uat",
  DATABASE_MIGRATOR_PASSWORD: "migrator-placeholder",
  DATABASE_APP_PASSWORD: "app-placeholder",
  UAT_WEB_URL: "https://rabaed-uat.vercel.app",
  MAIL_FROM: "Rabaed UAT <uat@example.com>",
  SENDGRID_API_KEY: "placeholder",
  ...overrides,
});

const laneTarget: Target = { kind: "lane", lane: 42 };
const uatTarget: Target = { kind: "uat" };

/** The refusals for `env` and `target`; none when it passes. */
const refusals = (env: NodeJS.ProcessEnv, target: Target) => {
  const result = guardTarget(env, target);
  return "refused" in result ? result.refused : [];
};

describe("a lane target", () => {
  it("passes a lane's own .env: its local database on its own port, mail to its Mailpit", () => {
    const result = guardTarget(lane42(), laneTarget);
    expect(result).toEqual({
      label: "lane 42 (database rabaed on localhost:5852)",
      migratorUrl: "postgres://rabaed_migrator@localhost:5852/rabaed",
      appUrl: "postgres://rabaed_app@localhost:5852/rabaed",
      webUrl: "http://lane42.localhost:3420",
      mail: "catcher",
    });
  });

  it("passes a --db database of the lane (rabaed_<suffix>)", () => {
    const env = lane42({
      DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator@localhost:5852/rabaed_rp922",
      DATABASE_APP_URL: "postgres://rabaed_app@localhost:5852/rabaed_rp922",
    });
    expect(refusals(env, laneTarget)).toEqual([]);
  });

  it("refuses a number that is no lane", () => {
    expect(refusals(lane42(), { kind: "lane", lane: 19 })).toEqual([expect.stringMatching(/^19 is not a lane: lanes are 0/)]);
  });

  it("refuses a database host that is not local", () => {
    const env = lane42({ DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator@db.example.com:5852/rabaed" });
    expect(refusals(env, laneTarget)).toContain("DATABASE_MIGRATOR_URL is not on this machine (localhost, 127.0.0.1 or ::1)");
  });

  it("refuses another lane's Postgres port", () => {
    const env = lane42({ DATABASE_APP_URL: "postgres://rabaed_app@localhost:5432/rabaed" });
    expect(refusals(env, laneTarget)).toEqual(["DATABASE_APP_URL is on port 5432, not lane 42's Postgres (5852)"]);
  });

  it("refuses a database that is not the lane's (a test database, another name)", () => {
    expect(refusals(lane42({ DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator@localhost:5852/rabaed_test" }), laneTarget)).toEqual([
      "DATABASE_MIGRATOR_URL is on database rabaed_test, not the lane's (rabaed or rabaed_<suffix>, never a test database)",
    ]);
    expect(refusals(lane42({ DATABASE_APP_URL: "postgres://rabaed_app@localhost:5852/postgres" }), laneTarget)).toHaveLength(1);
  });

  it("refuses the two roles on different databases", () => {
    const env = lane42({ DATABASE_APP_URL: "postgres://rabaed_app@localhost:5852/rabaed_other" });
    expect(refusals(env, laneTarget)).toEqual(["DATABASE_MIGRATOR_URL and DATABASE_APP_URL are on different databases"]);
  });

  it("refuses without the migrator URL: it never writes through the app role", () => {
    expect(refusals(lane42({ DATABASE_MIGRATOR_URL: undefined }), laneTarget)).toEqual(["DATABASE_MIGRATOR_URL is missing: the tool writes as the migrator, never as rabaed_app"]);
  });

  it("refuses without the app URL: the jobs run as the worker does", () => {
    expect(refusals(lane42({ DATABASE_APP_URL: "" }), laneTarget)).toEqual(["DATABASE_APP_URL is missing: the jobs run as rabaed_app, as the worker does"]);
  });

  it("refuses production or staging config", () => {
    expect(refusals(lane42({ NODE_ENV: "production" }), laneTarget)).toEqual(["NODE_ENV is production: the tool never runs in production or staging config"]);
    expect(refusals(lane42({ RABAED_ENV: "staging" }), laneTarget)).toEqual(["RABAED_ENV is staging: the tool never runs in production or staging config"]);
    expect(refusals(lane42({ VERCEL_ENV: "production" }), laneTarget)).toHaveLength(1);
  });

  it("refuses any URL in the env that is not local", () => {
    expect(refusals(lane42({ FILE_STORE_ENDPOINT: "https://acc.r2.cloudflarestorage.com" }), laneTarget)).toEqual([
      "FILE_STORE_ENDPOINT is not on this machine (localhost, 127.0.0.1 or ::1)",
    ]);
  });

  it("refuses mail that would leave the machine: a non-local catcher, SendGrid or SES", () => {
    expect(refusals(lane42({ MAIL_CATCHER_URL: "http://mail.example.com:8025" }), laneTarget)).toEqual([
      "MAIL_CATCHER_URL is not on this machine (localhost, 127.0.0.1 or ::1)",
    ]);
    expect(refusals(lane42({ SENDGRID_API_KEY: "placeholder" }), laneTarget)).toEqual(["SENDGRID_API_KEY is set: a lane's mail must land in its own Mailpit"]);
    expect(refusals(lane42({ MAIL_SES_CONFIGURATION_SET: "rabaed" }), laneTarget)).toEqual([
      "MAIL_SES_CONFIGURATION_SET is set: a lane's mail must land in its own Mailpit",
    ]);
    expect(refusals(lane42({ MAIL_CATCHER_URL: undefined }), laneTarget)).toEqual(["MAIL_CATCHER_URL is missing: a lane's mail must land in its own Mailpit"]);
  });

  it("never quotes a value in a refusal", () => {
    const env = lane42({ DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator:hush-hush@db.example.com:5852/rabaed", NODE_ENV: "production" });
    for (const refusal of refusals(env, laneTarget)) expect(refusal).not.toMatch(/hush-hush|example\.com/);
  });
});

describe("the UAT target (comment 15225)", () => {
  it("passes UAT's environment: Supabase's session pooler, UAT's database, mail through SendGrid", () => {
    const result = guardTarget(uat(), uatTarget);
    if ("refused" in result) throw new Error(result.refused.join("; "));
    expect(result.label).toBe(`UAT (database rabaed_uat, Supabase project ${ref})`);
    expect(new URL(result.migratorUrl).username).toBe(`rabaed_migrator.${ref}`);
    expect(new URL(result.appUrl).username).toBe(`rabaed_app.${ref}`);
    expect(new URL(result.migratorUrl).port).toBe("5432");
    expect(result).toMatchObject({ webUrl: "https://rabaed-uat.vercel.app", mail: "sendgrid" });
  });

  it("refuses unless the run says it is UAT's", () => {
    expect(refusals(uat({ RABAED_ENVIRONMENT: undefined }), uatTarget)).toEqual(["RABAED_ENVIRONMENT must be uat: the UAT target runs only in the age-uat GitHub job"]);
    expect(refusals(uat({ RABAED_ENVIRONMENT: "production" }), uatTarget)).toEqual(["RABAED_ENVIRONMENT must be uat: the UAT target runs only in the age-uat GitHub job"]);
  });

  it("refuses production config", () => {
    expect(refusals(uat({ NODE_ENV: "production" }), uatTarget)).toEqual(["NODE_ENV is production: the tool never runs in production or staging config"]);
    expect(refusals(uat({ RABAED_ENV: "prod" }), uatTarget)).toHaveLength(1);
  });

  it("refuses a database that is not on Supabase's pooler for UAT's project", () => {
    expect(refusals(uat({ DATABASE_SUPERUSER_URL: "postgres://postgres@prod-db.example.com:5432/postgres" }), uatTarget)).toEqual([
      "DATABASE_SUPERUSER_URL must be Supabase's session pooler (*.pooler.supabase.com)",
    ]);
    expect(refusals(uat({ SUPABASE_PROJECT_REF: "anotherprojectref000" }), uatTarget)).toEqual(["DATABASE_SUPERUSER_URL logs in to another project than SUPABASE_PROJECT_REF"]);
  });

  it("refuses a local database: a lane is the lane target's", () => {
    expect(refusals(uat({ DATABASE_SUPERUSER_URL: "postgres://postgres@localhost:5852/postgres" }), uatTarget)).toEqual([
      "DATABASE_SUPERUSER_URL must be Supabase's session pooler (*.pooler.supabase.com)",
    ]);
  });

  it("refuses a database other than UAT's", () => {
    expect(refusals(uat({ DATABASE_NAME: "rabaed_gate" }), uatTarget)).toEqual(["DATABASE_NAME must be rabaed_uat, UAT's database"]);
  });

  it("refuses without the migrator's or the app role's password", () => {
    expect(refusals(uat({ DATABASE_MIGRATOR_PASSWORD: "" }), uatTarget)).toEqual(["DATABASE_MIGRATOR_PASSWORD is required"]);
    expect(refusals(uat({ DATABASE_APP_PASSWORD: undefined }), uatTarget)).toEqual(["DATABASE_APP_PASSWORD is required"]);
  });

  it("refuses mail that is not UAT's mailer, or a link that is not https", () => {
    expect(refusals(uat({ SENDGRID_API_KEY: "" }), uatTarget)).toEqual(["SENDGRID_API_KEY is missing: UAT's mail goes through SendGrid"]);
    expect(refusals(uat({ MAIL_CATCHER_URL: "http://127.0.0.1:8025" }), uatTarget)).toEqual(["MAIL_CATCHER_URL is set: UAT's mail goes through SendGrid only"]);
    expect(refusals(uat({ UAT_WEB_URL: "http://rabaed-uat.vercel.app" }), uatTarget)).toEqual(["UAT_WEB_URL must be an https URL"]);
  });

  it("never quotes a value in a refusal", () => {
    const env = uat({ DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}:hush-hush@prod-db.example.com:5432/postgres`, NODE_ENV: "production" });
    for (const refusal of refusals(env, uatTarget)) expect(refusal).not.toMatch(/hush-hush|example\.com/);
  });
});

describe("the tool's environment", () => {
  it("keeps only what the tool reads, the .env first and then the shell over it, and none of pnpm's own URLs", () => {
    const env = toolEnv("DATABASE_APP_URL=postgres://rabaed_app@localhost:5852/rabaed\nWEB_URL=http://lane42.localhost:3420\nPORT=3420\n", {
      WEB_URL: "http://127.0.0.1:3420",
      npm_config_registry: "https://registry.npmjs.org/",
      NODE_ENV: "development",
      PATH: "/usr/bin",
    });
    expect(env).toEqual({ DATABASE_APP_URL: "postgres://rabaed_app@localhost:5852/rabaed", WEB_URL: "http://127.0.0.1:3420", NODE_ENV: "development" });
  });
});
