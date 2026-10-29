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
//
// With the environment's file store (UAT's R2, which scripts/uat-deploy.ts passes to this
// command alone), the api it builds stores the demo's images through its own routes, and
// `ensure` puts back, with the api's file store, any demo Signature, logo or Stamp the store
// lacks (ADR 0007; RP-672: UAT's demo was seeded with none). Without one, the demo is seeded
// with its images recorded but not stored.
import { createDb, databaseUrlsFromEnv, resetDatabase } from "@rabaed/db";
import { DEMO_FLAG, DEMO_ON, ROLE_PASSWORDS_ON_CREATE } from "@rabaed/db/task-flags";
import { z } from "zod";
import { buildApp } from "../app.ts";
import { apiConfigFromEnv } from "../config.ts";
import { ensureDemo } from "../demo/ensure.ts";
import { seedingConfig } from "../demo/mailbox.ts";
import { restoreDemoImages } from "../demo/restore-images.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../documents/file-store.ts";

const parsed = z
  .object({
    action: z.enum(["ensure", "reset"]),
    [DEMO_FLAG]: z.literal(DEMO_ON, `Not a demo environment (${DEMO_FLAG} is not ${DEMO_ON})`),
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
  const { database } = await resetDatabase(urls, { passwords: ROLE_PASSWORDS_ON_CREATE, notLocal: "demo environment" });
  console.log(`demo: dropped and migrated ${database}`);
}

// The settings name the bucket and endpoint only; the key stays in the environment, never logged.
const files = process.env.PROJECT_FILES_BUCKET ? createFileStore(fileStoreSettingsFromEnv()) : undefined;

const migrator = createDb(urls.migrator, { max: 2 });
const db = createDb(urls.app, { max: 2 });
const adminDb = createDb(urls.admin, { max: 1 });
try {
  const result = await ensureDemo(
    { migrator, admin: adminDb },
    (mailer) => buildApp({ db, config: seedingConfig(apiConfigFromEnv()), logger: false, mailer, ...(files ? { files } : {}) }),
    password,
    { files: files !== undefined },
  );
  console.log(result === "seeded" ? "demo: seeded Riyadh Gate Tower – Phase 2 and Jeddah Corniche Villas" : "demo: already seeded");
  if (!files) {
    console.log("demo: no file store, so the demo's images are recorded but not stored");
  } else if (result === "present") {
    const { restored, unmatched } = await restoreDemoImages(migrator, files);
    console.log(`demo: stored ${restored} missing demo image(s)${unmatched ? `; ${unmatched} missing image(s) match no demo image and stay missing` : ""}`);
  }
} finally {
  await Promise.all([migrator.destroy(), db.destroy(), adminDb.destroy()]);
}
