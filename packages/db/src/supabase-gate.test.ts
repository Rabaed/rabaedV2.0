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
  it("passes when the call with the publishable key gets the Data-API-off answer", async () => {
    const { calls, fetch } = answering(406, dataApiOffBody);

    const result = await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch });

    expect(result).toEqual({ outcome: "off", status: 406 });
    expect(calls).toEqual([{ url: "https://abcdefghijklmnop.supabase.co/rest/v1/", headers: { apikey: key } }]);
  });

  it("passes on a 2xx too when it is the placeholder schema's empty description: nothing is exposed", async () => {
    const { fetch } = answering(200, '{"swagger":"2.0","info":{"title":"pg_pgrst_no_exposed_schemas"},"paths":{}}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "off", status: 200 });
  });

  it("fails when the REST endpoint answers as an open API", async () => {
    const { fetch } = answering(200, '{"swagger":"2.0","paths":{"/project":{}}}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "open", status: 200 });
  });

  it("fails when the gateway refuses the key: a 401 proves nothing about the Data API", async () => {
    const { fetch } = answering(401, '{"message":"Invalid API key"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "key refused", status: 401 });
  });

  it("fails on any other refusal, naming its PostgREST code, since it is not the Data-API-off answer", async () => {
    const { fetch } = answering(503, '{"code":"PGRST002","message":"Could not query the database for the schema cache"}');

    expect(await checkDataApiOff({ projectRef: ref, publishableKey: key, fetch })).toEqual({ outcome: "unexpected", status: 503, code: "PGRST002" });
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

// A seam 2 failure must not hide the Data API's answer: it is checked first, and its failure lets seam 2 run.
describe("gateSteps", () => {
  const env = {
    DATABASE_SUPERUSER_URL: `postgres://postgres.${ref}:su-pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
    SUPABASE_PROJECT_REF: ref,
    SUPABASE_PUBLISHABLE_KEY: key,
    DATABASE_MIGRATOR_PASSWORD: "mig-pw",
    DATABASE_APP_PASSWORD: "app-pw",
    DATABASE_ADMIN_PASSWORD: "adm-pw",
  };

  it("builds the database, then checks the Data API, then runs seam 2; only the Data API check keeps going", () => {
    const steps = gateSteps({ env, seamTwo: () => Promise.resolve(), onUrls: () => "read" });

    expect(steps.map((s) => [s.name, !!s.keepsGoing])).toEqual([
      ["Read the connections", false],
      ["The bootstrap login may create rabaed_admin with BYPASSRLS", false],
      ["Drop the gate's database from an earlier run", false],
      ["Bootstrap (rabaed_migrator, rabaed_app, rabaed_admin with BYPASSRLS)", false],
      ["rabaed_admin bypasses row-level security", false],
      ["Migrate the schema (every migrations/*.sql)", false],
      ["The transaction pooler carries an api call's transaction", false],
      ["Supabase's Data API is off", true],
      ["Seam 2", false],
    ]);
  });

  it("still runs seam 2 when the Data API is on, and fails the gate naming the Data API", async () => {
    const { fetch } = answering(200, '{"swagger":"2.0","paths":{"/project":{}}}');
    const seamTwoRanAs: string[] = [];
    const steps = gateSteps({ env, fetch, seamTwo: async (urls) => void seamTwoRanAs.push(urls.migrator), onUrls: () => "read" });
    const dataApi = steps.findIndex((s) => s.name === "Supabase's Data API is off");
    const said: string[] = [];

    // The connections, then (no database here) the steps from the Data API on.
    const failed = await runGateSteps([steps[0]!, ...steps.slice(dataApi)], (line) => said.push(line), (error) => (error as Error).message);

    expect(failed).toEqual(["Supabase's Data API is off"]);
    expect(seamTwoRanAs).toEqual([`postgres://rabaed_migrator.${ref}:mig-pw@aws-1-eu-central-1.pooler.supabase.com:5432/rabaed_gate`]);
    expect(said).toContain("✘ Supabase's Data API is off: rest/v1/ answered 200: the Data API is on, a way to the tables around the api");
  });
});

