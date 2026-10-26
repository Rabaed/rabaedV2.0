// Optional (RP-1041, ADR 0026): sets the UAT files bucket's CORS on Cloudflare R2 to the UAT web
// origin only. The usual way is a one-off owner step in the Cloudflare dashboard (docs/tech-stack.md,
// Files row; the exact JSON is in PR #418's body); this does the same with an R2 admin key:
//   pnpm --filter @rabaed/api run r2:cors --origin https://<uat web host>
// Reads PROJECT_FILES_BUCKET, FILE_STORE_ENDPOINT, FILE_STORE_REGION (auto) and the admin key,
// R2_ADMIN_ACCESS_KEY_ID and R2_ADMIN_SECRET_ACCESS_KEY: never the app's FILE_STORE_* key (Object
// Read & Write only), and the admin key is never given to an app or a Vercel project. Prints the
// rules read back, never a key. Refuses `*`, an empty origin, AWS and the local store.
import { parseArgs } from "node:util";
import { fileStoreClient } from "../documents/file-store.ts";
import { applyUatCors, r2AdminFromEnv } from "../documents/uat-cors.ts";

try {
  const { values } = parseArgs({ options: { origin: { type: "string" } }, strict: true });
  const settings = r2AdminFromEnv();
  const rules = await applyUatCors(fileStoreClient(settings), settings.bucket, values.origin ?? "");
  console.log(`r2:cors: ${settings.bucket} now allows ${JSON.stringify(rules)}`);
} catch (error) {
  console.error(`r2:cors: ${(error as Error).message}`);
  process.exit(1);
}
