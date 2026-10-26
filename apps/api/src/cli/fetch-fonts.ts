// Fetches the licensed Thmanyah fonts for the UAT web and Admin builds (RP-1041, ADR 0026), into the
// git-ignored packages/ui/fonts/thmanyah/ that prepareArabicFont reads. The UAT deploy Action runs it
// on its runner before `vercel build` (RP-1043); no Vercel project runs it or holds its key:
//   pnpm --filter @rabaed/api fonts:fetch      fetch; warn and keep IBM Plex when there are none
// Reads FILE_STORE_ENDPOINT, FILE_STORE_REGION (auto), BUILD_ASSETS_BUCKET and the read-only
// FONTS_ACCESS_KEY_ID / FONTS_SECRET_ACCESS_KEY. Without them it warns and leaves the fallback.
// Prints file names only, never a key. A key the store refuses fails the build.
import { fetchThmanyahFonts, fontsBucketFromEnv } from "../build-assets/thmanyah-fonts.ts";
import { fileStoreClient } from "../documents/file-store.ts";

try {
  const settings = fontsBucketFromEnv();
  if (!settings) {
    console.warn("fonts:fetch: no fonts bucket (FILE_STORE_ENDPOINT, BUILD_ASSETS_BUCKET, FONTS_ACCESS_KEY_ID, FONTS_SECRET_ACCESS_KEY); Arabic falls back to IBM Plex Sans Arabic.");
  } else {
    const names = await fetchThmanyahFonts({ client: fileStoreClient(settings), bucket: settings.bucket, warn: (m) => console.warn(`fonts:fetch: ${m}`) });
    if (names.length > 0) console.log(`fonts:fetch: Thmanyah Sans, ${names.join(", ")}`);
  }
} catch (error) {
  console.error(`fonts:fetch: ${(error as Error).message}`);
  process.exit(1);
}
