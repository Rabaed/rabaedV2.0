import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule, type S3Client } from "@aws-sdk/client-s3";
import { objectStoreFromEnv, type ObjectStoreEnvNames, type ObjectStoreSettings } from "@rabaed/db";
import { isLocalFileStore } from "./file-store.ts";

// The UAT files bucket's CORS on Cloudflare R2 (ADR 0026, RP-1041): browsers
// PUT a Document to a URL the api signed and GET it back, from the UAT web
// origin only. The rules match the AWS storage stack's
// (packages/infra/src/storage-stack.ts) but name one origin, never `*`. The
// owner sets them once in the Cloudflare dashboard; cli/r2-cors.ts is an
// optional way to do it, with an R2 admin key of its own. The app's key
// (FILE_STORE_ACCESS_KEY_ID) is Object Read & Write only, and the api itself
// never touches R2's bucket or CORS (ensureLocalBucket is local only).

/** The R2 admin key's names: given to whoever runs cli/r2-cors.ts, never to an app or a Vercel project. */
const R2_ADMIN_ENV: ObjectStoreEnvNames = {
  bucket: "PROJECT_FILES_BUCKET",
  accessKeyId: "R2_ADMIN_ACCESS_KEY_ID",
  secretAccessKey: "R2_ADMIN_SECRET_ACCESS_KEY",
};

/** The UAT files bucket on R2 with the R2 admin key; throws when only the app's key is given, or the store isn't R2. */
export function r2AdminFromEnv(source: NodeJS.ProcessEnv = process.env): ObjectStoreSettings {
  const settings = objectStoreFromEnv(source, R2_ADMIN_ENV);
  if (!settings.endpoint || isLocalFileStore(settings)) {
    throw new Error("FILE_STORE_ENDPOINT must be R2's S3 address (the uat environment's), not AWS or the local store");
  }
  return settings;
}

/** `origin` exactly as a browser sends it (`https://host`), else throws naming the rule. */
function webOrigin(origin: string): string {
  const given = origin.trim().replace(/\/$/, "").toLowerCase();
  const refuse = (why: string): never => {
    throw new Error(`The UAT web origin must be one https origin (https://host), ${why}; got ${JSON.stringify(origin)}`);
  };
  if (given === "") refuse("not empty");
  if (given.includes("*")) refuse("never a wildcard");
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return refuse("a URL");
  }
  if (url.protocol !== "https:") refuse("over https");
  if (url.origin !== given) refuse("with no path, query, credentials or second origin");
  return url.origin;
}

/** The files bucket's CORS rules for UAT: the one web origin may PUT and GET with its content type. */
export function uatCorsRules(origin: string): CORSRule[] {
  return [{ AllowedOrigins: [webOrigin(origin)], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 600 }];
}

/** Replaces `bucket`'s CORS with uatCorsRules(origin) and returns what the store reads back; throws if it differs. */
export async function applyUatCors(client: S3Client, bucket: string, origin: string): Promise<CORSRule[]> {
  const rules = uatCorsRules(origin);
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }));
  const read = (await client.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
  const comparable = (r: CORSRule) => ({
    origins: r.AllowedOrigins ?? [],
    methods: [...(r.AllowedMethods ?? [])].sort(),
    headers: (r.AllowedHeaders ?? []).map((h) => h.toLowerCase()),
    maxAge: r.MaxAgeSeconds,
  });
  if (JSON.stringify(read.map(comparable)) !== JSON.stringify(rules.map(comparable))) {
    throw new Error(`The bucket's CORS read back differs from what was set: ${JSON.stringify(read)}`);
  }
  return read;
}
