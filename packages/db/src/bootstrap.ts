import pg from "pg";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE, databaseNameOf, withDatabaseName, type DatabaseUrls } from "./config.ts";

const identifier = /^[a-z_][a-z0-9_]*$/;

// Any constant; distinct from the migration lock.
const BOOTSTRAP_LOCK_KEY = 718_200_185;

function checkIdentifier(name: string): string {
  if (!identifier.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

function credentialsOf(url: string, expectedRole: string): string {
  const u = new URL(url);
  const user = decodeURIComponent(u.username);
  if (user !== expectedRole) {
    throw new Error(`Expected the connection URL to use role ${expectedRole}, got ${user || "(none)"}`);
  }
  return decodeURIComponent(u.password);
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates the roles and the database. Idempotent; run before migrations.
 * The app role gets no privileges on tables here: migrations grant them.
 */
export async function bootstrap(urls: DatabaseUrls): Promise<void> {
  const database = checkIdentifier(databaseNameOf(urls.migrator));
  if (databaseNameOf(urls.app) !== database || databaseNameOf(urls.admin) !== database) {
    throw new Error("DATABASE_APP_URL, DATABASE_ADMIN_URL and DATABASE_MIGRATOR_URL must name the same database");
  }
  const roles = [
    { name: MIGRATOR_ROLE, password: credentialsOf(urls.migrator, MIGRATOR_ROLE), bypassRls: false },
    { name: APP_ROLE, password: credentialsOf(urls.app, APP_ROLE), bypassRls: false },
    // ADR 0007: Rabaed Admin uses a separate role that bypasses RLS.
    { name: ADMIN_ROLE, password: credentialsOf(urls.admin, ADMIN_ROLE), bypassRls: true },
  ];

  await withClient(urls.superuser, async (client) => {
    // Several processes may bootstrap at once (e.g. both seam suites); roles are
    // cluster-wide, so serialise the check-then-create. Released when the session ends.
    await client.query("select pg_advisory_lock($1)", [BOOTSTRAP_LOCK_KEY]);
    for (const role of roles) {
      const exists = await client.query("select 1 from pg_roles where rolname = $1", [role.name]);
      const verb = exists.rowCount ? "alter" : "create";
      const password = role.password ? `password ${client.escapeLiteral(role.password)}` : "";
      await client.query(
        `${verb} role ${role.name} login nosuperuser nocreatedb nocreaterole noreplication ${role.bypassRls ? "bypassrls" : "nobypassrls"} ${password}`,
      );
    }
    // On RDS the bootstrap user is not a superuser, and PostgreSQL 16 lets it
    // give the database and schema to rabaed_migrator only as a member of it.
    await client.query(`grant ${MIGRATOR_ROLE} to current_user`);
    const db = await client.query("select 1 from pg_database where datname = $1", [database]);
    if (!db.rowCount) await client.query(`create database ${database} owner ${MIGRATOR_ROLE}`);
  });

  await withClient(withDatabaseName(urls.superuser, database), async (client) => {
    await client.query(`revoke all on database ${database} from public`);
    await client.query(`grant connect, temporary on database ${database} to ${APP_ROLE}, ${ADMIN_ROLE}`);
    await client.query(`alter schema public owner to ${MIGRATOR_ROLE}`);
    await client.query(`revoke all on schema public from public`);
    await client.query(`grant usage on schema public to ${APP_ROLE}, ${ADMIN_ROLE}`);
  });
}
