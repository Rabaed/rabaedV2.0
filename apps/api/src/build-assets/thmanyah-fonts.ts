import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FileStoreSettings } from "../documents/file-store.ts";

// The licensed Thmanyah Sans files for the web and Admin builds on Vercel (ADR
// 0026, RP-1041). They sit in the private build assets bucket on R2, read at
// build time with a read-only key, and are written only to the git-ignored
// folder prepareArabicFont reads (packages/ui/src/fonts/arabic-font.ts). The
// licence forbids redistributing them (CLAUDE.md): never committed, never in a
// public bucket. Without them Arabic falls back to IBM Plex Sans Arabic, as in
// deploy-dev.yml. It lives in the api because the api has the S3 client.

/** Where the fonts sit in the build assets bucket (as packages/infra FONTS_PREFIX and the worker's THMANYAH_PREFIX). */
export const THMANYAH_PREFIX = "fonts/thmanyah/";

/** The git-ignored folder the font switch reads (.gitignore `packages/ui/fonts/`). */
export const THMANYAH_FONTS_DIR = fileURLToPath(new URL("../../../../packages/ui/fonts/thmanyah/", import.meta.url));

/** The weights the font switch takes, by the same name rule (packages/ui arabic-font.ts). */
const thmanyahSansFile = /^thmanyahsans-(light|regular|medium|bold|black)\.woff2$/i;

/**
 * The private build assets bucket with the read-only fonts key, or null when
 * the environment doesn't give all of it (a build that falls back to IBM Plex).
 * Never the files bucket's key.
 */
export function fontsBucketFromEnv(source: NodeJS.ProcessEnv = process.env): FileStoreSettings | null {
  const env = z
    .object({
      FILE_STORE_ENDPOINT: z.url().optional(),
      FILE_STORE_REGION: z.string().min(1).optional(),
      BUILD_ASSETS_BUCKET: z.string().min(3).optional(),
      FONTS_ACCESS_KEY_ID: z.string().min(1).optional(),
      FONTS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    })
    .parse(source);
  if (!env.FILE_STORE_ENDPOINT || !env.BUILD_ASSETS_BUCKET || !env.FONTS_ACCESS_KEY_ID || !env.FONTS_SECRET_ACCESS_KEY) return null;
  return {
    bucket: env.BUILD_ASSETS_BUCKET,
    endpoint: env.FILE_STORE_ENDPOINT,
    region: env.FILE_STORE_REGION ?? "us-east-1",
    credentials: { accessKeyId: env.FONTS_ACCESS_KEY_ID, secretAccessKey: env.FONTS_SECRET_ACCESS_KEY },
  };
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

/**
 * Whether the font under `key` stays private: an unsigned GET of it (no key, no
 * signature) must be refused (4xx or 5xx; a redirect counts as served) at every one of `bases`. R2's S3 address refuses every
 * unsigned request, public bucket or not, so the bucket's public addresses (its
 * r2.dev URL, a custom domain) are the ones that tell: pass them too. The UAT
 * workflow calls this after a fetch (RP-1041's acceptance: "a font object
 * without credentials is refused").
 */
export async function fontStaysPrivate(
  bases: readonly string[],
  key: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ private: boolean; answers: { url: string; status: number }[] }> {
  if (bases.length === 0) throw new Error("fontStaysPrivate needs an address to ask");
  const path = key.split("/").map(encodeURIComponent).join("/");
  const answers: { url: string; status: number }[] = [];
  for (const base of bases) {
    const url = `${base.replace(/\/+$/, "")}/${path}`;
    const response = await fetchFn(url, { redirect: "manual" });
    await response.body?.cancel();
    answers.push({ url, status: response.status });
  }
  return { private: answers.every((a) => a.status >= 400), answers };
}