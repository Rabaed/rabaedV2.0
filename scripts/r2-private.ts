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
/** The name of the variable holding the token (never the token itself). */
const TOKEN_VAR = "CLOUDFLARE_R2_READ_TOKEN";
/** The values `cf-r2-jurisdiction` takes besides `default` (Cloudflare's API reference for these endpoints). */
const JURISDICTIONS = ["eu", "us", "fedramp", "fedramp-high"] as const;
type Jurisdiction = (typeof JURISDICTIONS)[number];
const isJurisdiction = (value: string): value is Jurisdiction => (JURISDICTIONS as readonly string[]).includes(value);
/** R2's S3 address: `<ACCOUNT_ID>.r2.cloudflarestorage.com`, or `<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com` (R2 docs, "Data location"). */
const R2_S3_HOST = /^([0-9a-f]{32})(?:\.([a-z-]+))?\.r2\.cloudflarestorage\.com$/;
/** How much of Cloudflare's error text a failure line keeps. */
const MAX_ERROR_TEXT = 300;

export interface R2Bucket {
  /** What the bucket holds, for the failure line. */
  readonly label: "files" | "fonts";
  readonly name: string;
}

export interface R2PrivateOptions {
  readonly accountId: string;
  readonly token: string;
  readonly buckets: readonly R2Bucket[];
  /** The buckets' jurisdiction, when not the default one. */
  readonly jurisdiction?: Jurisdiction;
  readonly fetch?: typeof fetch;
}

/** One public address of a bucket as Cloudflare reports it: its r2.dev URL or a custom domain, and whether it serves the bucket. */
interface R2Domain {
  domain: string;
  enabled: boolean;
}

/** The check's inputs from the deploy step's environment, or the first one missing. Blank counts as unset. */
export function r2PrivateFromEnv(env: NodeJS.ProcessEnv): { options: Omit<R2PrivateOptions, "fetch"> } | { error: string } {
  const { [TOKEN_VAR]: token, FILE_STORE_ENDPOINT: endpoint, PROJECT_FILES_BUCKET: files, BUILD_ASSETS_BUCKET: fonts } = env;
  if (!token) return { error: `${TOKEN_VAR} is not set: add the read-only R2 token (Workers R2 Storage Read) to GitHub environment uat (docs/tech-stack.md). The check never skips.` };
  const unset = (name: string) => ({ error: `${name} is not set: the uat environment's variable, as the deploy's other steps read it` });
  if (!endpoint) return unset("FILE_STORE_ENDPOINT");
  if (!files) return unset("PROJECT_FILES_BUCKET");
  if (!fonts) return unset("BUILD_ASSETS_BUCKET");
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  const [, accountId, jurisdiction] = (url?.protocol === "https:" && R2_S3_HOST.exec(url.hostname)) || [];
  if (!accountId || (jurisdiction !== undefined && !isJurisdiction(jurisdiction))) {
    return { error: "FILE_STORE_ENDPOINT is not R2's S3 address (https://<account id>[.<jurisdiction>].r2.cloudflarestorage.com), so the account is unknown" };
  }
  const buckets: R2Bucket[] = [
    { label: "files", name: files },
    { label: "fonts", name: fonts },
  ];
  return { options: { accountId, token, buckets, ...(jurisdiction ? { jurisdiction } : {}) } };
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
    const bucketUrl = `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(name)}`;
    // Every path ends in a failure or a judged result: a result missing or of another shape is unclear, never a pass.
    const read = async (path: string): Promise<{ result: unknown } | null> => {
      const answer = await ask(get, bucketUrl, path, headers);
      if ("failure" in answer) failures.push(`${who}: ${answer.failure}`);
      return "failure" in answer ? null : answer;
    };
    const unclear = (path: string) => failures.push(`${who}: Cloudflare's answer to GET ${path} does not say whether it is public`);

    const r2Dev = await read("domains/managed");
    if (r2Dev) {
      if (!isR2Domain(r2Dev.result)) unclear("domains/managed");
      else if (r2Dev.result.enabled) failures.push(`${who} is public at its r2.dev URL ${r2Dev.result.domain}: turn it off (R2 > ${name} > Settings > Public Development URL > Disable)`);
    }
    const custom = await read("domains/custom");
    if (custom) {
      if (!isR2DomainList(custom.result)) unclear("domains/custom");
      else for (const d of custom.result.domains.filter((d) => d.enabled)) failures.push(`${who} is public at its custom domain ${d.domain}: disable or remove it (R2 > ${name} > Settings > Custom Domains)`);
    }
  }
  return token ? failures.map((f) => f.replaceAll(token, "***")) : failures;
}

/** One GET of `path` under a bucket in Cloudflare's API: its `result`, or why there is none. Never throws. */
async function ask(get: typeof fetch, bucketUrl: string, path: string, headers: Record<string, string>): Promise<{ result: unknown } | { failure: string }> {
  let res: Response;
  try {
    res = await get(`${bucketUrl}/${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { failure: `Cloudflare's API could not be reached for GET ${path} (${(error as Error).message})` };
  }
  const body = (await res.json().catch(() => undefined)) as Envelope | undefined;
  if (res.ok && body?.success === true) return { result: body.result };
  const errors = (body?.errors ?? []).map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim()).join("; ").slice(0, MAX_ERROR_TEXT);
  // A token Cloudflare does not know answers 400 (9106), one without the permission 401 or 403.
  const hint = [400, 401, 403].includes(res.status) ? `; is ${TOKEN_VAR} a Workers R2 Storage Read token for this account?` : "";
  return { failure: `Cloudflare answered ${res.status} to GET ${path}${errors ? ` (${errors})` : ""}${hint}` };
}

function isR2Domain(value: unknown): value is R2Domain {
  const v = value as { domain?: unknown; enabled?: unknown } | null;
  return typeof v?.enabled === "boolean" && typeof v.domain === "string";
}

function isR2DomainList(value: unknown): value is { domains: R2Domain[] } {
  const domains = (value as { domains?: unknown } | null)?.domains;
  return Array.isArray(domains) && domains.every(isR2Domain);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const run = r2PrivateFromEnv(process.env);
  if ("error" in run) {
    console.error(`R2 buckets stay private: ${run.error}`);
    process.exit(2);
  }
  const failures = await r2PrivateCheck(run.options);
  if (failures.length > 0) {
    console.error(`R2 buckets stay private: failed\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  const names = run.options.buckets.map((b) => `${b.label} (${b.name})`).join(" and ");
  console.log(`R2 buckets stay private: ${names} have no r2.dev URL and no custom domain on`);
}
