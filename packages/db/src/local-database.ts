import { parse } from "pg-connection-string";

// Destructive local tools (db:reset, demo:seed) run only against a database on
// this machine, never an AWS one. The host is read exactly as the Postgres
// client reads it, so a URL can't pass the check and connect elsewhere (a
// `?host=` parameter wins over the authority in pg).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Throws unless every URL's host is this machine. The message names the host, never the URL (it holds a password). */
export function assertLocalDatabases(urls: readonly string[]): void {
  for (const url of urls) {
    const host = (parse(url).host ?? "").toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Refusing: the database host ${host || "(none)"} is not on this machine.`);
    }
  }
}
