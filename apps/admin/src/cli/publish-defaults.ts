// The seed step for the Rabaed Defaults (RP-437): publishes every Rabaed Default Screen,
// Form and Workflow document in apps/admin (screens, forms, workflows) that differs from
// its latest published Version, after every publish check.
// Usage: pnpm defaults:publish --reason "Why they change" --engineer you@rabaed.sa
//
// Run after the migrations, in every environment (the demo seed runs it too). Each
// document goes through the command its own CLI uses (`form:publish`,
// `workflow:publish`); the Workflows are a Rabaed Engineer action, logged in
// admin_action with the reason (visibility.md V9) against the active Engineer whose
// Rabaed Admin email `--engineer` gives. Then it moves the open items still on a Version
// retired with ADR 0019 on to the latest (in-flight.ts). Run again, it publishes and
// moves nothing. A refusal is
// listed problem by problem and stops it; what it published before stays.
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { engineerReason } from "@rabaed/domain";
import { z } from "zod";
import { publishRabaedDefaults } from "../rabaed-defaults.ts";

const { values } = parseArgs({ options: { reason: { type: "string" }, engineer: { type: "string" } } });
const input = z.object({ reason: engineerReason, engineer: z.email() }).parse(values);

const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
try {
  const engineer = await db
    .selectFrom("rabaed_engineer")
    .select("id")
    .where("email", "=", input.engineer.trim().toLowerCase())
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!engineer) {
    process.exitCode = 1;
    console.error(`No active Rabaed Engineer ${input.engineer}.`);
  } else {
    const result = await publishRabaedDefaults(db, { engineerId: engineer.id, reason: input.reason });
    if (result.ok) {
      for (const d of result.done) {
        console.log(`  ${d.kind} ${d.name}: Version ${d.versionNo}${d.published ? " published" : " (unchanged)"}`);
        for (const w of d.warnings ?? []) console.log(`    warning ${w}`);
      }
      for (const m of result.moved) console.log(`  open ${m.type} items moved off a retired Version: ${m.moved}`);
    } else {
      process.exitCode = 1;
      console.error(`Refused at the ${result.kind} ${result.name}, nothing more published:\n  ${JSON.stringify(result.result, null, 2)}`);
    }
  }
} finally {
  await db.destroy();
}
