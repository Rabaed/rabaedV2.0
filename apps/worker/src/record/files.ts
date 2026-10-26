import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { objectStoreClientConfig, objectStoreFromEnv, PROJECT_FILES_ENV, type ObjectStoreSettings } from "@rabaed/db";

// Where the worker keeps a record's files: the Project files bucket, under the
// item's own prefix (ADR 0007), the same store the api signs Document links for
// (apps/api/src/documents/file-store.ts). In AWS the worker's task role may read
// Documents and write records there (packages/infra app stack); locally and in
// CI it is the S3-compatible store in Docker, so no run calls AWS.

export interface RecordFiles {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The file's bytes, or null when nothing is stored under `key`. */
  get(key: string): Promise<Uint8Array | null>;
  /** The SHA-256 (hex) of the file under `key`, read as a stream so a large file is never held whole; null when nothing is stored there. */
  sha256(key: string): Promise<string | null>;
}

/** Where a bucket is (packages/db object-store.ts). */
export type S3Settings = ObjectStoreSettings;

/** Checksums only where an operation requires one, as the api's client (packages/db `objectStoreClientConfig` says why). */
export function s3Client(settings: S3Settings): S3Client {
  return new S3Client(objectStoreClientConfig(settings));
}

/** The Project files bucket from the environment: PROJECT_FILES_BUCKET, and FILE_STORE_* locally and on the UAT. */
export function projectFilesFromEnv(source: NodeJS.ProcessEnv = process.env): S3Settings {
  return objectStoreFromEnv(source, PROJECT_FILES_ENV);
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
    async sha256(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
        const hash = createHash("sha256");
        for await (const chunk of (object.Body ?? []) as AsyncIterable<Uint8Array>) hash.update(chunk);
        return hash.digest("hex");
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

/** Where a Working Copy's PDF is kept: beside the item's record, one file for each content printed (RP-621). */
export function workingCopyKey(projectId: string, workItemId: string, workingCopyId: string): string {
  return `projects/${projectId}/work-items/${workItemId}/documental-record/working-copies/${workingCopyId}.pdf`;
}
