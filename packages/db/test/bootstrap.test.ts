// Seam 2: bootstrap against a real Postgres.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.ts";
import { ADMIN_ROLE, APP_ROLE, MIGRATOR_ROLE } from "../src/config.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

function withPassword(url: string, password: string): string {
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}

function asUser(url: string, user: string, password: string): string {
  const u = new URL(withPassword(url, password));
  u.username = user;
  return u.toString();
}

async function canConnect(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function query(url: string, text: string): Promise<pg.QueryResultRow[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

describe("bootstrap", () => {
  // In AWS, Secrets Manager rotates the role passwords. A deploy's bootstrap
  // must not set them back to the values it read when its task started.
  it("with passwords owned by rotation, leaves existing roles' passwords alone", async () => {
    const urls = testDatabaseUrls();
    const stale = { ...urls, app: withPassword(urls.app, "stale-value-from-task-start") };

    await bootstrap(stale, { passwords: "on-create" });

    expect(await canConnect(urls.app)).toBe(true);
    expect(await canConnect(stale.app)).toBe(false);
  });
});

// On RDS the bootstrap user (the master user) is not a superuser: it has
// CREATEROLE and CREATEDB, and admin rights on the roles it created. Every
// deploy after the first bootstraps over the existing roles as that user.
describe("bootstrap as a user that is not a superuser, like RDS's master user", () => {
  const urls = testDatabaseUrls();
  const master = "rabaed_test_rds_master";
  const masterPassword = "rds-like-master-password";
  const asMaster = { ...urls, superuser: asUser(urls.superuser, master, masterPassword) };
  const roleNames = `'${MIGRATOR_ROLE}', '${APP_ROLE}', '${ADMIN_ROLE}'`;

  beforeAll(async () => {
    await query(urls.superuser, `drop role if exists ${master}`);
    await query(urls.superuser, `create role ${master} login createrole createdb password '${masterPassword}'`);
    await query(urls.superuser, `grant ${MIGRATOR_ROLE}, ${APP_ROLE}, ${ADMIN_ROLE} to ${master} with admin option`);
  });
  afterAll(async () => {
    await query(urls.superuser, `drop role if exists ${master}`);
  });

  it("re-runs over existing roles, never naming an attribute only a superuser may change", async () => {
    await bootstrap(asMaster, { passwords: "on-create" });
    const roles = await query(
      urls.superuser,
      `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname in (${roleNames}) order by rolname`,
    );
    expect(roles).toEqual([
      { rolname: ADMIN_ROLE, rolsuper: false, rolbypassrls: true, rolcanlogin: true },
      { rolname: APP_ROLE, rolsuper: false, rolbypassrls: false, rolcanlogin: true },
      { rolname: MIGRATOR_ROLE, rolsuper: false, rolbypassrls: false, rolcanlogin: true },
    ]);
  });

  it("still corrects an attribute that drifted", async () => {
    await query(urls.superuser, `alter role ${APP_ROLE} createdb`);
    await bootstrap(asMaster, { passwords: "on-create" });
    expect(await query(urls.superuser, `select rolcreatedb from pg_roles where rolname = '${APP_ROLE}'`)).toEqual([{ rolcreatedb: false }]);
  });
});
