// Seam 2: the database as the app role, with and without a Member set.
// Defence in depth for docs/visibility.md: even if an API query forgets a
// filter, row-level security must return nothing it shouldn't.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_ROLE, createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const probe = `seam2_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const memberA = randomUUID();
const memberB = randomUUID();

let migrator: pg.Client;
let app: Db;

async function rowsSeenBy(trx: Parameters<Parameters<typeof withMember>[2]>[0]): Promise<string[]> {
  const result = await sql<{ note: string }>`select note from ${sql.table(probe)} order by note`.execute(trx);
  return result.rows.map((r) => r.note);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  // A sample tenant table, created the way every migration creates one.
  await migrator.query(`
    create table public.${probe} (
      id uuid primary key default gen_random_uuid(),
      member_id uuid not null,
      note text not null
    );
    alter table public.${probe} enable row level security;
    create policy own_rows on public.${probe} using (member_id = app.current_member_id());
    insert into public.${probe} (member_id, note) values
      ('${memberA}', 'a-1'), ('${memberA}', 'a-2'), ('${memberB}', 'b-1');
  `);
  // One connection, so the "setting doesn't leak" test reuses it.
  app = createDb(urls.app, { max: 1 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.query(`drop table if exists public.${probe}`);
  await migrator?.end();
});

describe("the app role", () => {
  it("is not a superuser and cannot bypass row-level security", async () => {
    const { rows } = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user
    `.execute(app);
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it("owns no tables (owners skip row-level security)", async () => {
    const { rows } = await sql<{ relname: string }>`
      select c.relname from pg_class c join pg_roles r on r.oid = c.relowner
      where r.rolname = ${APP_ROLE} and c.relkind in ('r', 'p')
    `.execute(app);
    expect(rows).toEqual([]);
  });

  it("cannot create tables", async () => {
    await expect(sql`create table public.app_role_should_fail (id int)`.execute(app)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cannot switch row-level security off", async () => {
    await expect(
      app.transaction().execute(async (trx) => {
        await sql`set local row_security = off`.execute(trx);
        return rowsSeenBy(trx);
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("a row-level-security-protected table", () => {
  it("returns zero rows with no Member set", async () => {
    const rows = await app.transaction().execute(rowsSeenBy);
    expect(rows).toEqual([]);
  });

  it("returns only the set Member's rows", async () => {
    expect(await withMember(app, memberA, rowsSeenBy)).toEqual(["a-1", "a-2"]);
    expect(await withMember(app, memberB, rowsSeenBy)).toEqual(["b-1"]);
  });

  it("forgets the Member when the transaction ends", async () => {
    await withMember(app, memberA, rowsSeenBy);
    const rows = await app.transaction().execute(rowsSeenBy);
    expect(rows).toEqual([]);
  });

  it("does not let the app role write another Member's rows", async () => {
    await expect(
      withMember(app, memberA, (trx) =>
        sql`insert into ${sql.table(probe)} (member_id, note) values (${memberB}, 'forged')`.execute(trx),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("the schema", () => {
  it("has row-level security enabled on every table the app role can read", async () => {
    const { rows } = await sql<{ table: string }>`
      select c.oid::regclass::text as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and has_table_privilege(${APP_ROLE}, c.oid, 'select')
        and not c.relrowsecurity
    `.execute(app);
    expect(rows).toEqual([]);
  });
});
