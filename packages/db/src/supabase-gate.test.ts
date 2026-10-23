import { describe, expect, it } from "vitest";
import { checkDataApiOff, gateUrlsFromEnv, redactor } from "./supabase-gate.ts";

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
