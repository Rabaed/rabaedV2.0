// The demo in a cloud environment (dev only, RP-213). The deploy workflow runs
// it in the migration task, after the migrations:
//
//   tsx apps/api/src/cli/demo-environment.ts ensure   seeds the demo unless it is there (every deploy)
//   tsx apps/api/src/cli/demo-environment.ts reset    drops the database, migrates it and seeds the demo
//   tsx apps/api/src/cli/demo-environment.ts add-sample-project      adds the sample Project (RP-1217) where the demo
//                                                                    is already, without a reset; again, it changes nothing
//   tsx apps/api/src/cli/demo-environment.ts sample-project-status   only counts how much of it is there
//
// It refuses to run unless the environment is a demo one (RABAED_DEMO=on, set
// by the deploy only for a demo environment, such as UAT).
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
import { demoMailbox, seedingConfig } from "../demo/mailbox.ts";
import { restoreDemoImages } from "../demo/restore-images.ts";
import { addSampleProject, publicFailure, sampleProjectStatus } from "../demo/sample-project.ts";
import { UAT_ROLES } from "../demo/uat-projects-plan.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../documents/file-store.ts";

const parsed = z
  .object({
    action: z.enum(["ensure", "reset", "add-sample-project", "sample-project-status"]),
    [DEMO_FLAG]: z.literal(DEMO_ON, `Not a demo environment (${DEMO_FLAG} is not ${DEMO_ON})`),
    DEMO_PASSWORD: z.string().min(16, "DEMO_PASSWORD is missing or too short"),
  })
  .safeParse({ ...process.env, action: process.argv[2] });
if (!parsed.success) {
  console.error(`demo: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  console.error("Usage: demo-environment.ts ensure|reset|add-sample-project|sample-project-status");
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
// The sample Project (RP-1217) moves four items at once, and the UAT Projects (RP-1254) are built six at a
// time: with 20 ms per query they took 476 s on four connections, 145 s on twelve
// (ten at a time on sixteen was no faster). With the migrator's 2 and admin's 1, 15 through the session pooler.
const db = createDb(urls.app, { max: 12 });
const adminDb = createDb(urls.admin, { max: 1 });
try {
  if (action === "sample-project-status" || action === "add-sample-project") {
    // One line, no stack: UAT's job log is public.
    await sampleProject(action).catch((error: unknown) => {
      console.error(`demo: ${(error as Error).message}`);
      process.exitCode = 1;
    });
  } else await demo();
} finally {
  await Promise.all([migrator.destroy(), db.destroy(), adminDb.destroy()]);
}

/**
 * The sample Project on a database the demo is in (RP-1217), without a reset: `sample-project-status`
 * only reads how far it is; `add-sample-project` adds what is missing. Counts only: UAT's job log is public.
 */
async function sampleProject(action: "sample-project-status" | "add-sample-project") {
  const before = await sampleProjectStatus(migrator);
  console.log(
    `demo: the sample Project is ${before.project ? "there" : "not there"}, with ${before.present} of its ${before.planned} item(s) and ${before.packages.present} of its ${before.packages.planned} Package(s)`,
  );
  if (action === "sample-project-status") return;
  if (!files) throw new Error("the sample Project needs the file store: its Submittals leave Draft with their Datasheets; nothing was changed");
  const app = await buildApp({ db, config: seedingConfig(apiConfigFromEnv()), logger: false, mailer: demoMailbox().mailer, files });
  try {
    await addSampleProject(app, migrator, password, { log: (line) => console.log(`demo: ${line}`) });
  } catch (error) {
    // The cause stays for a debugger; the catch above prints the message alone.
    throw new Error(`the sample Project stopped: ${publicFailure(error)}`, { cause: error });
  } finally {
    await app.close();
  }
}

async function demo() {
  const result = await ensureDemo(
    { migrator, admin: adminDb },
    (mailer) => buildApp({ db, config: seedingConfig(apiConfigFromEnv()), logger: false, mailer, ...(files ? { files } : {}) }),
    password,
    // Each Project's time and the total (RP-1254), so the next slow-down shows where it is.
    { files: files !== undefined, log: (line) => console.log(`demo: ${line}`) },
  );
  // With the file store a new seed includes the sample Project (RP-1217); an existing one gets it from add-sample-project.
  console.log(result === "seeded" ? `demo: seeded Riyadh Gate Tower – Phase 2${files ? `, Al Nakheel District – Block A, ${UAT_ROLES.map((r) => `UAT ${r.n}`).join(", ")}` : ""} and Jeddah Corniche Villas` : "demo: already seeded");
  if (!files) {
    console.log("demo: no file store, so the demo's images are recorded but not stored");
  } else if (result === "present") {
    const { restored, unmatched } = await restoreDemoImages(migrator, files);
    console.log(`demo: stored ${restored} missing demo image(s)${unmatched ? `; ${unmatched} missing image(s) match no demo image and stay missing` : ""}`);
  }
}
