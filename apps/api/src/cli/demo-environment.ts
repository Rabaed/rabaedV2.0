// The demo in a cloud environment (dev only, RP-213). The deploy workflow runs
// it in the migration task, after the migrations:
//
//   tsx apps/api/src/cli/demo-environment.ts ensure   seeds the demo unless it is there (every deploy)
//   tsx apps/api/src/cli/demo-environment.ts reset    drops the database, migrates it and seeds the demo
//
// It refuses to run unless the environment is a demo one (RABAED_DEMO=on, set
// by the infrastructure only where `demo` is on in packages/infra/src/config.ts).
// Every demo person signs in with DEMO_PASSWORD, which ECS injects from Secrets
// Manager; it is never in the repo. A demo environment holds demo data only:
// there is no way to import anything else.
import { createDb, databaseUrlsFromEnv, resetDatabase } from "@rabaed/db";
import { z } from "zod";
import { buildApp } from "../app.ts";
import { apiConfigFromEnv } from "../config.ts";
import { ensureDemo } from "../demo/ensure.ts";

const parsed = z
  .object({
    action: z.enum(["ensure", "reset"]),
    RABAED_DEMO: z.literal("on", "Not a demo environment (RABAED_DEMO is not on)"),
    DEMO_PASSWORD: z.string().min(16, "DEMO_PASSWORD is missing or too short"),
  })
  .safeParse({ ...process.env, action: process.argv[2] });
if (!parsed.success) {
  console.error(`demo: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  console.error("Usage: demo-environment.ts ensure|reset");
  process.exit(1);
}
const { action, DEMO_PASSWORD: password } = parsed.data;

const urls = databaseUrlsFromEnv();
// Rotation owns the role passwords in AWS; the reset must not set them back.
if (action === "reset") {
  const { database } = await resetDatabase(urls, { passwords: "on-create", notLocal: "demo environment" });
  console.log(`demo: dropped and migrated ${database}`);
}

const migrator = createDb(urls.migrator, { max: 2 });
const db = createDb(urls.app, { max: 2 });
const adminDb = createDb(urls.admin, { max: 1 });
try {
  const result = await ensureDemo({ migrator, admin: adminDb }, () => buildApp({ db, config: apiConfigFromEnv(), logger: false }), password);
  console.log(result === "seeded" ? "demo: seeded Riyadh Gate Tower – Phase 2 and Jeddah Corniche Villas" : "demo: already seeded");
} finally {
  await Promise.all([migrator.destroy(), db.destroy(), adminDb.destroy()]);
}
