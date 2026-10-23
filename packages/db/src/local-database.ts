import { parse } from "pg-connection-string";
import { loginSuffixOf } from "./config.ts";

// Destructive local tools (db:reset, demo:seed) run only against a database on
// this machine, never an AWS one. The host is read exactly as the Postgres
// client reads it, so a URL can't pass the check and connect elsewhere (a
// `?host=` parameter wins over the authority in pg).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const hostOf = (url: string) => (parse(url).host ?? "").toLowerCase();

/** Throws unless every URL's host is this machine. The message names the host, never the URL (it holds a password). */
export function assertLocalDatabases(urls: readonly string[]): void {
  for (const url of urls) if (!LOCAL_HOSTS.has(hostOf(url))) refuse(hostOf(url));
}

/**
 * Set only by the Supabase gate (supabase-gate-run.ts) for the seam 2 run it
 * starts: the one remote server on which a test database may be dropped and
 * rebuilt, as `<project>@<host>`. Supabase's pooler host is shared by every
 * project in the region, so the project its logins name is part of it.
 */
export const REMOTE_TEST_SERVER_VARIABLE = "RABAED_REMOTE_TEST_DATABASE_SERVER";

/** The value of REMOTE_TEST_SERVER_VARIABLE for the server `superuserUrl` reaches. */
export function remoteTestServerOf(superuserUrl: string): string {
  return `${loginSuffixOf(superuserUrl) ?? ""}@${hostOf(superuserUrl)}`;
}

// A seam suite's test database (`<db>_test`) or the scratch database reset-database.test.ts names after it.
const testDatabase = /_test(_reset)?$/;

/**
 * What a database reset may drop: a database on this machine, or seam 2's test
 * database on the remote server the gate names in REMOTE_TEST_SERVER_VARIABLE.
 */
export function assertResettableDatabases(urls: readonly string[], database: string, source: NodeJS.ProcessEnv = process.env): void {
  const named = source[REMOTE_TEST_SERVER_VARIABLE];
  if (!named || !testDatabase.test(database)) return assertLocalDatabases(urls);
  for (const url of urls) {
    if (!LOCAL_HOSTS.has(hostOf(url)) && remoteTestServerOf(url) !== named.toLowerCase()) refuse(hostOf(url));
  }
}

function refuse(host: string): never {
  throw new Error(`Refusing: the database host ${host || "(none)"} is not on this machine.`);
}
