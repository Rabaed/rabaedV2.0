import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { filesUnder, projectFilesFromEnv, s3Client, s3RecordFiles } from "./files.ts";
import { fallbackFonts, thmanyahFonts, type RecordFonts } from "./fonts.ts";
import type { RecordJobDeps } from "./job.ts";
import { chromiumRenderer } from "./render.ts";
import { pemToDer } from "./pki.ts";
import { kmsSealSigner, localSealSigner, type SealSigner } from "./signer.ts";
import { localTimestampAuthority, rfc3161TimestampAuthority, type TimestampAuthority } from "./timestamp.ts";

// The record job as the environment sets it up. RECORD_SEALING names the seal's
// adapters explicitly, never inferred:
// - `kms` (AWS; the app stack sets it): the KMS key `pdf-sealing`
//   (PDF_SEALING_KEY_ID) under Rabaed's certificate, kept beside the fonts in the
//   build assets bucket (BUILD_ASSETS_BUCKET, `sealing/`), a public RFC 3161
//   service (TIMESTAMP_AUTHORITY_URL) and the Thmanyah fonts from
//   `fonts/thmanyah/`. A missing setting fails the job (retried, shown in the outbox).
// - `local` (development and CI): a fresh in-memory test key, the timestamp
//   stand-in and the free fallback font, so nothing calls AWS. Refused outright
//   on ECS (the worker does not start), so AWS never seals with a test key.
//   RECORD_FONTS_DIR (the UAT Records image, ADR 0026) names a folder of
//   Thmanyah files baked in at build time from the private R2 bucket; unset or
//   empty, the fallback font.
// Unset, the worker starts but every record job fails, saying so.

/** Where Rabaed's sealing certificate (PEM, its chain after it) is kept in the build assets bucket. */
export const SEALING_CERTIFICATE_KEY = "sealing/pdf-sealing.pem";
/** Where the licensed Thmanyah fonts are kept in the build assets bucket (packages/infra FONTS_PREFIX). */
export const THMANYAH_PREFIX = "fonts/thmanyah/";

const env = z.object({
  RECORD_SEALING: z.enum(["local", "kms"]).optional(),
  // Set by ECS in every task: the worker runs in AWS.
  ECS_CONTAINER_METADATA_URI_V4: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  BUILD_ASSETS_BUCKET: z.string().min(3).optional(),
  PDF_SEALING_KEY_ID: z.string().min(1).optional(),
  TIMESTAMP_AUTHORITY_URL: z.url().optional(),
  CHROMIUM_PATH: z.string().min(1).optional(),
  RECORD_FONTS_DIR: z.string().min(1).optional(),
});

/** Every file in dir by name (thmanyahFonts keeps the Thmanyah ones), or none when it isn't there. */
function filesIn(dir: string): Map<string, Uint8Array> {
  if (!existsSync(dir)) return new Map();
  return new Map(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, readFileSync(join(dir, e.name))]));
}

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

/** The seal's adapters and the fonts, as RECORD_SEALING names them (see above). Throws when it is `local` on ECS. */
export function recordSealingFromEnv(source: NodeJS.ProcessEnv = process.env): Pick<RecordJobDeps, "signer" | "timestamps" | "fonts"> {
  const settings = env.parse(source);
  const mode = settings.RECORD_SEALING;
  if (mode === "local" && settings.ECS_CONTAINER_METADATA_URI_V4) {
    throw new Error("RECORD_SEALING=local on ECS: Documental Records are never sealed with the local test key in AWS");
  }
  const unset = () => new Error("RECORD_SEALING is not set (local or kms)");
  const assets = () => {
    if (!settings.BUILD_ASSETS_BUCKET || !settings.AWS_REGION) throw new Error("BUILD_ASSETS_BUCKET and AWS_REGION are not set");
    return { bucket: settings.BUILD_ASSETS_BUCKET, client: s3Client({ bucket: settings.BUILD_ASSETS_BUCKET, region: settings.AWS_REGION }) };
  };

  const signer = once<SealSigner>(async () => {
    if (mode === "local") return localSealSigner();
    if (mode !== "kms") throw unset();
    if (!settings.PDF_SEALING_KEY_ID || !settings.AWS_REGION) throw new Error("PDF_SEALING_KEY_ID is not set");
    const { bucket, client } = assets();
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: SEALING_CERTIFICATE_KEY }));
    const certificates = certificatesOf((await got.Body?.transformToString()) ?? "");
    if (certificates.length === 0) throw new Error("the sealing certificate is missing from the build assets bucket");
    return kmsSealSigner({ keyId: settings.PDF_SEALING_KEY_ID, region: settings.AWS_REGION, certificates });
  });
  const timestamps = once<TimestampAuthority>(async () => {
    if (mode === "local") return localTimestampAuthority();
    if (mode !== "kms") throw unset();
    if (!settings.TIMESTAMP_AUTHORITY_URL) throw new Error("TIMESTAMP_AUTHORITY_URL is not set");
    return rfc3161TimestampAuthority(settings.TIMESTAMP_AUTHORITY_URL);
  });
  const fonts = once<RecordFonts>(async () => {
    if (mode === "local") return settings.RECORD_FONTS_DIR ? thmanyahFonts(filesIn(settings.RECORD_FONTS_DIR)) : fallbackFonts();
    if (mode !== "kms") throw unset();
    const { bucket, client } = assets();
    return thmanyahFonts(await filesUnder(client, bucket, THMANYAH_PREFIX));
  });
  return { signer, timestamps, fonts };
}

export function recordJobFromEnv(webUrl: string, source: NodeJS.ProcessEnv = process.env): RecordJobDeps & { close(): Promise<void> } {
  const sealing = recordSealingFromEnv(source);
  const { CHROMIUM_PATH } = env.parse(source);
  const renderer = chromiumRenderer(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {});
  return { files: s3RecordFiles(projectFilesFromEnv(source)), renderer, ...sealing, webUrl, close: () => renderer.close() };
}