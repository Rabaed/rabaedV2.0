import { describe, expect, it } from "vitest";
import { checkDataApiOff, gateSteps, gateUrlsFromEnv, redactor, runGateSteps, seamTwoEnv } from "./supabase-gate.ts";

describe("seamTwoEnv", () => {
  const urls = gateUrlsFromEnv({
    DATABASE_SUPERUSER_URL: "postgres://postgres.abcdefghijklmnop:su-pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres",
    SUPABASE_PROJECT_REF: "abcdefghijklmnop",
    DATABASE_MIGRATOR_PASSWORD: "mig-pw",
    DATABASE_APP_PASSWORD: "app-pw",
    DATABASE_ADMIN_PASSWORD: "adm-pw",
  });
  // A worktree's .env, or a stale variable, must not win over the gate's connections.
  const base = { DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator:local@localhost:5432/rabaed", DATABASE_ROLE_PASSWORDS: "always", PATH: "/bin" };
  const env = seamTwoEnv(urls, "abcdefghijklmnop", base);

  it("connects seam 2 as the gate's roles: <role>.<project ref> with the gate's passwords, on the session pooler", () => {
    expect(env.DATABASE_SUPERUSER_URL).toBe(urls.superuser);
    expect(env.DATABASE_MIGRATOR_URL).toBe("postgres://rabaed_migrator.abcdefghijklmnop:mig-pw@aws-1-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(env.DATABASE_APP_URL).toBe("postgres://rabaed_app.abcdefghijklmnop:app-pw@aws-1-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(env.DATABASE_ADMIN_URL).toBe("postgres://rabaed_admin.abcdefghijklmnop:adm-pw@aws-1-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(env.PATH).toBe("/bin");
  });

  // Supavisor caches each role's SCRAM secret: a password set again (even to the same value,
  // with a new salt) fails the next pooled login with 28P01 until the cache refreshes.
  it("has seam 2's reset leave the roles' passwords as they are", () => {
    expect(env.DATABASE_ROLE_PASSWORDS).toBe("on-create");
  });

  it("names the remote server seam 2 may reset its test database on, only for a Supabase run", () => {
    expect(env.RABAED_REMOTE_TEST_DATABASE_SERVER).toBe("abcdefghijklmnop@aws-1-eu-central-1.pooler.supabase.com");
    expect(seamTwoEnv(urls, undefined, {}).RABAED_REMOTE_TEST_DATABASE_SERVER).toBeUndefined();
  });

  // From a US runner to Frankfurt a hook ran past 180 s, and the hook it abandoned, still running,
  // drained the next describe's outbox rows (run 40079800929, package-rls.test.ts).
  it("gives each seam 2 test and hook 30 minutes on Supabase, and leaves a local run's budget alone", () => {
    expect(env.RABAED_SEAM_TIMEOUT_MS).toBe("1800000");
    expect(seamTwoEnv(urls, undefined, { RABAED_SEAM_TIMEOUT_MS: "5" }).RABAED_SEAM_TIMEOUT_MS).toBeUndefined();
  });
});

describe("redactor", () => {
  it("hides every password it was given, and the credentials of any connection URL, wherever they appear", () => {
    const redact = redactor(["s3cret", "p@ss word"]);

    expect(redact("auth failed for s3cret; also p@ss word and p%40ss%20word")).toBe("auth failed for ***; also *** and ***");
    expect(redact("at postgres://rabaed_app.ref:other@pooler.supabase.com:6543/rabaed_gate here")).toBe(
      "at postgres://***@pooler.supabase.com:6543/rabaed_gate here",
    );
  });

  it("ignores empty passwords instead of starring every gap", () => {
    expect(redactor(["", "x1"])("ab x1")).toBe("ab ***");
  });
});

const passwords = { DATABASE_MIGRATOR_PASSWORD: "mig pw", DATABASE_APP_PASSWORD: "app-pw", DATABASE_ADMIN_PASSWORD: "adm-pw" };

describe("gateUrlsFromEnv", () => {
  const supabase = {
    ...passwords,
    SUPABASE_PROJECT_REF: "abcdefghijklmnop",
    DATABASE_SUPERUSER_URL: "postgres://postgres.abcdefghijklmnop:su-pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  };

  it("on Supabase, logs each role in through the session pooler as <role>.<project ref>", () => {
    const urls = gateUrlsFromEnv(supabase);

    expect(urls.migrator).toBe("postgres://rabaed_migrator.abcdefghijklmnop:mig%20pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(urls.app).toBe("postgres://rabaed_app.abcdefghijklmnop:app-pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(urls.admin).toBe("postgres://rabaed_admin.abcdefghijklmnop:adm-pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed_gate");
    expect(urls.superuser).toBe(supabase.DATABASE_SUPERUSER_URL);
  });

  it("on Supabase, probes the app and admin roles through the transaction pooler, port 6543 on the same host", () => {
    const urls = gateUrlsFromEnv(supabase);
    expect(urls.appTransaction).toBe("postgres://rabaed_app.abcdefghijklmnop:app-pw@aws-0-eu-central-1.pooler.supabase.com:6543/rabaed_gate");
    expect(urls.adminTransaction).toBe("postgres://rabaed_admin.abcdefghijklmnop:adm-pw@aws-0-eu-central-1.pooler.supabase.com:6543/rabaed_gate");
  });

  it("locally, with only the worktree's .env URLs, takes their passwords and a gate database named after theirs", () => {
    const urls = gateUrlsFromEnv({
      DATABASE_SUPERUSER_URL: "postgres://postgres:pw@localhost:5642/postgres",
      DATABASE_MIGRATOR_URL: "postgres://rabaed_migrator:m1@localhost:5642/rabaed_rp1037",
      DATABASE_APP_URL: "postgres://rabaed_app:a1@localhost:5642/rabaed_rp1037",
      DATABASE_ADMIN_URL: "postgres://rabaed_admin:d1@localhost:5642/rabaed_rp1037",
    });
    expect(urls.migrator).toBe("postgres://rabaed_migrator:m1@localhost:5642/rabaed_rp1037_gate");
    expect(urls.admin).toBe("postgres://rabaed_admin:d1@localhost:5642/rabaed_rp1037_gate");
  });

  it("locally, uses the plain role names on the superuser's server, and the app URL for the probe", () => {
    const urls = gateUrlsFromEnv({ ...passwords, DATABASE_SUPERUSER_URL: "postgres://postgres:pw@localhost:5642/postgres", DATABASE_NAME: "rabaed_rp1037_gate" });

    expect(urls.app).toBe("postgres://rabaed_app:app-pw@localhost:5642/rabaed_rp1037_gate");
    expect(urls.appTransaction).toBe(urls.app);
  });

  // The gate drops its database before each run, so it must never name the app's.
  it("refuses a DATABASE_NAME that doesn't end in _gate", () => {
    expect(() => gateUrlsFromEnv({ ...supabase, DATABASE_NAME: "rabaed" })).toThrow("DATABASE_NAME must end in _gate: the gate drops and rebuilds it");
  });

  it("names a missing password's variable", () => {
    const { DATABASE_ADMIN_PASSWORD: _omitted, ...rest } = supabase;
    expect(() => gateUrlsFromEnv(rest)).toThrow(/DATABASE_ADMIN_PASSWORD is required/);
  });

  it("refuses a superuser URL that logs in to another project than SUPABASE_PROJECT_REF, without printing the URL", () => {
    const other = { ...supabase, DATABASE_SUPERUSER_URL: "postgres://postgres.zzzzzzzzzzzzzzzz:su-pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" };
    expect(() => gateUrlsFromEnv(other)).toThrow(expect.objectContaining({ message: expect.stringMatching(/another project/) }));
    expect(() => gateUrlsFromEnv(other)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("su-pw") }));
  });
});

type Call = { url: string; headers: Record<string, string> };

function answering(status: number, body = "") {
  const calls: Call[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string> | undefined) } });
    return new Response(body, { status });
  };
  return { calls, fetch };
}

/** Answers each call with the next [status, body], the last one again once they run out. */
function answeringInTurn(...answers: [number, string][]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string> | undefined) } });
    const [status, body] = answers[Math.min(calls.length, answers.length) - 1]!;
    return new Response(body, { status });
  };
  return { calls, fetch };
}

const schemaCacheLoading = '{"code":"PGRST002","details":null,"hint":null,"message":"Could not query the database for the schema cache. Retrying."}';

// With the Data API off, Supabase keeps PostgREST running with only a placeholder schema
// exposed; its answer names that schema. (PostgREST's PGRST106 shape.)
const dataApiOffBody = JSON.stringify({
  code: "PGRST106",
  details: null,
  hint: "Only the following schemas are exposed: pg_pgrst_no_exposed_schemas",
  message: "Invalid schema: public",
});
const ref = "abcdefghijklmnop";
const key = "sb_publishable_x";

describe("checkDataApiOff", () => {
  // Supabase refuses a publishable (or anon) key on the OpenAPI root /rest/v1/ itself, on or off
  // (changelog 42949), so the call asks for a table: a request any client key may make.
  it("asks for a table, with the publishable key as apikey and no Authorization header", async () => {
    const { calls, fetch } = answering(406, dataApiOffBody);

    await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch });

    expect(calls).toEqual([{ url: "https://abcdefghijklmnop.supabase.co/rest/v1/company?select=id&limit=1", headers: { apikey: key } }]);
  });

  it("passes when the answer names the placeholder schema Supabase exposes with the Data API off", async () => {
    const { fetch } = answering(406, dataApiOffBody);

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "off", status: 406 });
  });

  it("passes on PostgREST's older wording of PGRST106 naming the placeholder schema too", async () => {
    const { fetch } = answering(406, '{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: pg_pgrst_no_exposed_schemas"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "off", status: 406 });
  });

  // Only the documented answer passes: PGRST106, 406, naming the placeholder schema. Any other
  // answer that merely mentions the placeholder is not it.
  it.each([
    ["PostgreSQL's refusal of the placeholder (3F000)", 400, '{"code":"3F000","message":"schema \\"pg_pgrst_no_exposed_schemas\\" does not exist"}'],
    ["a 5xx naming the placeholder", 503, '{"code":"PGRST000","message":"pg_pgrst_no_exposed_schemas"}'],
    ["PGRST106 on another status", 400, dataApiOffBody],
    ["PGRST106 naming another schema", 406, '{"code":"PGRST106","hint":"Only the following schemas are exposed: api","message":"Invalid schema: public"}'],
    ["a page that is not PostgREST's JSON", 502, "<html>pg_pgrst_no_exposed_schemas</html>"],
  ])("fails as unexpected on %s", async (_case, status, body) => {
    const { fetch } = answering(status, body);

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toMatchObject({ outcome: "unexpected", status });
  });

  it("fails on a 2xx, even with no rows: the table answered, so the Data API is on", async () => {
    const { fetch } = answering(200, "[]");

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "open", status: 200 });
  });

  // PostgREST answers 401 to the anon role (a publishable key's) when grants refuse it: the Data API
  // is on and reached the database, which must not read as the gateway refusing the key.
  it("fails as on when PostgREST itself refuses the table to the key's role (42501)", async () => {
    const { fetch } = answering(401, '{"code":"42501","details":null,"hint":null,"message":"permission denied for table company"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({
      outcome: "on",
      status: 401,
      code: "42501",
      message: "permission denied for table company",
    });
  });

  it("fails as key refused when the gateway refuses the key, saying what the gateway said", async () => {
    const { fetch } = answering(401, '{"message":"Invalid API key","hint":"Double check your Supabase `anon` or `service_role` API key."}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "key refused", status: 401, message: "Invalid API key" });
  });

  it("fails as key refused on a 403 with no PostgREST code too", async () => {
    const { fetch } = answering(403, "Forbidden");

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "key refused", status: 403, message: "Forbidden" });
  });

  // PostgREST serves Supabase's `postgres` database, which need not have Rabaed's tables.
  it("fails as on when PostgREST looked for the table in an exposed schema (PGRST205)", async () => {
    const { fetch } = answering(404, '{"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table \'public.company\' in the schema cache"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({
      outcome: "on",
      status: 404,
      code: "PGRST205",
      message: "Could not find the table 'public.company' in the schema cache",
    });
  });

  it("fails as key refused when PostgREST refuses the key's JWT (PGRST3xx)", async () => {
    const { fetch } = answering(401, '{"code":"PGRST301","message":"No suitable key or wrong key type"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({
      outcome: "key refused",
      status: 401,
      code: "PGRST301",
      message: "No suitable key or wrong key type",
    });
  });

  it("fails on any other answer, naming its PostgREST code and message, since it is not the Data-API-off answer", async () => {
    const { fetch } = answering(500, '{"code":"XX000","message":"internal error"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({
      outcome: "unexpected",
      status: 500,
      code: "XX000",
      message: "internal error",
    });
  });

  // PostgREST answers PGRST002 while it (re)builds its schema cache; asked right after the
  // migrations' DDL, run 40234606464 got it.
  it("asks again while PostgREST is still loading its schema cache (PGRST002), then judges the answer", async () => {
    const { calls, fetch } = answeringInTurn([503, schemaCacheLoading], [406, dataApiOffBody]);
    const waits: number[] = [];

    const result = await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch, sleep: async (ms) => void waits.push(ms) });

    expect(result).toEqual({ outcome: "off", status: 406 });
    expect(calls).toHaveLength(2);
    expect(waits).toHaveLength(1);
  });

  it("fails as unexpected, naming PGRST002, when the schema cache is still not loaded after six asks over two minutes", async () => {
    const { calls, fetch } = answering(503, schemaCacheLoading);
    const waits: number[] = [];

    const result = await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch, sleep: async (ms) => void waits.push(ms) });

    expect(result).toEqual({ outcome: "unexpected", status: 503, code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." });
    expect(calls).toHaveLength(6);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(120_000);
  });

  it("judges every other answer at once, without asking again", async () => {
    const { calls, fetch } = answering(404, '{"code":"PGRST205","message":"Could not find the table"}');
    const waits: number[] = [];

    await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch, sleep: async (ms) => void waits.push(ms) });

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("reports no message when PostgREST's answer has none, rather than its raw body", async () => {
    const { fetch } = answering(500, '{"code":"XX000","details":"a long detail","hint":null}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "unexpected", status: 500, code: "XX000" });
  });

  it("never repeats the key in the message it reports, and keeps the message short", async () => {
    const { fetch } = answering(401, JSON.stringify({ message: `Invalid API key ${key} ${"x".repeat(500)}` }));

    const result = await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch });

    expect(result).toMatchObject({ outcome: "key refused", status: 401 });
    const message = "message" in result ? (result.message ?? "") : "";
    expect(message).not.toContain(key);
    expect(message.length).toBeLessThanOrEqual(200);
  });

  it("requires the publishable key with a project ref, and makes no call without it", async () => {
    const { calls, fetch } = answering(406, dataApiOffBody);

    await expect(checkDataApiOff({ projectRef: ref, publishableKey: undefined, fetch })).rejects.toThrow(
      "SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_PROJECT_REF is set",
    );
    expect(calls).toEqual([]);
  });

  it("is skipped, saying so, when no project ref is given (a local run)", async () => {
    const { calls, fetch } = answering(200);

    expect(await checkDataApiOff({ projectRef: undefined, fetch })).toEqual({ outcome: "skipped" });
    expect(calls).toEqual([]);
  });

  it("refuses a project ref that is not a bare Supabase ref, so the call can't go to another host", async () => {
    const { fetch } = answering(406, dataApiOffBody);

    await expect(checkDataApiOff({ projectRef: "evil.example.com/x", publishableKey: key, fetch })).rejects.toThrow(/SUPABASE_PROJECT_REF/);
  });
});

describe("runGateSteps", () => {
  const failing = (message: string) => () => Promise.reject(new Error(message));

  it("stops at a failed step, naming it", async () => {
    const said: string[] = [];
    let ranAfter = false;

    const failed = await runGateSteps(
      [
        { name: "First", run: () => Promise.resolve("fine") },
        { name: "Second", run: failing("broke") },
        { name: "Third", run: async () => void (ranAfter = true) },
      ],
      (line) => said.push(line),
      (error) => (error as Error).message,
    );

    expect(failed).toEqual(["Second"]);
    expect(ranAfter).toBe(false);
    expect(said).toEqual(["▶ First", "✔ First: fine", "▶ Second", "✘ Second: broke"]);
  });

  it("runs the steps after a failed step that keeps going, and names every failure", async () => {
    const said: string[] = [];

    const failed = await runGateSteps(
      [
        { name: "Checked early", run: failing("refused"), keepsGoing: true },
        { name: "Later", run: () => Promise.resolve() },
        { name: "Last", run: failing("broke too") },
      ],
      (line) => said.push(line),
      (error) => (error as Error).message,
    );

    expect(failed).toEqual(["Checked early", "Last"]);
    expect(said).toEqual(["▶ Checked early", "✘ Checked early: refused", "▶ Later", "✔ Later", "▶ Last", "✘ Last: broke too"]);
  });

  it("names no failure when every step passes", async () => {
    expect(await runGateSteps([{ name: "Only", run: () => Promise.resolve() }], () => undefined, String)).toEqual([]);
  });
});

// A later failure must not hide the Data API's answer: it is checked first, and its failure lets the rest run.
describe("gateSteps", () => {
  const env = {
    DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}:su-pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
    SUPABASE_PROJECT_REF: ref,
    SUPABASE_PUBLISHABLE_KEY: key,
    DATABASE_MIGRATOR_PASSWORD: "mig-pw",
    DATABASE_APP_PASSWORD: "app-pw",
    DATABASE_ADMIN_PASSWORD: "adm-pw",
  };

  // Run 40234606464: asked right after 212 migrations, PostgREST was still reloading its schema
  // cache (PGRST002). The check needs no database, so it runs before any DDL.
  it("checks the Data API first, then builds the database and runs seam 2; only the Data API check keeps going", () => {
    const steps = gateSteps({ env, seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    expect(steps.map((s) => [s.name, !!s.keepsGoing])).toEqual([
      ["Supabase's Data API is off", true],
      ["Read the connections", false],
      ["The bootstrap login may create rabaed_admin with BYPASSRLS", false],
      ["Drop the gate's database from an earlier run", false],
      ["Bootstrap (rabaed_migrator, rabaed_app, rabaed_admin with BYPASSRLS)", false],
      ["rabaed_admin bypasses row-level security", false],
      ["Migrate the schema (every migrations/*.sql)", false],
      ["The transaction pooler carries an api call's transaction", false],
      ["Seam 2", false],
    ]);
  });

  it("still runs seam 2 when the Data API is on, and fails the gate naming the Data API", async () => {
    const { fetch } = answering(200, '[{"id":"00000000-0000-4000-8000-000000000001"}]');
    const seamTwoRanAs: string[] = [];
    const steps = gateSteps({ env, fetch, seamTwo: async (urls) => void seamTwoRanAs.push(urls.migrator), onUrls: () => "read" });
    const named = (name: string) => steps.find((s) => s.name === name)!;
    const said: string[] = [];

    // No database here: the Data API check, the connections, then seam 2.
    const failed = await runGateSteps(
      [named("Supabase's Data API is off"), named("Read the connections"), named("Seam 2")],
      (line) => said.push(line),
      (error) => (error as Error).message,
    );

    expect(failed).toEqual(["Supabase's Data API is off"]);
    expect(seamTwoRanAs).toEqual([`postgres://rabaed_migrator.${ref}:mig-pw@aws-1-eu-central-1.pooler.supabase.com:5432/rabaed_gate`]);
    expect(said).toContain("✘ Supabase's Data API is off: rest/v1/company answered 200: the Data API is on, a way to the tables around the api");
  });

  // Minutes instead of hours: one run that asks only whether the Data API is off.
  it("runs only the Data API check when SUPABASE_GATE_ONLY is data-api", async () => {
    const { fetch } = answering(406, dataApiOffBody);
    const steps = gateSteps({ env: { ...env, SUPABASE_GATE_ONLY: "data-api" }, fetch, seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    expect(steps.map((s) => s.name)).toEqual(["Supabase's Data API is off"]);
    expect(await runGateSteps(steps, () => undefined, String)).toEqual([]);
  });

  // A failed step, so the gate's own log says it, rather than a stack trace from the top level.
  it("refuses a SUPABASE_GATE_ONLY it doesn't know as its one failed step, naming the one it knows", async () => {
    const steps = gateSteps({ env: { ...env, SUPABASE_GATE_ONLY: "seam-2" }, seamTwo: () => Promise.resolve(), onUrls: () => "read" });
    const said: string[] = [];

    expect(await runGateSteps(steps, (line) => said.push(line), (error) => (error as Error).message)).toEqual(["Read SUPABASE_GATE_ONLY"]);
    expect(said).toContain('✘ Read SUPABASE_GATE_ONLY: SUPABASE_GATE_ONLY is "seam-2": the gate knows only "data-api" (unset runs the whole gate)');
  });

  // The Data API check keeps going, so a setting it refuses must still stop the gate before the database is built.
  it("stops at reading the connections on a project ref that is not a bare Supabase ref", async () => {
    const steps = gateSteps({ env: { ...env, SUPABASE_PROJECT_REF: "My-Ref" }, seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    await expect(steps.find((s) => s.name === "Read the connections")!.run()).rejects.toThrow(/SUPABASE_PROJECT_REF must be a bare project ref/);
  });

  it("waits out PostgREST's schema-cache reload with the wait it is given", async () => {
    const { fetch } = answeringInTurn([503, schemaCacheLoading], [406, dataApiOffBody]);
    const waits: number[] = [];
    const [step] = gateSteps({ env, fetch, sleep: async (ms) => void waits.push(ms), seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    await expect(step!.run()).resolves.toBe("rest/v1/company with the publishable key answered 406: no schema exposed");
    expect(waits).toHaveLength(1);
  });

  it("fails, not skips, the Data-API-only run without SUPABASE_PROJECT_REF, since it would then check nothing", async () => {
    const { SUPABASE_PROJECT_REF: _omitted, ...local } = env;
    const [step] = gateSteps({ env: { ...local, SUPABASE_GATE_ONLY: "data-api" }, seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    await expect(step!.run()).rejects.toThrow("SUPABASE_GATE_ONLY=data-api needs SUPABASE_PROJECT_REF and SUPABASE_PUBLISHABLE_KEY");
  });

  it("names PostgREST's code and message when the Data API is on but grants refuse the key's role", async () => {
    const { fetch } = answering(401, '{"code":"42501","message":"permission denied for table company"}');
    const step = gateSteps({ env, fetch, seamTwo: () => Promise.resolve(), onUrls: () => "read" }).find((s) => s.name === "Supabase's Data API is off")!;

    await expect(step.run()).rejects.toThrow(
      "rest/v1/company answered 401 (42501: permission denied for table company): the Data API is on, PostgREST answering from an exposed schema",
    );
  });

  it("says what the gateway said when it refuses the key, and that the key is what to check", async () => {
    const { fetch } = answering(401, '{"message":"Invalid API key"}');
    const step = gateSteps({ env, fetch, seamTwo: () => Promise.resolve(), onUrls: () => "read" }).find((s) => s.name === "Supabase's Data API is off")!;

    await expect(step.run()).rejects.toThrow(
      "rest/v1/company refused the publishable key (401: Invalid API key), which proves nothing about the Data API: check the SUPABASE_PUBLISHABLE_KEY secret",
    );
  });
});

