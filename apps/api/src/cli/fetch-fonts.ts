// Fetches the licensed Thmanyah fonts for the web and Admin builds (RP-1041, ADR 0026), into the
// git-ignored packages/ui/fonts/thmanyah/ that prepareArabicFont reads. Run before those builds:
//   pnpm --filter @rabaed/api fonts:fetch                    fetch; warn and keep IBM Plex when there are none
//   pnpm --filter @rabaed/api fonts:fetch --check-private [--public-url <url>]...
//       also fail unless an unsigned GET of a font is refused at R2's S3 address and at each public
//       address the bucket could be served from (its r2.dev URL, a custom domain): the S3 address
//       alone refuses unsigned requests even for a public bucket.
// Reads FILE_STORE_ENDPOINT, FILE_STORE_REGION (auto), BUILD_ASSETS_BUCKET and the read-only
// FONTS_ACCESS_KEY_ID / FONTS_SECRET_ACCESS_KEY. Without them it warns and leaves the fallback.
// Prints file names only, never a key. A key the store refuses fails the build.
import { parseArgs } from "node:util";
import { fetchThmanyahFonts, fontsBucketFromEnv, fontStaysPrivate, THMANYAH_PREFIX } from "../build-assets/thmanyah-fonts.ts";
import { fileStoreClient } from "../documents/file-store.ts";

try {
  const { values } = parseArgs({ options: { "check-private": { type: "boolean", default: false }, "public-url": { type: "string", multiple: true, default: [] } }, strict: true });
  const settings = fontsBucketFromEnv();
  if (!settings) {
    console.warn("fonts:fetch: no fonts bucket (FILE_STORE_ENDPOINT, BUILD_ASSETS_BUCKET, FONTS_ACCESS_KEY_ID, FONTS_SECRET_ACCESS_KEY); Arabic falls back to IBM Plex Sans Arabic.");
    if (values["check-private"]) throw new Error("--check-private needs the fonts bucket");
  } else {
    const names = await fetchThmanyahFonts({ client: fileStoreClient(settings), bucket: settings.bucket, warn: (m) => console.warn(`fonts:fetch: ${m}`) });
    if (names.length > 0) console.log(`fonts:fetch: Thmanyah Sans, ${names.join(", ")}`);
    if (values["check-private"]) {
      if (names.length === 0) throw new Error("--check-private: no font to check");
      const bases = [`${settings.endpoint!.replace(/\/+$/, "")}/${settings.bucket}`, ...values["public-url"]];
      const probe = await fontStaysPrivate(bases, `${THMANYAH_PREFIX}${names[0]}`);
      const answers = probe.answers.map((a) => `${a.url}: ${a.status}`).join(", ");
      if (!probe.private) throw new Error(`an unsigned GET of a font was served (${answers}): the fonts bucket is public`);
      console.log(`fonts:fetch: an unsigned GET of a font is refused (${answers})`);
    }
  }
} catch (error) {
  console.error(`fonts:fetch: ${(error as Error).message}`);
  process.exit(1);
}
