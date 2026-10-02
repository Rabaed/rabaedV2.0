// Seeds the demo Project into the local database and prints who can sign in.
// Usage: pnpm demo:seed (after pnpm db:reset; `pnpm demo` runs both and starts the stack).
//
// Every demo person signs in with one password, generated on this machine the
// first time and kept in .env.demo at the repository root (git-ignored), so it
// stays the same across resets and is never committed.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertLocalDatabases, createDb, databaseUrlsFromEnv } from "@rabaed/db";
import { buildApp } from "../app.ts";
import { apiConfigFromEnv } from "../config.ts";
import { seedDemo } from "../demo/seed.ts";

const passwordFile = fileURLToPath(new URL("../../../../.env.demo", import.meta.url));

function demoPassword(): string {
  if (existsSync(passwordFile)) {
    const match = /^DEMO_PASSWORD=(.+)$/m.exec(readFileSync(passwordFile, "utf8"));
    if (match) return match[1]!.trim();
  }
  const password = `demo-${randomBytes(12).toString("base64url")}`;
  writeFileSync(
    passwordFile,
    `# The local demo's sign-in password for every demo person (RP-196). Git-ignored; never commit it.\nDEMO_PASSWORD=${password}\n`,
  );
  return password;
}

// Only a database on this machine, reached through exactly these URLs (never a
// password from Secrets Manager, as createDbFromEnv would use in AWS).
const urls = databaseUrlsFromEnv();
try {
  assertLocalDatabases([urls.migrator, urls.app, urls.admin]);
} catch (error) {
  console.error(`demo:seed: ${(error as Error).message}`);
  process.exit(1);
}

const password = demoPassword();
const db = createDb(urls.app, { max: 2 });
const adminDb = createDb(urls.admin, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
const app = await buildApp({ db, config: apiConfigFromEnv(), logger: false });
try {
  const seed = await seedDemo(app, { migrator, admin: adminDb }, password);
  console.log(`\nDemo Projects "Riyadh Gate Tower – Phase 2" and "Jeddah Corniche Villas" seeded. Everyone signs in with the password in .env.demo.\n`);
  const rows = [seed.engineer, ...seed.people].map((p) => [p.company, p.label, p.name.en, p.email]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
  for (const r of rows) console.log(`  ${r.slice(0, 3).map((c, i) => c!.padEnd(widths[i]!)).join("  ")}  ${r[3]}`);
  console.log(`\nSign in at /en/sign-in (or /ar/sign-in). The Rabaed Engineer signs in to Rabaed Admin (pnpm dev runs it; the code comes by email, to Mailpit).\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("If the demo was seeded before, reset first: pnpm db:reset (or run pnpm demo).");
  process.exitCode = 1;
} finally {
  await app.close();
  await Promise.all([db.destroy(), adminDb.destroy(), migrator.destroy()]);
}
