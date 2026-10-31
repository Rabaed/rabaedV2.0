import { describe, expect, it } from "vitest";
import { applyProject, automationBypass, PROJECTS, projectEnv, projectSettings, commandEnv, pnpmCommand, recordsContainerEnv, recordsSecretsImport, uatDatabase, type ProjectName } from "./uat-deploy.ts";

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

  const fileStore = ["PROJECT_FILES_BUCKET", "FILE_STORE_ENDPOINT", "FILE_STORE_ACCESS_KEY_ID", "FILE_STORE_SECRET_ACCESS_KEY", "FILE_STORE_REGION"];

  it("gives the demo command UAT's file store, so the demo's images are stored as the api stores them (RP-672)", () => {
    expect(commandEnv(env, { fileStore: true })).toMatchObject({
      PROJECT_FILES_BUCKET: "rabaed-uat-files",
      FILE_STORE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      FILE_STORE_ACCESS_KEY_ID: "r2-rw-key-id",
      FILE_STORE_SECRET_ACCESS_KEY: "r2-rw-secret",
      FILE_STORE_REGION: "auto",
    });
    // Without the store's key (a workflow step that does not pass it), none of the store: the demo seeds with no images stored.
    const without = commandEnv({ ...env, FILE_STORE_SECRET_ACCESS_KEY: undefined }, { fileStore: true });
    for (const variable of fileStore) expect(without[variable], variable).toBeUndefined();
  });

  it("gives the migrations and the app-role check nothing of the file store", () => {
    const command = commandEnv(env);
    for (const variable of fileStore) expect(command[variable], variable).toBeUndefined();
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
      commandForIgnoringBuildStep: "node ../../scripts/vercel-preview-gate.ts admin",
      rootDirectory: "apps/admin",
      framework: null,
      passwordProtection: { deploymentType: "all", password: "admin-vercel-password" },
    });
  });

  // The owner has yet to decide on Admin's Password Protection ($20 a month): without
  // the secret, the setting is left as it is, neither applied nor removed.
  it("leave Admin's Password Protection alone when ADMIN_VERCEL_PASSWORD is empty", () => {
    const settings = projectSettings("admin", { ...env, ADMIN_VERCEL_PASSWORD: "" });
    expect(settings).not.toHaveProperty("passwordProtection");
    expect(settings).toMatchObject({ rootDirectory: "apps/admin", commandForIgnoringBuildStep: "node ../../scripts/vercel-preview-gate.ts admin" });
  });
});

describe("the three Vercel projects' environment variables", () => {
  // Previews of web and the api run a branch's code against UAT (ADR 0026); Admin has no
  // previews, and nothing of its reaches one. The commit and the cron secret are production's
  // (Vercel runs crons on production only).
  it("are every one Sensitive; previews get web's and the api's, but the commit, the cron secret and all of Admin's", () => {
    const productionOnly = (project: ProjectName, key: string) => project === "admin" || key === "APP_VERSION" || key === "CRON_SECRET";
    for (const project of PROJECTS) {
      for (const variable of projectEnv(project, env, version)) {
        expect(variable.type, `${project} ${variable.key}`).toBe("sensitive");
        expect(variable.target, `${project} ${variable.key}`).toEqual(productionOnly(project, variable.key) ? ["production"] : ["production", "preview"]);
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

  // Each workflow step passes only its project's secrets: the api's never holds the
  // bypass role's password, nor Admin's the app role's; neither holds the migrator's.
  it("need only what the project itself gets", () => {
    expect(projectEnv("web", { UAT_API_URL: env.UAT_API_URL }, version).map((v) => v.key)).toEqual(["APP_VERSION", "API_URL"]);
    const without = (...names: string[]) => Object.fromEntries(Object.entries(env).filter(([name]) => !names.includes(name)));
    expect(projectEnv("api", without("DATABASE_ADMIN_PASSWORD", "DATABASE_MIGRATOR_PASSWORD"), version)).toEqual(projectEnv("api", env, version));
    expect(projectEnv("admin", without("DATABASE_APP_PASSWORD", "DATABASE_MIGRATOR_PASSWORD"), version)).toEqual(projectEnv("admin", env, version));
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
  const saved = (method: string) => ({ status: method === "POST" ? 201 : 200, body: method === "POST" ? { created: [], failed: [] } : {} });
  const patch = "PATCH https://api.vercel.com/v9/projects/prj_admin?teamId=team_123";

  // Deploy UAT run 40395859131: one combined PATCH was refused whole (403), naming no field.
  it("patches each setting alone, in a fixed order, then upserts its variables, for the team, with the token", async () => {
    const api = vercel(saved);
    const lines: string[] = [];
    await applyProject("admin", env, version, api.fetch, (line) => lines.push(line));
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([...Array(8).fill(patch), "POST https://api.vercel.com/v10/projects/prj_admin/env?upsert=true&teamId=team_123"]);
    expect(api.calls.every((c) => c.authorization === "Bearer vercel-token-secret")).toBe(true);
    expect(api.calls.slice(0, 8).map((c) => c.body)).toEqual([
      { nodeVersion: "24.x" },
      { sourceFilesOutsideRootDirectory: true },
      { rootDirectory: "apps/admin" },
      { framework: null },
      { commandForIgnoringBuildStep: "node ../../scripts/vercel-preview-gate.ts admin" },
      { serverlessFunctionRegion: "fra1" },
      { ssoProtection: { deploymentType: "preview" } },
      { passwordProtection: { deploymentType: "all", password: "admin-vercel-password" } },
    ]);
    expect(api.calls[8]?.body).toEqual(projectEnv("admin", env, version));
    expect(lines).toEqual([
      "prj_admin nodeVersion: applied",
      "prj_admin sourceFilesOutsideRootDirectory: applied",
      "prj_admin rootDirectory: applied",
      "prj_admin framework: applied",
      "prj_admin commandForIgnoringBuildStep: applied",
      "prj_admin serverlessFunctionRegion: applied",
      "prj_admin ssoProtection: applied",
      "prj_admin passwordProtection: applied",
    ]);
  });

  it("skips Admin's Password Protection when ADMIN_VERCEL_PASSWORD is empty", async () => {
    const api = vercel(saved);
    await applyProject("admin", { ...env, ADMIN_VERCEL_PASSWORD: "" }, version, api.fetch, () => {});
    expect(api.calls.some((c) => "passwordProtection" in (c.body as object))).toBe(false);
    expect(api.calls).toHaveLength(8);
  });

  const forbidden = { status: 403, body: { error: { code: "forbidden", message: "Not authorized" } } };
  const refusing =
    (...fields: string[]) =>
    (method: string, _url: URL, body: unknown) =>
      method === "PATCH" && fields.includes(Object.keys(body as object)[0]!) ? forbidden : saved(method);

  // The variables (secrets, some for previews) wait for every setting: a refused
  // ssoProtection would leave previews open to them.
  it("still applies the other settings when Vercel refuses one, sends no variables, then fails naming it", async () => {
    const api = vercel(refusing("ssoProtection"));
    const lines: string[] = [];
    await expect(applyProject("api", env, version, api.fetch, (line) => lines.push(line))).rejects.toThrow(
      /^Vercel refused ssoProtection on prj_api: 403 forbidden: Not authorized$/,
    );
    expect(api.calls.map((c) => c.method)).toEqual(Array(7).fill("PATCH"));
    expect(lines).toContain("prj_api ssoProtection: refused (403 forbidden: Not authorized)");
    expect(lines).toContain("prj_api variables: not sent, a setting was refused");
    expect(lines.filter((line) => line.endsWith(": applied"))).toHaveLength(6);
  });

  it("goes on past a setting whose request fails, and names it", async () => {
    const api = vercel(refusing("nodeVersion"));
    const failing = (async (input: string | URL, init?: RequestInit) => {
      if (String(init?.body).includes("framework")) throw new TypeError("fetch failed");
      return api.fetch(input, init);
    }) as typeof globalThis.fetch;
    await expect(applyProject("web", env, version, failing, () => {})).rejects.toThrow(
      "Vercel refused nodeVersion on prj_web: 403 forbidden: Not authorized; Vercel refused framework on prj_web: no answer (fetch failed)",
    );
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(6);
  });

  it("hides Admin's password should Vercel quote it back", async () => {
    const api = vercel((method, _url, body) =>
      "passwordProtection" in (body as object) ? { status: 400, body: { error: { code: "bad_request", message: "weak password admin-vercel-password" } } } : saved(method),
    );
    const lines: string[] = [];
    const error = await applyProject("admin", env, version, api.fetch, (line) => lines.push(line)).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe("Vercel refused passwordProtection on prj_admin: 400 bad_request: weak password ***");
    expect(lines.join("\n")).not.toContain("admin-vercel-password");
  });

  it("names every setting Vercel refuses", async () => {
    const api = vercel(refusing("serverlessFunctionRegion", "passwordProtection"));
    await expect(applyProject("admin", env, version, api.fetch, () => {})).rejects.toThrow(
      "Vercel refused serverlessFunctionRegion on prj_admin: 403 forbidden: Not authorized; Vercel refused passwordProtection on prj_admin: 403 forbidden: Not authorized",
    );
  });

  it("names the variables when Vercel refuses their request", async () => {
    const api = vercel((method) => (method === "POST" ? forbidden : saved(method)));
    await expect(applyProject("web", env, version, api.fetch, () => {})).rejects.toThrow(/^Vercel refused the variables of prj_web: 403 forbidden: Not authorized$/);
  });

  it("prints and fails with no secret or value", async () => {
    const api = vercel(() => forbidden);
    const lines: string[] = [];
    const error = await applyProject("admin", env, version, api.fetch, (line) => lines.push(line)).catch((e: unknown) => e as Error);
    const said = [...lines, (error as Error).message].join("\n");
    expect(said).toContain("passwordProtection");
    for (const name of ["VERCEL_TOKEN", "ADMIN_VERCEL_PASSWORD", "DATABASE_ADMIN_PASSWORD", "SENDGRID_API_KEY"]) expect(said, name).not.toContain(env[name]!);
    expect(said).not.toMatch(/secret|apps\/admin|fra1/);
  });

  it("fails when a variable was not saved, naming the variable", async () => {
    const api = vercel((method) =>
      method === "POST" ? { status: 201, body: { created: [], failed: [{ error: { code: "ENV_CONFLICT", message: "conflict", key: "CRON_SECRET" } }] } } : { status: 200, body: {} },
    );
    await expect(applyProject("api", env, version, api.fetch)).rejects.toThrow("Vercel did not save CRON_SECRET on prj_api: ENV_CONFLICT: conflict");
  });

  it("needs the token, the team and the project's id", async () => {
    await expect(applyProject("web", { ...env, VERCEL_WEB_PROJECT_ID: "" }, version, vercel().fetch)).rejects.toThrow("VERCEL_WEB_PROJECT_ID is required");
    const api = vercel();
    await expect(applyProject("web", { ...env, VERCEL_TOKEN: undefined }, version, api.fetch, () => {})).rejects.toThrow(/^VERCEL_TOKEN is required/);
    expect(api.calls).toEqual([]);
  });
});

describe("the pnpm commands the deploy runs", () => {
  it("runs db's setup, the app role check and the demo CLI", () => {
    expect(pnpmCommand("migrate")).toEqual(["--filter", "@rabaed/db", "run", "setup"]);
    expect(pnpmCommand("app-role-check")).toEqual(["--filter", "@rabaed/db", "exec", "tsx", "src/check-app-role.ts"]);
    expect(pnpmCommand("demo", "ensure")).toEqual(["--filter", "@rabaed/api", "exec", "tsx", "src/cli/demo-environment.ts", "ensure"]);
    expect(pnpmCommand("demo", "reset")).toEqual(["--filter", "@rabaed/api", "exec", "tsx", "src/cli/demo-environment.ts", "reset"]);
  });

  // `pnpm --filter @rabaed/db setup` ran pnpm's own `setup`, which refused the
  // --recursive that --filter implies (Deploy UAT run 40388707146): a package's
  // script goes through `run`, a binary through `exec`.
  it("names `run` or `exec` after the package, so no pnpm built-in shadows a script", () => {
    for (const [command, argument] of [["migrate"], ["app-role-check"], ["demo", "ensure"], ["demo", "reset"]] as const) {
      const [filter, , word] = pnpmCommand(command, argument) ?? [];
      expect(filter).toBe("--filter");
      expect(["run", "exec"]).toContain(word);
    }
  });

  it("has none for another command, and refuses another demo argument", () => {
    expect(pnpmCommand("project", "web")).toBeUndefined();
    expect(() => pnpmCommand("demo", "drop")).toThrow("demo ensure|reset");
  });
});

describe("automationBypass", () => {
  const secret = "x".repeat(32);
  const protectedAdmin = { passwordProtection: { deploymentType: "all" } };

  it("returns Admin's Protection Bypass for Automation secret while Admin has Password Protection", async () => {
    const api = vercel(() => ({
      status: 200,
      body: { id: "prj_admin", ...protectedAdmin, protectionBypass: { other: { scope: "integration-automation-bypass" }, [secret]: { scope: "automation-bypass", createdAt: 1 } } },
    }));
    expect(await automationBypass("admin", env, api.fetch)).toBe(secret);
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://api.vercel.com/v9/projects/prj_admin?teamId=team_123"]);
  });

  // The smoke follows Admin's protection as Vercel has it, not the secret: an empty
  // ADMIN_VERCEL_PASSWORD leaves an earlier protection in place.
  it("returns nothing while Admin has no Password Protection, so the smoke reaches it plainly", async () => {
    const api = vercel(() => ({ status: 200, body: { id: "prj_admin", passwordProtection: null, protectionBypass: { [secret]: { scope: "automation-bypass" } } } }));
    expect(await automationBypass("admin", env, api.fetch)).toBe("");
    expect(api.calls).toHaveLength(1);
  });

  it("generates one when the protected project has none", async () => {
    const api = vercel((method) =>
      method === "GET" ? { status: 200, body: { id: "prj_admin", ...protectedAdmin } } : { status: 200, body: { protectionBypass: { [secret]: { scope: "automation-bypass", createdAt: 2 } } } },
    );
    expect(await automationBypass("admin", env, api.fetch)).toBe(secret);
    expect(api.calls[1]).toMatchObject({ method: "PATCH", url: "https://api.vercel.com/v1/projects/prj_admin/protection-bypass?teamId=team_123", body: { generate: { note: "deploy-uat.yml smoke (RP-1043)" } } });
  });
});

// The UAT Records container (RP-1042, ADR 0026): deploy-records-uat.yml imports these as its Fly
// secrets, from the same `uat` environment, so the container reads the api's database and files.
describe("the Records container's secrets", () => {
  it("are the app role over the transaction pooler, the Project files store and the web's address, and nothing else", () => {
    const vars = recordsContainerEnv(env, version);
    expect(Object.keys(vars).sort()).toEqual(
      ["APP_VERSION", "DATABASE_APP_URL", "DATABASE_POOL_MAX", "FILE_STORE_ACCESS_KEY_ID", "FILE_STORE_ENDPOINT", "FILE_STORE_REGION", "FILE_STORE_SECRET_ACCESS_KEY", "PROJECT_FILES_BUCKET", "WEB_URL"].sort(),
    );
    expect(vars.DATABASE_APP_URL).toBe(varsOf("api").DATABASE_APP_URL);
    expect(vars.WEB_URL).toBe(env.UAT_WEB_URL);
    expect(vars.FILE_STORE_REGION).toBe("auto");
    // Never the mail key, the cron secret, the fonts key or another role's password.
    const all = JSON.stringify(vars);
    for (const name of ["SENDGRID_API_KEY", "CRON_SECRET", "FONTS_SECRET_ACCESS_KEY", "DATABASE_ADMIN_PASSWORD", "DATABASE_MIGRATOR_PASSWORD"] as const) {
      expect(all).not.toContain(env[name]!);
    }
  });

  it("print as the lines `fly secrets import` reads, one NAME=VALUE a line", () => {
    const lines = recordsSecretsImport({ A: "1", B: "postgres://x:y@h/db?sslmode=require" });
    expect(lines).toBe("A=1\nB=postgres://x:y@h/db?sslmode=require\n");
  });

  it("refuse a value with a line break, which would break the import", () => {
    expect(() => recordsSecretsImport({ A: "one\ntwo" })).toThrow(/A/);
  });

  it("fail, naming it, when a setting is missing", () => {
    const { PROJECT_FILES_BUCKET: _omitted, ...rest } = env;
    expect(() => recordsContainerEnv(rest, version)).toThrow(/PROJECT_FILES_BUCKET/);
  });
});
