import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutBucketCorsCommand,
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SignedUrl } from "@rabaed/domain";
import { z } from "zod";

// Where Documents' files live: object storage that only the api signs URLs for
// (ADR 0007; RP-210). In AWS it is the Project files bucket, reached with the
// api task role. Locally and in CI it is an S3-compatible store in Docker
// (RustFS, docker-compose.yml), so no run ever calls AWS.

/** How long a signed URL works. S3 refuses a Project files URL older than 15 minutes anyway. */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

export interface FileStore {
  /**
   * A URL the browser PUTs the file to, with exactly `headers`: the signature
   * covers the content type and length, so the store refuses any other file.
   * Signed at `signedAt` (the api's clock).
   */
  signUpload(key: string, file: { contentType: string; sizeBytes: number }, signedAt: Date): Promise<SignedUrl & { headers: Record<string, string> }>;
  /** A URL that downloads the file as `fileName`. */
  signDownload(key: string, file: { fileName: string; contentType: string }, signedAt: Date): Promise<SignedUrl>;
  /** The stored file's size and type, or null when nothing is stored under `key`. */
  stat(key: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  /** The stored file's bytes (a photo's, to read its EXIF), or null when nothing is stored under `key`. */
  read(key: string): Promise<Uint8Array | null>;
}

export interface FileStoreSettings {
  bucket: string;
  /** Local and CI only: the S3-compatible store's address. Unset in AWS. */
  endpoint?: string;
  region: string;
  /** Local and CI only, with `endpoint`: never the default AWS credential chain. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * The file store the environment sets up. In AWS the api task gets
 * PROJECT_FILES_BUCKET and its region; locally and in CI also
 * FILE_STORE_ENDPOINT with the local store's placeholder keys (.env.example,
 * ci.yml). A local endpoint never takes AWS credentials from the machine.
 */
export function fileStoreSettingsFromEnv(source: NodeJS.ProcessEnv = process.env): FileStoreSettings {
  const env = z
    .object({
      PROJECT_FILES_BUCKET: z.string().min(3),
      FILE_STORE_ENDPOINT: z.url().optional(),
      FILE_STORE_ACCESS_KEY_ID: z.string().min(1).optional(),
      FILE_STORE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
      AWS_REGION: z.string().min(1).optional(),
    })
    .parse(source);
  if (!env.FILE_STORE_ENDPOINT) {
    if (!env.AWS_REGION) throw new Error("No file store: set FILE_STORE_ENDPOINT (local, CI) or run in AWS (AWS_REGION)");
    return { bucket: env.PROJECT_FILES_BUCKET, region: env.AWS_REGION };
  }
  if (!env.FILE_STORE_ACCESS_KEY_ID || !env.FILE_STORE_SECRET_ACCESS_KEY) {
    throw new Error("FILE_STORE_ENDPOINT needs FILE_STORE_ACCESS_KEY_ID and FILE_STORE_SECRET_ACCESS_KEY (the local store's)");
  }
  return {
    bucket: env.PROJECT_FILES_BUCKET,
    endpoint: env.FILE_STORE_ENDPOINT,
    region: env.AWS_REGION ?? "us-east-1",
    credentials: { accessKeyId: env.FILE_STORE_ACCESS_KEY_ID, secretAccessKey: env.FILE_STORE_SECRET_ACCESS_KEY },
  };
}

function clientFor(settings: FileStoreSettings): S3Client {
  return new S3Client({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true, credentials: settings.credentials } : {}),
  });
}

/** `inline` for what browsers show safely (PDFs, images), `attachment` for the rest; RFC 6266 file name. */
export function contentDisposition(fileName: string, contentType: string): string {
  const kind = contentType === "application/pdf" || /^image\/(jpeg|png|webp)$/.test(contentType) ? "inline" : "attachment";
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createFileStore(settings: FileStoreSettings): FileStore {
  const s3 = clientFor(settings);
  const expiresAt = (signedAt: Date) => new Date(signedAt.getTime() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return {
    async signUpload(key, file, signedAt) {
      const command = new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        ContentType: file.contentType,
        ContentLength: file.sizeBytes,
      });
      const url = await getSignedUrl(s3, command, {
        expiresIn: SIGNED_URL_TTL_SECONDS,
        signingDate: signedAt,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      // Browsers set Content-Length themselves, from the body.
      return { url, expiresAt: expiresAt(signedAt), headers: { "content-type": file.contentType } };
    },

    async signDownload(key, file, signedAt) {
      const command = new GetObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        ResponseContentType: file.contentType,
        ResponseContentDisposition: contentDisposition(file.fileName, file.contentType),
      });
      const url = await getSignedUrl(s3, command, { expiresIn: SIGNED_URL_TTL_SECONDS, signingDate: signedAt });
      return { url, expiresAt: expiresAt(signedAt) };
    },

    async stat(key) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
        return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
      } catch (error) {
        if (error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw error;
      }
    },

    async read(key) {
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
        return (await object.Body?.transformToByteArray()) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw error;
      }
    },
  };
}

/**
 * Local and CI only: creates the bucket if it isn't there, and lets browsers
 * upload to it from any origin (the local web runs on a lane's own host). In
 * AWS the storage stack owns the bucket and its CORS rules.
 */
export async function ensureLocalBucket(settings: FileStoreSettings): Promise<void> {
  if (!settings.endpoint) throw new Error("ensureLocalBucket is for the local store only");
  const s3 = clientFor(settings);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: settings.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: settings.bucket }));
  }
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: settings.bucket,
      CORSConfiguration: {
        CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 600 }],
      },
    }),
  );
}

/** Stands in where no store is configured (the demo seed); any use is a bug. */
export const noFileStore: FileStore = {
  signUpload: () => Promise.reject(new Error("No file store configured")),
  signDownload: () => Promise.reject(new Error("No file store configured")),
  stat: () => Promise.reject(new Error("No file store configured")),
  read: () => Promise.reject(new Error("No file store configured")),
};
