import { optionalSecret } from "@rabaed/domain";
import { z } from "zod";

// The S3-compatible object stores from the environment, read one way for the
// api (apps/api documents/file-store.ts), the worker (apps/worker
// record/files.ts) and the fonts fetch (apps/api build-assets). In AWS a task
// role reaches the bucket; locally and in CI the store in Docker, on the UAT
// Cloudflare R2 (ADR 0026), each at FILE_STORE_ENDPOINT with a key of its own.
// It lives here because both apps depend on @rabaed/db; it builds no S3 client,
// so this package needs no S3 SDK.

export interface ObjectStoreSettings {
  readonly bucket: string;
  readonly region: string;
  /** Local, CI and R2 only: the S3-compatible store's address. Unset in AWS. */
  readonly endpoint?: string;
  /** With `endpoint` only: never the default AWS credential chain. */
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** The environment variables naming a bucket and the key it is reached with. */
export interface ObjectStoreEnvNames {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** The Project files bucket and the app's key (Object Read & Write on R2). */
export const PROJECT_FILES_ENV: ObjectStoreEnvNames = {
  bucket: "PROJECT_FILES_BUCKET",
  accessKeyId: "FILE_STORE_ACCESS_KEY_ID",
  secretAccessKey: "FILE_STORE_SECRET_ACCESS_KEY",
};

/**
 * The bucket `names` gives, at FILE_STORE_ENDPOINT with the key `names` gives;
 * with no endpoint, in AWS_REGION through the task role. Only the named key is
 * read, so a store reached with another key never falls back to the app's.
 */
export function objectStoreFromEnv(source: NodeJS.ProcessEnv = process.env, names: ObjectStoreEnvNames = PROJECT_FILES_ENV): ObjectStoreSettings {
  const env = z
    .object({
      bucket: z.string().min(3),
      endpoint: z.url().optional(),
      accessKeyId: optionalSecret,
      secretAccessKey: optionalSecret,
      region: optionalSecret,
      awsRegion: optionalSecret,
    })
    .parse({
      bucket: source[names.bucket],
      endpoint: source.FILE_STORE_ENDPOINT,
      accessKeyId: source[names.accessKeyId],
      secretAccessKey: source[names.secretAccessKey],
      region: source.FILE_STORE_REGION,
      awsRegion: source.AWS_REGION,
    });
  if (!env.endpoint) {
    if (!env.awsRegion) throw new Error("No file store: set FILE_STORE_ENDPOINT (local, CI) or run in AWS (AWS_REGION)");
    return { bucket: env.bucket, region: env.awsRegion };
  }
  if (!env.accessKeyId || !env.secretAccessKey) {
    throw new Error(`FILE_STORE_ENDPOINT needs ${names.accessKeyId} and ${names.secretAccessKey}`);
  }
  return {
    bucket: env.bucket,
    endpoint: env.endpoint,
    // R2 signs with `auto` (FILE_STORE_REGION in the uat environment); the local store takes any.
    // Never AWS_REGION here: Vercel sets it to its own region, which R2 would not sign for.
    region: env.region ?? "us-east-1",
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  };
}

/**
 * The S3 client's options for `settings` (`new S3Client(objectStoreClientConfig(s))`).
 * Checksums only where an operation requires one: by default the SDK adds
 * `x-amz-checksum-mode` to a signed GET and would have a PutObject carry a CRC
 * the browser never computes. Cloudflare R2 implements CRC-32 only as a
 * composite checksum and CRC-64/NVME only as a full-object one, and treats
 * `us-east-1` or an empty region as `auto`
 * (https://developers.cloudflare.com/r2/api/s3/api/, "Checksum types" and
 * "Bucket region"); its presigned uploads sign Content-Type and the browser
 * sends exactly that (https://developers.cloudflare.com/r2/api/s3/presigned-urls/).
 */
export function objectStoreClientConfig(settings: ObjectStoreSettings) {
  return {
    region: settings.region,
    requestChecksumCalculation: "WHEN_REQUIRED" as const,
    responseChecksumValidation: "WHEN_REQUIRED" as const,
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true, credentials: settings.credentials } : {}),
  };
}
