import { describe, expect, it } from "vitest";
import { applyProject, automationBypass, PROJECTS, projectEnv, projectSettings, commandEnv, uatDatabase, type ProjectName } from "./uat-deploy.ts";

// The UAT deploy's helper (ADR 0026, RP-1043), run by deploy-uat.yml and reset-uat.yml
// with environment `uat`'s secrets and variables. These values stand in for them.
const ref = "onpogmojabsgndojwjos";
const pooler = "aws-1-eu-central-1.pooler.supabase.com";
const env: NodeJS.ProcessEnv = {
  SUPABASE_PROJECT_REF: ref,
  DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}:superuser-secret@${pooler}:5432/postgres?sslmode=require`,
  DATABASE_MIGRATOR_PASSWORD: "migrator-secret",
  DATABASE_APP_PASSWORD: "app-secret",
  DATABASE_ADMIN_PASSWORD: "admin/secret+", // characters a URL must encode
  DEMO_PASSWORD: "demo-password-of-16+",
  VERCEL_TOKEN: "vercel-token-secret",
  VERCEL_ORG_ID: "team_123",
  VERCEL_WEB_PROJECT_ID: "prj_web",
  VERCEL_API_PROJECT_ID: "prj_api",
  VERCEL_ADMIN_PROJECT_ID: "prj_admin",
  UAT_WEB_URL: "https://rabaed-uat.vercel.app",
  UAT_API_URL: "https://rabaed-uat-api.vercel.app",
  ADMIN_VERCEL_PASSWORD: "admin-vercel-password",
  CRON_SECRET: "cron-secret-of-32-characters!!!!",
  FILE_STORE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  PROJECT_FILES_BUCKET: "rabaed-uat-files",
  FILE_STORE_ACCESS_KEY_ID: "r2-rw-key-id",
  FILE_STORE_SECRET_ACCESS_KEY: "r2-rw-secret",
  FONTS_ACCESS_KEY_ID: "r2-ro-key-id",
  FONTS_SECRET_ACCESS_KEY: "r2-ro-secret",
  SENDGRID_API_KEY: "SG.sendgrid-secret",
  MAIL_FROM: "Rabaed UAT <uat@example.com>",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_secret",
};
const version = "4f2a9c1e0d";
const varsOf = (project: ProjectName) => Object.fromEntries(projectEnv(project, env, version).map((v) => [v.key, v.value]));

describe("UAT's database connections", () => {
  it("migrates over the session pooler, every role logging in as <role>.<ref> to UAT's own database", () => {
    const { session } = uatDatabase(env);
    expect(session.superuser).toBe(env.DATABASE_SUPERUSER_URL);
    expect(session.migrator).toBe(`postgres://rabaed_migrator.${ref}:migrator-secret@${pooler}:5432/rabaed_uat?sslmode=require`);
    expect(session.app).toBe(`postgres://rabaed_app.${ref}:app-secret@${pooler}:5432/rabaed_uat?sslmode=require`);
    expect(session.admin).toBe(`postgres://rabaed_admin.${ref}:admin%2Fsecret%2B@${pooler}:5432/rabaed_uat?sslmode=require`);
  });

  it("gives the apps the transaction pooler, port 6543", () => {
    const { appTransaction, adminTransaction } = uatDatabase(env);
    expect(appTransaction).toBe(`postgres://rabaed_app.${ref}:app-secret@${pooler}:6543/rabaed_uat?sslmode=require`);
    expect(adminTransaction).toBe(`postgres://rabaed_admin.${ref}:admin%2Fsecret%2B@${pooler}:6543/rabaed_uat?sslmode=require`);
  });

  it("takes DATABASE_NAME, but never the gate's or a test database", () => {
    expect(uatDatabase({ ...env, DATABASE_NAME: "rabaed_demo" }).session.app).toContain("/rabaed_demo?");
    for (const name of ["rabaed_gate", "rabaed_gate_test", "rabaed_uat_test", "Bad-Name"]) {
      expect(() => uatDatabase({ ...env, DATABASE_NAME: name }), name).toThrow(/DATABASE_NAME/);
    }
  });

  it.each([
    ["the superuser URL is missing", { DATABASE_SUPERUSER_URL: undefined }, /DATABASE_SUPERUSER_URL is required/],
    ["it is not Supabase's pooler", { DATABASE_SUPERUSER_URL: "postgres://postgres:x@db.example.com:5432/postgres" }, /Supabase's session pooler/],
    ["it is the transaction pooler", { DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}:x@${pooler}:6543/postgres` }, /session pooler \(port 5432\)/],
    ["it logs in to another project", { DATABASE_SUPERUSER_URL: `postgres://postgres.other:x@${pooler}:5432/postgres` }, /another project than SUPABASE_PROJECT_REF/],
    ["a role's password is missing", { DATABASE_APP_PASSWORD: "" }, /DATABASE_APP_PASSWORD is required/],
  ])("refuses when %s, naming no secret", (_name, change, error) => {
    const run = () => uatDatabase({ ...env, ...change });
    expect(run).toThrow(error);
    try {
      run();
    } catch (e) {
      expect((e as Error).message).not.toMatch(/secret/);
    }
  });

  it("runs migrations and the demo with on-create passwords, so a deploy never re-salts a role (Supavisor would refuse it)", () => {
    const command = commandEnv(env);
    expect(command).toMatchObject({
      DATABASE_ROLE_PASSWORDS: "on-create",
      RABAED_DEMO: "on",
      DATABASE_SUPERUSER_URL: env.DATABASE_SUPERUSER_URL,
      DATABASE_MIGRATOR_URL: uatDatabase(env).session.migrator,
      DATABASE_APP_URL: uatDatabase(env).session.app,
      DATABASE_ADMIN_URL: uatDatabase(env).session.admin,
      DEMO_PASSWORD: env.DEMO_PASSWORD,
    });
    // The child gets nothing else of the deploy's secrets.
    for (const name of ["VERCEL_TOKEN", "ADMIN_VERCEL_PASSWORD", "SENDGRID_API_KEY", "CRON_SECRET", "SUPABASE_PUBLISHABLE_KEY", "FONTS_SECRET_ACCESS_KEY"]) expect(command[name], name).toBeUndefined();
  });
});

describe("the three Vercel projects' settings", () => {
  it("are the same for all three but their root, framework and Admin's password", () => {
    const common = {
      nodeVersion: "24.x",
      sourceFilesOutsideRootDirectory: true,
      serverlessFunctionRegion: "fra1",
      ssoProtection: { deploymentType: "preview" },
      commandForIgnoringBuildStep: "node ../../scripts/vercel-preview-gate.ts",
    };
    expect(projectSettings("web", env)).toEqual({ ...common, rootDirectory: "apps/web", framework: "nextjs" });
    expect(projectSettings("api", env)).toEqual({ ...common, rootDirectory: "apps/api", framework: null });
    expect(projectSettings("admin", env)).toEqual({
      ...common,
      rootDirectory: "apps/admin",
      framework: null,
      passwordProtection: { deploymentType: "all", password: "admin-vercel-password" },
    });
  });

  it("refuse Admin without its password, rather than leave it open", () => {
    expect(() => projectSettings("admin", { ...env, ADMIN_VERCEL_PASSWORD: "" })).toThrow("ADMIN_VERCEL_PASSWORD is required");
  });
});

describe("the three Vercel projects' environment variables", () => {
  it("are every one Sensitive, for production and previews; the commit for production only", () => {
    for (const project of PROJECTS) {
      for (const variable of projectEnv(project, env, version)) {
        expect(variable.type, `${project} ${variable.key}`).toBe("sensitive");
        expect(variable.target, `${project} ${variable.key}`).toEqual(variable.key === "APP_VERSION" ? ["production"] : ["production", "preview"]);
      }
    }
  });

  it("give web the api's address and the commit, nothing else", () => {
    expect(varsOf("web")).toEqual({ API_URL: "https://rabaed-uat-api.vercel.app", APP_VERSION: version });
  });

  it("give the api its role's transaction-pooler URL, R2, mail and the cron secret", () => {
    expect(varsOf("api")).toEqual({
      APP_VERSION: version,
      NODE_OPTIONS: "--experimental-transform-types",
      NODEJS_HELPERS: "0",
      DATABASE_APP_URL: uatDatabase(env).appTransaction,
      DATABASE_POOL_MAX: "2",
      SESSION_COOKIE_SECURE: "true",
      PROJECT_FILES_BUCKET: "rabaed-uat-files",
      FILE_STORE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      FILE_STORE_ACCESS_KEY_ID: "r2-rw-key-id",
      FILE_STORE_SECRET_ACCESS_KEY: "r2-rw-secret",
      FILE_STORE_REGION: "auto",
      WEB_URL: "https://rabaed-uat.vercel.app",
      MAIL_FROM: "Rabaed UAT <uat@example.com>",
      SENDGRID_API_KEY: "SG.sendgrid-secret",
      CRON_SECRET: "cron-secret-of-32-characters!!!!",
    });
  });

  it("give Admin the bypass role's transaction-pooler URL and mail", () => {
    expect(varsOf("admin")).toEqual({
      APP_VERSION: version,
      NODE_OPTIONS: "--experimental-transform-types",
      NODEJS_HELPERS: "0",
      DATABASE_ADMIN_URL: uatDatabase(env).adminTransaction,
      DATABASE_POOL_MAX: "2",
      SESSION_COOKIE_SECURE: "true",
      WEB_URL: "https://rabaed-uat.vercel.app",
      MAIL_FROM: "Rabaed UAT <uat@example.com>",
      SENDGRID_API_KEY: "SG.sendgrid-secret",
    });
  });

  // ADR 0010 and 0026: Admin alone holds the bypass role; no project holds what only
  // the deploy may use (the superuser, the migrator, the Vercel token, Supabase's keys,
  // the read-only fonts key, which the runner uses at build time).
  it("hold the bypass role's password in Admin only, and the deploy's own secrets nowhere", () => {
    const sent = (project: ProjectName) => JSON.stringify(projectEnv(project, env, version));
    expect(sent("admin")).toContain(encodeURIComponent(env.DATABASE_ADMIN_PASSWORD!));
    for (const project of ["web", "api"] as const) expect(sent(project)).not.toContain(encodeURIComponent(env.DATABASE_ADMIN_PASSWORD!));
    for (const project of PROJECTS) {
      for (const name of ["DATABASE_SUPERUSER_URL", "DATABASE_MIGRATOR_PASSWORD", "VERCEL_TOKEN", "SUPABASE_PUBLISHABLE_KEY", "FONTS_ACCESS_KEY_ID", "FONTS_SECRET_ACCESS_KEY", "DEMO_PASSWORD", "ADMIN_VERCEL_PASSWORD"]) {
        expect(sent(project), `${project} ${name}`).not.toContain(env[name]!);
      }
      expect(sent(project)).not.toContain("superuser-secret");
    }
  });

  it("refuse a missing value, naming it", () => {
    expect(() => projectEnv("api", { ...env, CRON_SECRET: undefined }, version)).toThrow("CRON_SECRET is required");
    expect(() => projectEnv("web", { ...env, UAT_API_URL: "not a url" }, version)).toThrow("UAT_API_URL must be an https URL");
  });
});

// A fake Vercel REST API: records each call, answers as Vercel documents.
function vercel(answer: (method: string, url: URL, body: unknown) => { status: number; body: unknown } = () => ({ status: 200, body: {} })) {
  const calls: { method: string; url: string; body: unknown; authorization: string | null }[] = [];
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: url.toString(), body, authorization: new Headers(init.headers).get("authorization") });
    const reply = answer(method, url, body);
    return Response.json(reply.body, { status: reply.status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("applyProject", () => {
  it("patches the project's settings, then upserts its variables, for the team, with the token", async () => {
    const api = vercel((method) => ({ status: method === "POST" ? 201 : 200, body: method === "POST" ? { created: [], failed: [] } : {} }));
    await applyProject("admin", env, version, api.fetch);
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "PATCH https://api.vercel.com/v9/projects/prj_admin?teamId=team_123",
      "POST https://api.vercel.com/v10/projects/prj_admin/env?upsert=true&teamId=team_123",
    ]);
    expect(api.calls.every((c) => c.authorization === "Bearer vercel-token-secret")).toBe(true);
    expect(api.calls[0]?.body).toEqual(projectSettings("admin", env));
    expect(api.calls[1]?.body).toEqual(projectEnv("admin", env, version));
  });

  it("fails on Vercel's refusal, with its code and message and no value", async () => {
    const api = vercel(() => ({ status: 403, body: { error: { code: "forbidden", message: "Not authorized" } } }));
    await expect(applyProject("api", env, version, api.fetch)).rejects.toThrow("Vercel refused PATCH project prj_api: 403 forbidden: Not authorized");
  });

  it("fails when a variable was not saved, naming the variable", async () => {
    const api = vercel((method) =>
      method === "POST" ? { status: 201, body: { created: [], failed: [{ error: { code: "ENV_CONFLICT", message: "conflict", key: "CRON_SECRET" } }] } } : { status: 200, body: {} },
    );
    await expect(applyProject("api", env, version, api.fetch)).rejects.toThrow("Vercel did not save CRON_SECRET on prj_api: ENV_CONFLICT: conflict");
  });

  it("needs the token, the team and the project's id", async () => {
    await expect(applyProject("web", { ...env, VERCEL_WEB_PROJECT_ID: "" }, version, vercel().fetch)).rejects.toThrow("VERCEL_WEB_PROJECT_ID is required");
    await expect(applyProject("web", { ...env, VERCEL_TOKEN: undefined }, version, vercel().fetch)).rejects.toThrow("VERCEL_TOKEN is required");
  });
});

describe("automationBypass", () => {
  const secret = "x".repeat(32);

  it("returns Admin's Protection Bypass for Automation secret", async () => {
    const api = vercel(() => ({ status: 200, body: { id: "prj_admin", protectionBypass: { other: { scope: "integration-automation-bypass" }, [secret]: { scope: "automation-bypass", createdAt: 1 } } } }));
    expect(await automationBypass("admin", env, api.fetch)).toBe(secret);
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.vercel.com/v9/projects/prj_admin?teamId=team_123"]);
  });

  it("generates one when the project has none", async () => {
    const api = vercel((method) =>
      method === "GET" ? { status: 200, body: { id: "prj_admin" } } : { status: 200, body: { protectionBypass: { [secret]: { scope: "automation-bypass", createdAt: 2 } } } },
    );
    expect(await automationBypass("admin", env, api.fetch)).toBe(secret);
    expect(api.calls[1]).toMatchObject({ method: "PATCH", url: "https://api.vercel.com/v1/projects/prj_admin/protection-bypass?teamId=team_123", body: { generate: { note: "deploy-uat.yml smoke (RP-1043)" } } });
  });
});
