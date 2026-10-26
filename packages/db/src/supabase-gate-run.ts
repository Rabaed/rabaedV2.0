// The Supabase gate (RP-1037, ADR 0026): `pnpm --filter @rabaed/db run gate:supabase`.
// Builds a database of its own on the server DATABASE_SUPERUSER_URL reaches and
// proves it runs Rabaed as RDS does: the bootstrap (the bypass role included),
// every migration, what the apps do per request through the transaction pooler,
// Supabase's Data API off, and seam 2 unchanged. Checks the Data API first, then
// stops at the first step that fails, naming it; a failed Data API check lets the
// rest run, and the gate then fails, so one run shows both. Prints no password and
// no full URL. SUPABASE_GATE_ONLY=data-api runs only the Data API check.
//
// Env: DATABASE_SUPERUSER_URL (Supabase: the session pooler, port 5432),
// DATABASE_MIGRATOR_PASSWORD, DATABASE_APP_PASSWORD, DATABASE_ADMIN_PASSWORD,
// SUPABASE_PROJECT_REF with SUPABASE_PUBLISHABLE_KEY (both unset: a local run,
// the Data API check is skipped and the probe uses the plain server), optional
// DATABASE_NAME (default rabaed_gate; locally <the .env database>_gate).
// Seam 2 also needs the file store its demo seed uploads to (FILE_STORE_*).
//
// Roles are cluster-wide, and UAT's apps use the same three. Neither the gate's
// bootstrap nor seam 2's sets the password of a role that exists (a password set
// again, even unchanged, re-salts its SCRAM secret, and Supavisor's cached copy
// then fails pooled logins with 28P01; RP-1037). Seam 2 still briefly changes a
// role attribute and creates scratch roles. Run it when no UAT deploy is in progress.
// So after a DATABASE_*_PASSWORD changes in `uat`, the role's password is set to it
// once by hand (ALTER ROLE as postgres), and Supavisor given a few minutes.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { databaseNameOf } from "./config.ts";
import { gateSteps, redactor, runGateSteps, seamTwoEnv, type GateUrls } from "./supabase-gate.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const projectRef = process.env.SUPABASE_PROJECT_REF || undefined;

const passwordsOf = (urls: GateUrls) => Object.values(urls).map((url) => decodeURIComponent(new URL(url).password));
// The credential variables are hidden from the first line on; the role passwords too once the URLs are built.
const credential = /^DATABASE_\w+_URL$|PASSWORD|_KEY$|TOKEN|SECRET/;
const environmentSecrets = Object.entries(process.env).flatMap(([name, value]) => (value && credential.test(name) ? [value] : []));
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
  // 28P01 names the login, not the cause: name the two causes it has had here.
  const passwordHint =
    code === "28P01" &&
    "A password differs from its secret (the gate sets one only when it creates the login), or Supavisor still holds the secret from before a password change: retry in a few minutes.";
  return [error.message, code && `(SQLSTATE ${code})`, detail && `Detail: ${detail}`, hint && `Hint: ${hint}`, passwordHint].filter(Boolean).join(" ");
}

/** Seam 2 as CI runs it, against the gate's database (`<DATABASE_NAME>_test`), its output redacted. */
function seamTwo(urls: GateUrls): Promise<void> {
  const env = seamTwoEnv(urls, projectRef, process.env);
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm test:seam2", { cwd: repoRoot, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", say);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pnpm test:seam2 exited with ${code}`))));
  });
}

const steps = gateSteps({
  seamTwo,
  onUrls: (urls) => {
    redact = redactor([...environmentSecrets, ...passwordsOf(urls)]);
    return `session ${where(urls.migrator)}, transaction ${where(urls.appTransaction)}`;
  },
});
const failed = await runGateSteps(steps, say, failureOf);
if (!failed.length) {
  say("Supabase gate passed.");
} else {
  // Named again here: a failed Data API check is hours of seam 2 output above.
  say(`Supabase gate failed: ${failed.join("; ")}.`);
  // Exit once stdout has drained, so a piped log keeps the reason.
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(1);
}
