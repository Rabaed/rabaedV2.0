import { describe, expect, it } from "vitest";
import { r2PrivateCheck, r2PrivateFromEnv } from "./r2-private.ts";

// The UAT deploy's check that neither R2 bucket has public access (RP-1047), against a stubbed
// Cloudflare API shaped as its docs give it: "Get r2.dev Domain of Bucket" and "List Custom Domains
// of Bucket" (developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains).

const accountId = "0123456789abcdef0123456789abcdef";
const token = "cf-test-token-not-a-real-one-1047";
const buckets = [
  { label: "files", name: "rabaed-uat-files" },
  { label: "fonts", name: "rabaed-uat-build-assets" },
] as const;
const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;

type Route = { status?: number; body: unknown };

/** Cloudflare's envelope around a result. */
const ok = (result: unknown): Route => ({ body: { success: true, errors: [], messages: [], result } });
const managed = (bucket: string, enabled: boolean): Route => ok({ bucketId: "0113a9e4549cf9b1ff1bf56e04da0cef", domain: `pub-0113a9e4549cf9b1ff1bf56e04da0cef.r2.dev`, enabled, bucket });
const custom = (domains: { domain: string; enabled: boolean }[] = []): Route =>
  ok({ domains: domains.map((d) => ({ ...d, status: { ownership: "active", ssl: "active" }, zoneId: "zone", zoneName: "example.com" })) });

/** Both buckets private (no r2.dev, no custom domain), with `overrides` for the case under test; records what was asked. */
function cloudflare(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {};
  for (const { name } of buckets) {
    routes[`${api}/${name}/domains/managed`] = managed(name, false);
    routes[`${api}/${name}/domains/custom`] = custom();
  }
  Object.assign(routes, overrides);
  const asked: { url: string; headers: Headers }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    asked.push({ url: String(input), headers: new Headers(init?.headers) });
    const route = routes[String(input)];
    if (!route) throw new TypeError(`fetch failed: ${input}`);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

describe("R2 buckets stay private", () => {
  it("passes when neither bucket has its r2.dev URL or a custom domain on", async () => {
    const { fetch, asked } = cloudflare();
    expect(await r2PrivateCheck({ accountId, token, buckets, fetch })).toEqual([]);
    expect(asked.map((a) => a.url)).toEqual([
      `${api}/rabaed-uat-files/domains/managed`,
      `${api}/rabaed-uat-files/domains/custom`,
      `${api}/rabaed-uat-build-assets/domains/managed`,
      `${api}/rabaed-uat-build-assets/domains/custom`,
    ]);
    expect(asked.every((a) => a.headers.get("authorization") === `Bearer ${token}`)).toBe(true);
  });

  it.each(buckets)("fails when the $label bucket's r2.dev URL is on, naming that bucket", async ({ label, name }) => {
    const { fetch } = cloudflare({ [`${api}/${name}/domains/managed`]: managed(name, true) });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([`the ${label} bucket ${name} is public at its r2.dev URL pub-0113a9e4549cf9b1ff1bf56e04da0cef.r2.dev: turn it off (R2 > ${name} > Settings > Public Development URL > Disable)`]);
  });

  it("fails when a bucket has a custom domain on, naming the bucket and the domain", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-build-assets/domains/custom`]: custom([{ domain: "fonts.example.com", enabled: true }]) });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual(["the fonts bucket rabaed-uat-build-assets is public at its custom domain fonts.example.com: disable or remove it (R2 > rabaed-uat-build-assets > Settings > Custom Domains)"]);
  });

  // Cloudflare: a custom domain's `enabled` is "whether this bucket is publicly accessible at this domain".
  it("passes a custom domain that is connected but disabled", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-files/domains/custom`]: custom([{ domain: "files.example.com", enabled: false }]) });
    expect(await r2PrivateCheck({ accountId, token, buckets, fetch })).toEqual([]);
  });

  it("names every public address of both buckets in one run", async () => {
    const { fetch } = cloudflare({
      [`${api}/rabaed-uat-files/domains/managed`]: managed("rabaed-uat-files", true),
      [`${api}/rabaed-uat-files/domains/custom`]: custom([
        { domain: "a.example.com", enabled: true },
        { domain: "b.example.com", enabled: true },
      ]),
      [`${api}/rabaed-uat-build-assets/domains/managed`]: managed("rabaed-uat-build-assets", true),
    });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toHaveLength(4);
    expect(failures.filter((f) => f.includes("files bucket"))).toHaveLength(3);
    expect(failures.filter((f) => f.includes("fonts bucket"))).toHaveLength(1);
  });
});

describe("R2 buckets stay private: an answer it cannot read fails, never passes", () => {
  const refused = (status: number, code: number, message: string): Route => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

  it("fails on a token Cloudflare refuses, with Cloudflare's code and message", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-files/domains/managed`]: refused(403, 10000, "Authentication error") });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([
      "the files bucket rabaed-uat-files: Cloudflare answered 403 to GET domains/managed (10000 Authentication error); is CLOUDFLARE_R2_READ_TOKEN a Workers R2 Storage Read token for this account?",
    ]);
  });

  // What Cloudflare's API answered a token it does not know, asked by hand on 2026-11-07.
  it("names the token for a token Cloudflare does not know (400, 9106)", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-files/domains/managed`]: refused(400, 9106, "Authentication failed (status: 400)") });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([expect.stringMatching(/answered 400 to GET domains\/managed \(9106 Authentication failed \(status: 400\)\); is CLOUDFLARE_R2_READ_TOKEN a Workers R2 Storage Read token/)]);
  });

  it("fails on a bucket that does not exist, and still checks the other", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-files/domains/custom`]: refused(404, 10006, "The specified bucket does not exist.") });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([expect.stringMatching(/^the files bucket rabaed-uat-files: Cloudflare answered 404 to GET domains\/custom \(10006 The specified bucket does not exist\.\)/)]);
  });

  it("fails on an answer that is not Cloudflare's JSON", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-build-assets/domains/managed`]: { status: 502, body: "<html>Bad gateway</html>" } });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([expect.stringMatching(/^the fonts bucket rabaed-uat-build-assets: Cloudflare answered 502 to GET domains\/managed/)]);
  });

  it("fails on a 200 whose result does not say whether the bucket is public", async () => {
    const { fetch } = cloudflare({
      [`${api}/rabaed-uat-files/domains/managed`]: ok({ domain: "pub-x.r2.dev" }),
      [`${api}/rabaed-uat-files/domains/custom`]: ok({ domains: [{ domain: "a.example.com" }] }),
    });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toEqual([
      "the files bucket rabaed-uat-files: Cloudflare's answer to GET domains/managed does not say whether it is public",
      "the files bucket rabaed-uat-files: Cloudflare's answer to GET domains/custom does not say whether it is public",
    ]);
  });

  it("fails when Cloudflare cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch: down });
    expect(failures).toEqual([
      "the files bucket rabaed-uat-files: Cloudflare's API could not be reached for GET domains/managed (fetch failed)",
      "the files bucket rabaed-uat-files: Cloudflare's API could not be reached for GET domains/custom (fetch failed)",
      "the fonts bucket rabaed-uat-build-assets: Cloudflare's API could not be reached for GET domains/managed (fetch failed)",
      "the fonts bucket rabaed-uat-build-assets: Cloudflare's API could not be reached for GET domains/custom (fetch failed)",
    ]);
  });

  it("never prints the token, even when an answer quotes it", async () => {
    const { fetch } = cloudflare({ [`${api}/rabaed-uat-files/domains/managed`]: refused(400, 6003, `Invalid request headers: Bearer ${token}`) });
    const failures = await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(failures).toHaveLength(1);
    expect(failures.join("\n")).not.toContain(token);
    expect(failures[0]).toContain("Bearer ***");
  });
});

describe("R2 buckets stay private: what the deploy step passes", () => {
  // As environment uat holds them: the file store's endpoint (vars.FILE_STORE_ENDPOINT, R2's S3 address
  // `https://<account id>.r2.cloudflarestorage.com`), both bucket names, and the read-only token.
  const env = {
    FILE_STORE_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
    PROJECT_FILES_BUCKET: "rabaed-uat-files",
    BUILD_ASSETS_BUCKET: "rabaed-uat-build-assets",
    CLOUDFLARE_R2_READ_TOKEN: token,
  };

  it("takes the account from the file store's endpoint, and both buckets", () => {
    expect(r2PrivateFromEnv(env)).toEqual({ options: { accountId, token, buckets } });
  });

  // The check runs on every UAT deploy (RP-1047's acceptance): a missing token fails it, never skips it.
  it("fails without the read-only token, naming the secret and where it goes", () => {
    expect(r2PrivateFromEnv({ ...env, CLOUDFLARE_R2_READ_TOKEN: "" })).toEqual({
      error: "CLOUDFLARE_R2_READ_TOKEN is not set: add the read-only R2 token (Workers R2 Storage Read) to GitHub environment uat (docs/tech-stack.md). The check never skips.",
    });
  });

  it.each(["PROJECT_FILES_BUCKET", "BUILD_ASSETS_BUCKET", "FILE_STORE_ENDPOINT"])("fails without %s", (name) => {
    expect(r2PrivateFromEnv({ ...env, [name]: undefined })).toEqual({ error: expect.stringContaining(`${name} is not set`) });
  });

  it("refuses an endpoint that is not R2's S3 address", () => {
    expect(r2PrivateFromEnv({ ...env, FILE_STORE_ENDPOINT: "https://s3.eu-central-1.amazonaws.com" })).toEqual({
      error: "FILE_STORE_ENDPOINT is not R2's S3 address (https://<account id>[.<jurisdiction>].r2.cloudflarestorage.com), so the account is unknown",
    });
  });

  // R2's docs, "Data location": a jurisdiction's S3 address is `<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com`,
  // and its REST API takes the jurisdiction in the `cf-r2-jurisdiction` header.
  it("asks a jurisdiction's buckets with the cf-r2-jurisdiction header", async () => {
    const run = r2PrivateFromEnv({ ...env, FILE_STORE_ENDPOINT: `https://${accountId}.eu.r2.cloudflarestorage.com/` });
    expect(run).toEqual({ options: { accountId, token, buckets, jurisdiction: "eu" } });
    const { fetch, asked } = cloudflare();
    expect(await r2PrivateCheck({ ...("options" in run ? run.options : { accountId, token, buckets }), fetch })).toEqual([]);
    expect(asked.map((a) => a.headers.get("cf-r2-jurisdiction"))).toEqual(["eu", "eu", "eu", "eu"]);
  });

  it("sends no jurisdiction header for the default jurisdiction", async () => {
    const { fetch, asked } = cloudflare();
    await r2PrivateCheck({ accountId, token, buckets, fetch });
    expect(asked.map((a) => a.headers.get("cf-r2-jurisdiction"))).toEqual([null, null, null, null]);
  });
});
