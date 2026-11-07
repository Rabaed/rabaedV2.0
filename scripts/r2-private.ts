/* eslint-disable rabaed/no-avoid-terms -- "account" is Cloudflare's account (its API's account_id) and "environment" GitHub's environment uat: neither is a Rabaed term */
import { resolve } from "node:path";

// The UAT deploy's check that neither R2 bucket has public access (RP-1047, ADR 0026). The licensed
// Thmanyah fonts (BUILD_ASSETS_BUCKET) and Project files (PROJECT_FILES_BUCKET) stay private only while
// neither bucket has its r2.dev URL or a custom domain on. R2's S3 address refuses unsigned requests
// even for a public bucket, so asking it proves nothing (RP-1043's probe was dropped for that);
// the bucket's own settings tell, read through Cloudflare's API:
//   GET /accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed   "Get r2.dev Domain of Bucket":
//       result.enabled, "whether this bucket is publicly accessible at the r2.dev domain"
//   GET /accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom    "List Custom Domains of Bucket":
//       result.domains[].enabled, "whether this bucket is publicly accessible at this domain"
// (developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains, read 2026-11-07),
// with a jurisdiction's buckets named in the optional `cf-r2-jurisdiction` header.
//
//   CLOUDFLARE_R2_READ_TOKEN=… FILE_STORE_ENDPOINT=https://<account id>.r2.cloudflarestorage.com \
//     PROJECT_FILES_BUCKET=… BUILD_ASSETS_BUCKET=… node scripts/r2-private.ts
//
// The token is a Cloudflare API token with Account > Workers R2 Storage > Read only (Cloudflare's
// "API token permissions"), kept in GitHub environment uat and given to this step alone, never to a
// Vercel project. A missing token fails the step: the check runs on every UAT deploy, so it never
// skips. The account comes from the file store's endpoint, so the buckets checked are the ones the
// api and the fonts fetch use. It prints bucket names and domains only, never the token.
// Exit 0: both private; 1: a bucket is public, or Cloudflare's answer could not be read; 2: a missing input.

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const TOKEN = "CLOUDFLARE_R2_READ_TOKEN";
/** The values `cf-r2-jurisdiction` takes besides `default` (Cloudflare's API reference for these endpoints). */
const JURISDICTIONS = ["eu", "us", "fedramp", "fedramp-high"] as const;
/** R2's S3 address: `<ACCOUNT_ID>.r2.cloudflarestorage.com`, or `<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com` (R2 docs, "Data location"). */
const R2_S3_HOST = /^([0-9a-f]{32})(?:\.([a-z-]+))?\.r2\.cloudflarestorage\.com$/;
/** How much of Cloudflare's error text a failure line keeps. */
const MAX_ERROR_TEXT = 300;

export interface R2Bucket {
  /** What the bucket holds, for the failure line: "files" or "fonts". */
  readonly label: string;
  readonly name: string;
}

export interface R2PrivateOptions {
  readonly accountId: string;
  readonly token: string;
  readonly buckets: readonly R2Bucket[];
  /** The buckets' jurisdiction, when not the default one. */
  readonly jurisdiction?: (typeof JURISDICTIONS)[number];
  readonly fetch?: typeof fetch;
}

/** The check's inputs from the deploy step's environment, or the first one missing. Blank counts as unset. */
export function r2PrivateFromEnv(env: NodeJS.ProcessEnv): { options: Omit<R2PrivateOptions, "fetch"> } | { error: string } {
  const token = env[TOKEN];
  if (!token) return { error: `${TOKEN} is not set: add the read-only R2 token (Workers R2 Storage Read) to GitHub environment uat (docs/tech-stack.md). The check never skips.` };
  for (const name of ["FILE_STORE_ENDPOINT", "PROJECT_FILES_BUCKET", "BUILD_ASSETS_BUCKET"]) {
    if (!env[name]) return { error: `${name} is not set: the uat environment's variable, as the deploy's other steps read it` };
  }
  const endpoint = env.FILE_STORE_ENDPOINT!;
  const host = URL.canParse(endpoint) && new URL(endpoint).protocol === "https:" ? R2_S3_HOST.exec(new URL(endpoint).hostname) : null;
  const jurisdiction = host?.[2];
  if (!host || (jurisdiction !== undefined && !(JURISDICTIONS as readonly string[]).includes(jurisdiction))) {
    return { error: "FILE_STORE_ENDPOINT is not R2's S3 address (https://<account id>[.<jurisdiction>].r2.cloudflarestorage.com), so the account is unknown" };
  }
  const buckets = [
    { label: "files", name: env.PROJECT_FILES_BUCKET! },
    { label: "fonts", name: env.BUILD_ASSETS_BUCKET! },
  ];
  return { options: { accountId: host[1]!, token, buckets, ...(jurisdiction ? { jurisdiction: jurisdiction as R2PrivateOptions["jurisdiction"] } : {}) } };
}

/** Cloudflare's v4 envelope. */
interface Envelope {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: unknown;
}

/** Asks Cloudflare's API for each bucket's r2.dev URL and custom domains; returns what is public or could not be read. */
export async function r2PrivateCheck({ accountId, token, buckets, jurisdiction, fetch: get = fetch }: R2PrivateOptions): Promise<string[]> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : {}) };
  const failures: string[] = [];
  for (const { label, name } of buckets) {
    const who = `the ${label} bucket ${name}`;
    const base = `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(name)}`;
    const read = async (path: string): Promise<unknown> => {
      const answer = await ask(get, `${base}/${path}`, headers, path);
      if ("failure" in answer) failures.push(`${who}: ${answer.failure}`);
      return "result" in answer ? answer.result : undefined;
    };
    const unclear = (path: string) => failures.push(`${who}: Cloudflare's answer to GET ${path} does not say whether it is public`);

    const dev = await read("domains/managed");
    if (dev !== undefined) {
      if (!isManaged(dev)) unclear("domains/managed");
      else if (dev.enabled) failures.push(`${who} is public at its r2.dev URL ${dev.domain}: turn it off (R2 > ${name} > Settings > Public Development URL > Disable)`);
    }
    const custom = await read("domains/custom");
    if (custom !== undefined) {
      if (!isCustomList(custom)) unclear("domains/custom");
      else for (const d of custom.domains.filter((d) => d.enabled)) failures.push(`${who} is public at its custom domain ${d.domain}: disable or remove it (R2 > ${name} > Settings > Custom Domains)`);
    }
  }
  return token ? failures.map((f) => f.replaceAll(token, "***")) : failures;
}

/** One GET of Cloudflare's API: its `result`, or why there is none. Never throws. */
async function ask(get: typeof fetch, url: string, headers: Record<string, string>, what: string): Promise<{ result: unknown } | { failure: string }> {
  let res: Response;
  try {
    res = await get(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { failure: `Cloudflare's API could not be reached for GET ${what} (${(error as Error).message})` };
  }
  const body = (await res.json().catch(() => undefined)) as Envelope | undefined;
  if (res.ok && body?.success === true) return { result: body.result };
  const errors = (body?.errors ?? []).map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim()).join("; ").slice(0, MAX_ERROR_TEXT);
  // A token Cloudflare does not know answers 400 (9106), one without the permission 401 or 403.
  const hint = [400, 401, 403].includes(res.status) ? `; is ${TOKEN} a Workers R2 Storage Read token for this account?` : "";
  return { failure: `Cloudflare answered ${res.status} to GET ${what}${errors ? ` (${errors})` : ""}${hint}` };
}

function isManaged(value: unknown): value is { domain: string; enabled: boolean } {
  const v = value as { domain?: unknown; enabled?: unknown } | null;
  return typeof v?.enabled === "boolean" && typeof v.domain === "string";
}

function isCustomList(value: unknown): value is { domains: { domain: string; enabled: boolean }[] } {
  const domains = (value as { domains?: unknown } | null)?.domains;
  return Array.isArray(domains) && domains.every((d) => typeof d?.enabled === "boolean" && typeof d.domain === "string");
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const run = r2PrivateFromEnv(process.env);
  if ("error" in run) {
    console.error(`R2 buckets stay private: ${run.error}`);
    process.exit(2);
  }
  const failures = await r2PrivateCheck(run.options);
  const names = run.options.buckets.map((b) => `${b.label} (${b.name})`).join(" and ");
  if (failures.length > 0) {
    console.error(`R2 buckets stay private: failed\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`R2 buckets stay private: ${names} have no r2.dev URL and no custom domain on`);
}
