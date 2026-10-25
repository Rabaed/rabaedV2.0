import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule, type S3Client } from "@aws-sdk/client-s3";

// The UAT files bucket's CORS on Cloudflare R2 (ADR 0026, RP-1041): browsers
// PUT a Document to a URL the api signed and GET it back, from the UAT web
// origin only. The rules match the AWS storage stack's
// (packages/infra/src/storage-stack.ts) but name one origin, never `*`. Set
// by cli/r2-cors.ts from the UAT workflow; the api itself never touches R2's
// bucket or CORS (ensureLocalBucket is local only).

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
  const same = (r: CORSRule) => ({
    origins: r.AllowedOrigins ?? [],
    methods: [...(r.AllowedMethods ?? [])].sort(),
    headers: (r.AllowedHeaders ?? []).map((h) => h.toLowerCase()),
    maxAge: r.MaxAgeSeconds,
  });
  if (JSON.stringify(read.map(same)) !== JSON.stringify(rules.map(same))) {
    throw new Error(`The bucket's CORS read back differs from what was set: ${JSON.stringify(read)}`);
  }
  return read;
}
