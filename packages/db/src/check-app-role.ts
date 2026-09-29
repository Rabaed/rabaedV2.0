import { checkAppRole } from "./app-role-check.ts";
import { createDbFromEnv } from "./client.ts";

// Run in AWS after every deploy (the migration task with this command, see
// .github/workflows/deploy-dev.yml): connects as rabaed_app and exits 1 if it
// can get round row-level security or rewrite the audit trail.
const db = createDbFromEnv("app", { max: 1 });
try {
  const failures = await checkAppRole(db);
  if (failures.length) {
    console.error(`app role check failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("app role check passed: rabaed_app is subject to row-level security and cannot rewrite work_item_event or admin_action");
  }
} finally {
  await db.destroy();
}
