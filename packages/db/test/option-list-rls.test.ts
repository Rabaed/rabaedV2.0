// Seam 2 for Option Lists (RP-279; form-engine.md §10): the app role reads
// them (any active Member, none without one) and can't insert, update or
// delete; the admin role edits but never deletes; an option's list, parent and
// value never change, and the levels stop at three.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const name = JSON.stringify({ en: "L", ar: "ل" });

let migrator: pg.Client;
let admin: pg.Client;
let app: Db;
let memberId = "";
let listId = "";
let optionId = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  admin = new pg.Client({ connectionString: urls.admin });
  await Promise.all([migrator.connect(), admin.connect()]);
  const one = async (client: pg.Client, text: string, values: unknown[]) => (await client.query(text, values)).rows[0].id as string;
  const engineer = await one(migrator, "insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    `eng-${randomUUID().slice(0, 8)}@rabaed.test`,
  ]);
  const companyId = await one(
    migrator,
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [name, digits(10), `3${digits(13)}3`, engineer],
  );
  memberId = await one(
    migrator,
    "insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id",
    [companyId, `m-${randomUUID().slice(0, 8)}@rabaed.test`, name],
  );
  listId = await one(admin, "insert into option_list (name) values ($1) returning id", [name]);
  optionId = await one(admin, "insert into option (option_list_id, value, label) values ($1, 'first', $2) returning id", [listId, name]);
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await Promise.all([migrator?.end(), admin?.end()]);
});

const asMember = <T extends object>(query: ReturnType<typeof sql<T>>) =>
  withMember(app, memberId, (trx) => query.execute(trx).then((r) => r.rows));

const insertOption = (parent: string | null, value: string, client = admin) =>
  client.query("insert into option (option_list_id, parent_id, value, label) values ($1, $2, $3, $4) returning id, level", [
    listId,
    parent,
    value,
    name,
  ]);

describe("the app role", () => {
  it("reads lists and options as any active Member", async () => {
    expect((await asMember<{ id: string }>(sql`select id from option_list where id = ${listId}::uuid`)).map((r) => r.id)).toEqual([listId]);
    expect((await asMember<{ value: string; level: number }>(sql`select value, level from option where option_list_id = ${listId}::uuid`))).toEqual([
      { value: "first", level: 1 },
    ]);
  });

  it("reads nothing with no Member set", async () => {
    expect((await sql`select id from option_list`.execute(app)).rows).toEqual([]);
    expect((await sql`select id from option`.execute(app)).rows).toEqual([]);
  });

  it("can't insert, update or delete a list or an option", async () => {
    const attempts = [
      sql`insert into option_list (name) values (${name}::jsonb)`,
      sql`update option_list set name = ${name}::jsonb`,
      sql`delete from option_list`,
      sql`insert into option (option_list_id, value, label) values (${listId}::uuid, 'sneaky', ${name}::jsonb)`,
      sql`update option set retired = true`,
      sql`delete from option`,
    ];
    for (const attempt of attempts) {
      await expect(withMember(app, memberId, (trx) => attempt.execute(trx))).rejects.toMatchObject({ code: "42501" });
    }
    expect((await admin.query("select retired from option where id = $1", [optionId])).rows).toEqual([{ retired: false }]);
  });
});

describe("the admin role", () => {
  it("edits labels and the retired flag", async () => {
    await admin.query("update option set label = $2, retired = true where id = $1", [optionId, JSON.stringify({ en: "R", ar: "ر" })]);
    expect((await admin.query("select retired from option where id = $1", [optionId])).rows).toEqual([{ retired: true }]);
    await admin.query("update option set retired = false where id = $1", [optionId]);
  });

  it("never deletes a list or an option", async () => {
    await expect(admin.query("delete from option where id = $1", [optionId])).rejects.toMatchObject({ code: "42501" });
    await expect(admin.query("delete from option_list where id = $1", [listId])).rejects.toMatchObject({ code: "42501" });
    await expect(admin.query("truncate option")).rejects.toMatchObject({ code: "42501" });
  });

  it("can't change an option's list, parent, level or value", async () => {
    const other = (await admin.query("insert into option_list (name) values ($1) returning id", [name])).rows[0].id;
    for (const [column, value] of [["option_list_id", other], ["value", "renamed"], ["level", 2], ["parent_id", optionId]] as const) {
      await expect(admin.query(`update option set ${column} = $2 where id = $1`, [optionId, value]), column).rejects.toThrow();
    }
    expect((await admin.query("select value, level from option where id = $1", [optionId])).rows).toEqual([{ value: "first", level: 1 }]);
  });
});

describe("levels", () => {
  it("follow the parent, to three, and a parent must be in the same list", async () => {
    const second = (await insertOption(optionId, "second")).rows[0];
    const third = (await insertOption(second.id, "third")).rows[0];
    expect([second.level, third.level]).toEqual([2, 3]);
    await expect(insertOption(third.id, "fourth")).rejects.toMatchObject({ code: "23514" });

    const other = (await admin.query("insert into option_list (name) values ($1) returning id", [name])).rows[0].id;
    await expect(
      admin.query("insert into option (option_list_id, parent_id, value, label) values ($1, $2, 'stray', $3)", [other, optionId, name]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("repeat a value only across lists", async () => {
    await expect(insertOption(null, "first")).rejects.toMatchObject({ code: "23505" });
    const other = (await admin.query("insert into option_list (name) values ($1) returning id", [name])).rows[0].id;
    await admin.query("insert into option (option_list_id, value, label) values ($1, 'first', $2)", [other, name]);
  });
});
