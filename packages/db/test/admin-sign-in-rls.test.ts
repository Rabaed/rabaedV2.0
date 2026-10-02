// Seam 2 for Rabaed Admin's own sign-in (ADR 0010, RP-254): the customer api's
// role can neither sign an Engineer in nor see any of Rabaed Admin's sign-in
// records, and the admin role keeps the sign-in log append-only.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const tag = randomUUID().slice(0, 8);
const email = `eng-admin-${tag}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let admin: Db;
let engineerId = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  engineerId = (await migrator.query("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email])).rows[0].id;
  await migrator.query("insert into credential (engineer_id, password_hash) values ($1, 'not-a-real-hash')", [engineerId]);
  app = createDb(urls.app, { max: 1 });
  admin = createDb(urls.admin, { max: 1 });
});

afterAll(async () => {
  await app?.destroy();
  await admin?.destroy();
  await migrator?.end();
});

const token = () => Buffer.from(randomUUID());

describe("the app role", () => {
  for (const table of ["engineer_sign_in_code", "engineer_session", "engineer_device", "engineer_sign_in_event"]) {
    it(`cannot read ${table}`, async () => {
      await expect(sql`select * from ${sql.table(table)}`.execute(app)).rejects.toThrow(/permission denied/);
    });
  }

  it("finds no Engineer to sign in", async () => {
    const { rows } = await sql`select * from app.sign_in_candidate('engineer', ${email})`.execute(app);
    expect(rows).toEqual([]);
  });

  it("cannot start a session for an Engineer", async () => {
    await expect(
      sql`select app.create_session(${token()}, null, ${engineerId}::uuid, now() + interval '1 hour')`.execute(app),
    ).rejects.toThrow(/not a Member/);
  });

  it("resolves no Engineer session, even one made before Rabaed Admin moved out", async () => {
    const hash = token();
    await migrator.query("insert into session (token_hash, engineer_id, expires_at) values ($1, $2, now() + interval '1 hour')", [hash, engineerId]);
    const { rows } = await sql`select * from app.session_principal(${hash}, now())`.execute(app);
    expect(rows).toEqual([]);
  });

  it("cannot read an Engineer's password hash", async () => {
    await expect(sql`select * from app.engineer_sign_in_candidate(${email})`.execute(app)).rejects.toThrow(/permission denied/);
  });
});

describe("the admin role", () => {
  it("reads an active Engineer's password hash through the sign-in function only", async () => {
    const { rows } = await sql`select * from app.engineer_sign_in_candidate(${email.toUpperCase()})`.execute(admin);
    expect(rows).toEqual([{ engineer_id: engineerId, password_hash: "not-a-real-hash" }]);
    await expect(sql`select * from credential`.execute(admin)).rejects.toThrow(/permission denied/);
  });

  it("can only append to the sign-in log", async () => {
    await sql`
      insert into engineer_sign_in_event (engineer_id, email, event, at) values (${engineerId}, ${email}, 'password_failed', now())
    `.execute(admin);
    await expect(sql`update engineer_sign_in_event set event = 'signed_in' where email = ${email}`.execute(admin)).rejects.toThrow(
      /permission denied/,
    );
    await expect(sql`delete from engineer_sign_in_event where email = ${email}`.execute(admin)).rejects.toThrow(/permission denied/);
  });

  it("cannot delete sessions, codes or devices: they end by being revoked, used or expiring", async () => {
    for (const table of ["engineer_sign_in_code", "engineer_session", "engineer_device"]) {
      await expect(sql`delete from ${sql.table(table)} where engineer_id = ${engineerId}`.execute(admin), table).rejects.toThrow(/permission denied/);
    }
  });
});
