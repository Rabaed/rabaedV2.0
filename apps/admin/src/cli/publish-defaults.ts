// The seed step for the Rabaed Defaults (RP-437): publishes every Rabaed Default Screen,
// Form and Workflow document in apps/admin (screens, forms, workflows) that differs from
// its latest published Version, after every publish check.
// Usage: pnpm defaults:publish --reason "Why they change" --engineer you@rabaed.sa
//        pnpm defaults:publish --ci    (the deploy, RP-1205)
//
// Run after the migrations, in every environment (the demo seed runs it too). Each
// document goes through the command its own CLI uses (`form:publish`,
// `workflow:publish`); the Workflows are a Rabaed Engineer action, logged in
// admin_action with the reason (visibility.md V9) against the active Engineer whose
// Rabaed Admin email `--engineer` gives. Then it moves the open items still on a Version
// retired with ADR 0019 on to the latest (in-flight.ts). Run again, it publishes and
// moves nothing. A refusal is
// listed problem by problem and stops it; what it published before stays.
//
// `--ci` is the deploy's mode (deploy-uat.yml through `scripts/uat-deploy.ts defaults`, whose
// logs and step summaries are public): the Engineer's email and the reason come from
// DEFAULTS_ENGINEER_EMAIL and DEFAULTS_REASON, never an argument, and it prints counts and
// document keys only (defaults-deploy.ts); a refusal or an error exits 1 with one plain line.
import { parseArgs } from "node:util";
import { createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { engineerReason } from "@rabaed/domain";
import { z } from "zod";
import { publishDefaultsForDeploy } from "../defaults-deploy.ts";
import { publishRabaedDefaults } from "../rabaed-defaults.ts";

const { values } = parseArgs({ options: { reason: { type: "string" }, engineer: { type: "string" }, ci: { type: "boolean" } } });
const ci = values.ci === true;
const inputSchema = z.object({ reason: engineerReason, engineer: z.email() });

const findEngineer = (db: ReturnType<typeof createDb>, email: string) =>
  db
    .selectFrom("rabaed_engineer")
    .select("id")
    .where("email", "=", email.trim().toLowerCase())
    .where("status", "=", "active")
    .executeTakeFirst();

if (ci) {
  // Nothing of an error is printed: its message can quote the connection.
  const fail = (line: string) => {
    console.error(line);
    process.exitCode = 1;
  };
  const input = inputSchema.safeParse({ reason: process.env.DEFAULTS_REASON, engineer: process.env.DEFAULTS_ENGINEER_EMAIL });
  if (!input.success) fail("DEFAULTS_ENGINEER_EMAIL (an email) and DEFAULTS_REASON must be set; nothing published.");
  else {
    let db: ReturnType<typeof createDb> | undefined;
    try {
      const connected = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
      db = connected;
      process.exitCode = await publishDefaultsForDeploy(
        {
          findEngineer: async (email) => (await findEngineer(connected, email))?.id ?? null,
          publish: (engineerId, reason) => publishRabaedDefaults(connected, { engineerId, reason }),
        },
        { engineerEmail: input.data.engineer, reason: input.data.reason },
        console,
      );
    } catch {
      fail("Rabaed Defaults publish failed before it could connect (the database variables); nothing published.");
    } finally {
      await db?.destroy().catch(() => {});
    }
  }
} else {
  const input = inputSchema.parse(values);
  const db = createDb(databaseUrlsFromEnv().migrator, { max: 1 });
  try {
    const engineer = await findEngineer(db, input.engineer);
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
}
