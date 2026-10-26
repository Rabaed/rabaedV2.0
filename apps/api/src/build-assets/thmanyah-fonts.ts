import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { objectStoreFromEnv, type ObjectStoreEnvNames, type ObjectStoreSettings } from "@rabaed/db";

// The licensed Thmanyah Sans files for the UAT web and Admin builds (ADR 0026,
// RP-1041). They sit in the build assets bucket on R2, which has no public URL
// (no r2.dev, no custom domain), so they are private by construction. The UAT
// deploy Action fetches them on its runner with a read-only key before
// `vercel build` (RP-1043); no Vercel project ever holds that key, so a PR
// preview Vercel builds itself keeps the fallback. They are written only to the
// git-ignored folder prepareArabicFont reads (packages/ui/src/fonts/arabic-font.ts).
// The licence forbids redistributing them (CLAUDE.md): never committed. Without
// them Arabic falls back to IBM Plex Sans Arabic, as in deploy-dev.yml. It
// lives in the api because the api has the S3 client.

/** Where the fonts sit in the build assets bucket (as packages/infra FONTS_PREFIX and the worker's THMANYAH_PREFIX). */
export const THMANYAH_PREFIX = "fonts/thmanyah/";

/** The git-ignored folder the font switch reads (.gitignore `packages/ui/fonts/`). */
export const THMANYAH_FONTS_DIR = fileURLToPath(new URL("../../../../packages/ui/fonts/thmanyah/", import.meta.url));

/** The weights the font switch takes, by the same name rule (packages/ui arabic-font.ts). */
const thmanyahSansFile = /^thmanyahsans-(light|regular|medium|bold|black)\.woff2$/i;

/** The build assets bucket and its read-only fonts key: only the UAT deploy Action's runner has them, never a Vercel project. */
const FONTS_ENV: ObjectStoreEnvNames = { bucket: "BUILD_ASSETS_BUCKET", accessKeyId: "FONTS_ACCESS_KEY_ID", secretAccessKey: "FONTS_SECRET_ACCESS_KEY" };
const FONTS_ENV_NAMES = [FONTS_ENV.bucket, FONTS_ENV.accessKeyId, FONTS_ENV.secretAccessKey];

/**
 * The private build assets bucket with the read-only fonts key, or null when
 * the environment doesn't give all of it (a build that falls back to IBM Plex).
 * Never the files bucket's key.
 */
export function fontsBucketFromEnv(source: NodeJS.ProcessEnv = process.env): ObjectStoreSettings | null {
  if (!source.FILE_STORE_ENDPOINT || !FONTS_ENV_NAMES.every((name) => source[name])) return null;
  return objectStoreFromEnv(source, FONTS_ENV);
}

/**
 * Downloads every Thmanyah Sans weight under fonts/thmanyah/ of `bucket` into
 * `dir` and returns their names; with none there, warns and returns [] so the
 * build keeps the fallback. A store that refuses the key throws.
 */
export async function fetchThmanyahFonts({
  client,
  bucket,
  dir = THMANYAH_FONTS_DIR,
  warn = console.warn,
}: {
  client: S3Client;
  bucket: string;
  dir?: string;
  warn?: (message: string) => void;
}): Promise<string[]> {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: THMANYAH_PREFIX }));
  const keys = (listed.Contents ?? []).map((o) => o.Key ?? "").filter((key) => thmanyahSansFile.test(key.slice(THMANYAH_PREFIX.length)));
  if (keys.length === 0) {
    warn(`No Thmanyah fonts in ${bucket}/${THMANYAH_PREFIX}; Arabic falls back to IBM Plex Sans Arabic.`);
    return [];
  }
  mkdirSync(dir, { recursive: true });
  const names: string[] = [];
  for (const key of keys) {
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await got.Body?.transformToByteArray();
    if (!bytes) throw new Error(`${key} came back empty`);
    const name = key.slice(THMANYAH_PREFIX.length);
    writeFileSync(join(dir, name), bytes);
    names.push(name);
  }
  return names;
}
