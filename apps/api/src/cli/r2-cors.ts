// Sets the UAT files bucket's CORS on Cloudflare R2 to the UAT web origin only (RP-1041, ADR 0026).
// Run by the UAT workflow (environment `uat`), never on a laptop:
//   pnpm --filter @rabaed/api r2:cors --origin https://<uat web host>
// Reads PROJECT_FILES_BUCKET, FILE_STORE_ENDPOINT, FILE_STORE_REGION (auto),
// FILE_STORE_ACCESS_KEY_ID and FILE_STORE_SECRET_ACCESS_KEY. Prints the rules
// read back, never a key. Refuses `*`, an empty origin and the local store.
import { parseArgs } from "node:util";
import { fileStoreClient, fileStoreSettingsFromEnv, isLocalFileStore } from "../documents/file-store.ts";
import { applyUatCors } from "../documents/uat-cors.ts";

try {
  const { values } = parseArgs({ options: { origin: { type: "string" } }, strict: true });
  const settings = fileStoreSettingsFromEnv();
  if (!settings.endpoint || isLocalFileStore(settings)) {
    throw new Error("FILE_STORE_ENDPOINT must be R2's S3 address (the uat environment's), not AWS or the local store");
  }
  const rules = await applyUatCors(fileStoreClient(settings), settings.bucket, values.origin ?? "");
  console.log(`r2:cors: ${settings.bucket} now allows ${JSON.stringify(rules)}`);
} catch (error) {
  console.error(`r2:cors: ${(error as Error).message}`);
  process.exit(1);
}
