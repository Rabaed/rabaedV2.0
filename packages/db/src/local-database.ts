import { parse } from "pg-connection-string";

// Destructive local tools (db:reset, demo:seed) run only against a database on
// this machine, never an AWS one. The host is read exactly as the Postgres
// client reads it, so a URL can't pass the check and connect elsewhere (a
// `?host=` parameter wins over the authority in pg).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const hostOf = (url: string) => (parse(url).host ?? "").toLowerCase();

/** Throws unless every URL's host is this machine. The message names the host, never the URL (it holds a password). */
export function assertLocalDatabases(urls: readonly string[]): void {
  assertDatabasesOn(urls, LOCAL_HOSTS);
}

/**
 * Set only by the Supabase gate (supabase-gate-run.ts) for the seam 2 run it
 * starts: the one remote host on which a test database may be dropped and rebuilt.
 */
export const REMOTE_TEST_HOST_VARIABLE = "RABAED_REMOTE_TEST_DATABASE_HOST";

// A seam suite's test database (`<db>_test`) or a scratch database named after it (`<db>_test_reset`).
const testDatabase = /_test(_[a-z0-9_]+)?$/;

/**
 * What a database reset may drop: a database on this machine, or a test
 * database on the remote host the gate names in REMOTE_TEST_HOST_VARIABLE.
 */
export function assertResettableDatabases(urls: readonly string[], database: string, source: NodeJS.ProcessEnv = process.env): void {
  const remote = source[REMOTE_TEST_HOST_VARIABLE]?.toLowerCase();
  const allowed = remote && testDatabase.test(database) ? new Set([...LOCAL_HOSTS, remote]) : LOCAL_HOSTS;
  assertDatabasesOn(urls, allowed);
}

function assertDatabasesOn(urls: readonly string[], allowed: ReadonlySet<string>): void {
  for (const url of urls) {
    const host = hostOf(url);
    if (!allowed.has(host)) {
      throw new Error(`Refusing: the database host ${host || "(none)"} is not on this machine.`);
    }
  }
}
