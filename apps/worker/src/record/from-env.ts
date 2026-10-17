import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { filesUnder, projectFilesFromEnv, s3Client, s3RecordFiles } from "./files.ts";
import { fallbackFonts, thmanyahFonts, type RecordFonts } from "./fonts.ts";
import type { RecordJobDeps } from "./job.ts";
import { chromiumRenderer } from "./render.ts";
import { pemToDer } from "./pki.ts";
import { kmsSealSigner, localSealSigner, type SealSigner } from "./signer.ts";
import { localTimestampAuthority, rfc3161TimestampAuthority, type TimestampAuthority } from "./timestamp.ts";

// The record job as the environment sets it up. In AWS (no FILE_STORE_ENDPOINT)
// every adapter is the real one, and a missing setting fails the job (retried,
// shown in the outbox) rather than sealing with a test key: the KMS key
// `pdf-sealing` (PDF_SEALING_KEY_ID) under Rabaed's certificate, kept beside
// the fonts in the build assets bucket (BUILD_ASSETS_BUCKET, `sealing/`); a
// public RFC 3161 service (TIMESTAMP_AUTHORITY_URL); the Thmanyah fonts from
// `fonts/thmanyah/`. Locally and in CI: a fresh in-memory test key, the
// timestamp stand-in and the free fallback font, so nothing calls AWS.

/** Where Rabaed's sealing certificate (PEM, its chain after it) is kept in the build assets bucket. */
export const SEALING_CERTIFICATE_KEY = "sealing/pdf-sealing.pem";
/** Where the licensed Thmanyah fonts are kept in the build assets bucket (packages/infra FONTS_PREFIX). */
export const THMANYAH_PREFIX = "fonts/thmanyah/";

const env = z.object({
  FILE_STORE_ENDPOINT: z.url().optional(),
  AWS_REGION: z.string().min(1).optional(),
  BUILD_ASSETS_BUCKET: z.string().min(3).optional(),
  PDF_SEALING_KEY_ID: z.string().min(1).optional(),
  TIMESTAMP_AUTHORITY_URL: z.url().optional(),
  CHROMIUM_PATH: z.string().min(1).optional(),
});

/** Every PEM certificate in `pem`, in order, as DER. */
function certificatesOf(pem: string): Uint8Array[] {
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) => pemToDer(m[0]));
}

/** Memoised: made at the first record, and made again after a failure. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () =>
    (made ??= make().catch((error: unknown) => {
      made = undefined;
      throw error;
    }));
}

export function recordJobFromEnv(webUrl: string, source: NodeJS.ProcessEnv = process.env): RecordJobDeps & { close(): Promise<void> } {
  const settings = env.parse(source);
  const local = settings.FILE_STORE_ENDPOINT !== undefined;
  const renderer = chromiumRenderer(settings.CHROMIUM_PATH ? { executablePath: settings.CHROMIUM_PATH } : {});
  const assets = () => {
    if (!settings.BUILD_ASSETS_BUCKET || !settings.AWS_REGION) throw new Error("BUILD_ASSETS_BUCKET and AWS_REGION are not set");
    return { bucket: settings.BUILD_ASSETS_BUCKET, client: s3Client({ bucket: settings.BUILD_ASSETS_BUCKET, region: settings.AWS_REGION }) };
  };

  const signer = once<SealSigner>(async () => {
    if (local) return localSealSigner();
    if (!settings.PDF_SEALING_KEY_ID || !settings.AWS_REGION) throw new Error("PDF_SEALING_KEY_ID is not set");
    const { bucket, client } = assets();
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: SEALING_CERTIFICATE_KEY }));
    const certificates = certificatesOf((await got.Body?.transformToString()) ?? "");
    if (certificates.length === 0) throw new Error("the sealing certificate is missing from the build assets bucket");
    return kmsSealSigner({ keyId: settings.PDF_SEALING_KEY_ID, region: settings.AWS_REGION, certificates });
  });
  const timestamps = once<TimestampAuthority>(async () => {
    if (local) return localTimestampAuthority();
    if (!settings.TIMESTAMP_AUTHORITY_URL) throw new Error("TIMESTAMP_AUTHORITY_URL is not set");
    return rfc3161TimestampAuthority(settings.TIMESTAMP_AUTHORITY_URL);
  });
  const fonts = once<RecordFonts>(async () => {
    if (local || !settings.BUILD_ASSETS_BUCKET) return fallbackFonts();
    const { bucket, client } = assets();
    return thmanyahFonts(await filesUnder(client, bucket, THMANYAH_PREFIX));
  });

  return { files: s3RecordFiles(projectFilesFromEnv(source)), renderer, signer, timestamps, fonts, webUrl, close: () => renderer.close() };
}
