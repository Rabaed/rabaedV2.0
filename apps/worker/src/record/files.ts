import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

// Where the worker keeps a record's files: the Project files bucket, under the
// item's own prefix (ADR 0007), the same store the api signs Document links for
// (apps/api/src/documents/file-store.ts). In AWS the worker's task role may read
// Documents and write records there (packages/infra app stack); locally and in
// CI it is the S3-compatible store in Docker, so no run calls AWS.

export interface RecordFiles {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The file's bytes, or null when nothing is stored under `key`. */
  get(key: string): Promise<Uint8Array | null>;
}

export interface S3Settings {
  readonly bucket: string;
  readonly region: string;
  /** Local and CI only: the S3-compatible store's address and its placeholder keys. */
  readonly endpoint?: string;
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function s3Client(settings: S3Settings): S3Client {
  return new S3Client({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true, credentials: settings.credentials } : {}),
  });
}

/** The Project files bucket from the environment: PROJECT_FILES_BUCKET, and FILE_STORE_* locally. */
export function projectFilesFromEnv(source: NodeJS.ProcessEnv = process.env): S3Settings {
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

const notFound = (error: unknown) =>
  error instanceof NoSuchKey || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

export function s3RecordFiles(settings: S3Settings, client = s3Client(settings)): RecordFiles {
  return {
    async put(key, bytes, contentType) {
      await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length }));
    },
    async get(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
        return (await object.Body?.transformToByteArray()) ?? null;
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
  };
}

/** Every file under `prefix` of `bucket` (the fonts), by its name after the prefix. */
export async function filesUnder(client: S3Client, bucket: string, prefix: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  for (const object of listed.Contents ?? []) {
    if (!object.Key || object.Key.endsWith("/")) continue;
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
    const bytes = await got.Body?.transformToByteArray();
    if (bytes) out.set(object.Key.slice(prefix.length), bytes);
  }
  return out;
}

/** Where an item's record lives: one location, name and URL for good (ADR 0023). */
export function recordKeys(projectId: string, workItemId: string): { pdf: string; recordData: string } {
  const base = `projects/${projectId}/work-items/${workItemId}/documental-record`;
  return { pdf: `${base}/record.pdf`, recordData: `${base}/record-data.xml` };
}
