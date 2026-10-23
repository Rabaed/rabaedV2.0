// The Supabase gate (RP-1037, ADR 0026): `pnpm --filter @rabaed/db gate:supabase`.
// Builds a database of its own on the server DATABASE_SUPERUSER_URL reaches and
// proves it runs Rabaed as RDS does: the bootstrap (the bypass role included),
// every migration, seam 2 unchanged, what the apps do per request through the
// transaction pooler, and Supabase's Data API off. Stops at the first step that
// fails, naming it. Prints no password and no full URL.
//
// Env: DATABASE_SUPERUSER_URL (Supabase: the session pooler, port 5432),
// DATABASE_MIGRATOR_PASSWORD, DATABASE_APP_PASSWORD, DATABASE_ADMIN_PASSWORD,
// SUPABASE_PROJECT_REF with SUPABASE_PUBLISHABLE_KEY (both unset: a local run,
// the Data API check is skipped and the probe uses the plain server), optional
// DATABASE_NAME (default rabaed_gate; locally <the .env database>_gate).
// Seam 2 also needs the file store its demo seed uploads to (FILE_STORE_*).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { bootstrap } from "./bootstrap.ts";
import { databaseNameOf } from "./config.ts";
import { REMOTE_TEST_HOST_VARIABLE } from "./local-database.ts";
import { migrate } from "./migrate.ts";
import { checkBootstrapRole, checkBypassRole, checkDataApiOff, gateUrlsFromEnv, poolerProbe, redactor, type GateUrls } from "./supabase-gate.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const projectRef = process.env.SUPABASE_PROJECT_REF || undefined;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || undefined;

const passwordsOf = (urls: GateUrls) => Object.values(urls).map((url) => decodeURIComponent(new URL(url).password));
// Every secret-looking variable is hidden from the first line on; the role passwords too once the URLs are built.
const environmentSecrets = Object.entries(process.env).flatMap(([name, value]) => (value && value.length >= 6 && /PASSWORD|_URL$|KEY|TOKEN|SECRET/.test(name) ? [value] : []));
let redact = redactor(environmentSecrets);

const say = (line: string) => console.log(redact(line));

/** Where a URL points, for the log: host, port, database and login, never the password. */
const where = (url: string) => {
  const u = new URL(url);
  return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || "5432"}/${databaseNameOf(url)}`;
};

function failureOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { code, detail, hint } = error as Error & { code?: string; detail?: string; hint?: string };
  return [error.message, code && `(SQLSTATE ${code})`, detail && `Detail: ${detail}`, hint && `Hint: ${hint}`].filter(Boolean).join(" ");
}

async function step(name: string, run: () => Promise<string | void>): Promise<void> {
  say(`▶ ${name}`);
  try {
    const detail = await run();
    say(`✔ ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    say(`✘ ${name}: ${failureOf(error)}`);
    say("Supabase gate failed.");
    process.exit(1);
  }
}

/** Seam 2 as CI runs it, against the gate's database (`<DATABASE_NAME>_test`), its output redacted. */
function seamTwo(urls: GateUrls): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_SUPERUSER_URL: urls.superuser,
    DATABASE_MIGRATOR_URL: urls.migrator,
    DATABASE_APP_URL: urls.app,
    DATABASE_ADMIN_URL: urls.admin,
  };
  // The reset of the test database refuses a remote host unless named (local-database.ts).
  if (projectRef) env[REMOTE_TEST_HOST_VARIABLE] = new URL(urls.superuser).hostname;
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm test:seam2", { cwd: repoRoot, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", say);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pnpm test:seam2 exited with ${code}`))));
  });
}

let urls: GateUrls | undefined;
await step("Read the connections", async () => {
  urls = gateUrlsFromEnv();
  // Checked first, so a missing key fails in seconds, not after seam 2.
  if (projectRef && !publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required when SUPABASE_PROJECT_REF is set");
  redact = redactor([...environmentSecrets, ...passwordsOf(urls)]);
  return `session ${where(urls.migrator)}, transaction ${where(urls.appTransaction)}`;
});
const gate = urls!;

await step("The bootstrap login may create rabaed_admin with BYPASSRLS", () => checkBootstrapRole(gate.superuser));
await step("Bootstrap (rabaed_migrator, rabaed_app, rabaed_admin with BYPASSRLS)", () => bootstrap(gate));
await step("rabaed_admin bypasses row-level security", () => checkBypassRole(gate.superuser));
await step("Migrate the schema (every migrations/*.sql)", async () => {
  const { applied } = await migrate(gate.migrator);
  return applied.length ? `applied ${applied.length}` : "already up to date";
});
await step(projectRef ? "The transaction pooler carries an api call's transaction" : "An api call's transaction (no pooler locally)", async () => {
  const probe = await poolerProbe({ app: gate.appTransaction, admin: gate.adminTransaction });
  const problems = [
    !probe.memberSeen && "the Member set in the transaction was not seen by its parameterised query",
    probe.memberAfterCommit !== null && "the Member outlived its transaction",
    probe.adminSwitchedTo !== "rabaed_app" && `set local role ran as ${probe.adminSwitchedTo || "(nothing)"}, not rabaed_app`,
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join("; "));
});
await step("Seam 2", () => seamTwo(gate));
await step("Supabase's Data API is off", async () => {
  const result = await checkDataApiOff({ projectRef, publishableKey });
  switch (result.outcome) {
    case "skipped":
      return "skipped: no SUPABASE_PROJECT_REF (a local run)";
    case "off":
      return `rest/v1/ with the publishable key answered ${result.status}: no schema exposed`;
    case "open":
      throw new Error(`rest/v1/ answered ${result.status}: the Data API is on, a way to the tables around the api`);
    case "key refused":
      throw new Error(`rest/v1/ refused the publishable key (${result.status}), which proves nothing about the Data API: check SUPABASE_PUBLISHABLE_KEY`);
    case "unexpected":
      throw new Error(`rest/v1/ answered ${result.status}${result.code ? ` (${result.code})` : ""}, not the Data-API-off answer (no schema exposed)`);
  }
});
say("Supabase gate passed.");
