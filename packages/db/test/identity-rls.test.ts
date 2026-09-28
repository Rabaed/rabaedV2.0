// Seam 2 for identity (RP-187): Companies and Members are isolated per Company
// in the database itself, and the secrets tables are out of the app role's reach.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const vat = () => `3${digits(13)}3`;
const tag = randomUUID().slice(0, 8);

let migrator: pg.Client;
let app: Db;
let admin: Db;
const ids = { companyA: "", companyB: "", a1: "", a2: "", aGone: "", b1: "" };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;
  const engineer = await one(
    "insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id",
    [`eng-${tag}@rabaed.test`],
  );
  const company = (name: string) =>
    one(
      "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
      [JSON.stringify({ en: name, ar: name }), digits(10), vat(), engineer],
    );
  const member = (companyId: string, name: string, status: string) =>
    one(
      "insert into member (company_id, email, full_name, status) values ($1, $2, $3, $4) returning id",
      [companyId, `${name}-${tag}@rabaed.test`, JSON.stringify({ en: name, ar: name }), status],
    );
  ids.companyA = await company("Company A");
  ids.companyB = await company("Company B");
  ids.a1 = await member(ids.companyA, "a1", "active");
  ids.a2 = await member(ids.companyA, "a2", "active");
  ids.aGone = await member(ids.companyA, "a-gone", "deactivated");
  ids.b1 = await member(ids.companyB, "b1", "active");
  app = createDb(urls.app, { max: 1 });
  admin = createDb(urls.admin, { max: 1 });
});

afterAll(async () => {
  await app?.destroy();
  await admin?.destroy();
  await migrator?.end();
});

const companiesSeen = (trx: Db) =>
  sql<{ id: string }>`select id from company`.execute(trx).then((r) => r.rows.map((x) => x.id));
const membersSeen = (trx: Db) =>
  sql<{ id: string }>`select id from member`.execute(trx).then((r) => r.rows.map((x) => x.id).sort());

describe("company", () => {
  it("shows a Member only their own Company", async () => {
    expect(await withMember(app, ids.a1, companiesSeen)).toEqual([ids.companyA]);
    expect(await withMember(app, ids.b1, companiesSeen)).toEqual([ids.companyB]);
  });

  it("shows nothing with no Member set", async () => {
    expect(await app.transaction().execute(companiesSeen)).toEqual([]);
  });

  it("shows nothing to a deactivated Member", async () => {
    expect(await withMember(app, ids.aGone, companiesSeen)).toEqual([]);
  });

  it("cannot be changed by the app role", async () => {
    await expect(
      withMember(app, ids.a1, (trx) => sql`update company set status = 'suspended' where id = ${ids.companyA}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("member", () => {
  it("shows a Member only their own Company's Members", async () => {
    expect(await withMember(app, ids.a1, membersSeen)).toEqual([ids.a1, ids.a2, ids.aGone].sort());
    expect(await withMember(app, ids.b1, membersSeen)).toEqual([ids.b1]);
  });

  it("shows nothing with no Member set", async () => {
    expect(await app.transaction().execute(membersSeen)).toEqual([]);
  });
});

describe("the app role", () => {
  for (const table of ["rabaed_engineer", "credential", "session", "invitation", "admin_action"]) {
    it(`cannot read ${table}`, async () => {
      await expect(
        withMember(app, ids.a1, (trx) => sql`select * from ${sql.table(table)}`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe("the session functions", () => {
  const token = () => Buffer.from(randomUUID());

  it("never judge expiry by a time earlier than the database's", async () => {
    const hash = token();
    await sql`select app.create_session(${hash}, ${ids.a1}::uuid, null, now() - interval '1 minute')`.execute(app);
    const { rows } = await sql`select * from app.session_principal(${hash}, '2000-01-01'::timestamptz)`.execute(app);
    expect(rows).toEqual([]);
  });

  it("refuse a session for a deactivated Member", async () => {
    await expect(
      sql`select app.create_session(${token()}, ${ids.aGone}::uuid, null, now() + interval '1 hour')`.execute(app),
    ).rejects.toThrow(/not active/);
  });
});

describe("the admin role", () => {
  it("sees every Company (it bypasses RLS)", async () => {
    const seen = await companiesSeen(admin);
    expect(seen).toEqual(expect.arrayContaining([ids.companyA, ids.companyB]));
  });

  it("cannot read passwords or sessions", async () => {
    await expect(sql`select * from credential`.execute(admin)).rejects.toThrow(/permission denied/);
    await expect(sql`select * from session`.execute(admin)).rejects.toThrow(/permission denied/);
  });

  it("can only append to admin_action", async () => {
    const engineer = (await migrator.query("select onboarded_by as id from company where id = $1", [ids.companyA]))
      .rows[0].id as string;
    await sql`
      insert into admin_action (engineer_id, action, target_kind, target_id, reason)
      values (${engineer}, 'onboard_company', 'company', ${ids.companyA}, 'seam 2')
    `.execute(admin);
    await expect(sql`update admin_action set reason = 'changed'`.execute(admin)).rejects.toThrow(/permission denied/);
    await expect(sql`delete from admin_action`.execute(admin)).rejects.toThrow(/permission denied/);
  });

  it("cannot record an action without a reason", async () => {
    const engineer = (await migrator.query("select onboarded_by as id from company where id = $1", [ids.companyA]))
      .rows[0].id as string;
    await expect(
      sql`
        insert into admin_action (engineer_id, action, target_kind, target_id, reason)
        values (${engineer}, 'onboard_company', 'company', ${ids.companyA}, '  ')
      `.execute(admin),
    ).rejects.toThrow(/check constraint/);
  });
});
