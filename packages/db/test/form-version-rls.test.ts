// Seam 2 for Forms (RP-262; ADR 0006): a published Form Version never changes,
// not even when the app role is called directly; the Rabaed Default MAR Form is
// readable by every active Member, and nothing at all without one.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");

let migrator: pg.Client;
let app: Db;
let memberId = "";
let marVersion = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    `eng-${randomUUID().slice(0, 8)}@rabaed.test`,
  ]);
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: "F", ar: "ف" }), digits(10), `3${digits(13)}3`, engineer],
  );
  memberId = await one(
    "insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id",
    [companyId, `m-${randomUUID().slice(0, 8)}@rabaed.test`, JSON.stringify({ en: "M", ar: "م" })],
  );
  marVersion = (
    await migrator.query(`
      select v.id from form_version v join work_item_type t on t.form_definition_id = v.form_definition_id
      where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.version_no = 1`)
  ).rows[0].id;
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const asMember = <T extends object>(query: ReturnType<typeof sql<T>>) =>
  withMember(app, memberId, (trx) => query.execute(trx).then((r) => r.rows));

describe("the Rabaed Default MAR Form", () => {
  it("is published as Version 1, and is the MAR's latest", async () => {
    const rows = await asMember<{ id: string; version_no: number; status: string; latest: string }>(sql`
      select v.id, v.version_no, v.status, app.latest_form_version('MAR') as latest
      from form_version v where v.id = ${marVersion}::uuid`);
    expect(rows).toEqual([{ id: marVersion, version_no: 1, status: "published", latest: marVersion }]);
  });

  it("is readable by any active Member, with its definition", async () => {
    const rows = await asMember<{ name: { en: string } }>(sql`
      select d.name from form_definition d join form_version v on v.form_definition_id = d.id
      where v.id = ${marVersion}::uuid`);
    expect(rows.map((r) => r.name.en)).toEqual(["Material Submittal (MAR)"]);
  });

  it("is not readable with no Member set", async () => {
    const { rows } = await sql`select id from form_version`.execute(app);
    expect(rows).toEqual([]);
  });
});

describe("a published Form Version, as the app role", () => {
  for (const [what, statement] of [
    ["updated", () => sql`update form_version set schema = '{"sections": []}' where id = ${marVersion}::uuid`],
    ["deleted", () => sql`delete from form_version where id = ${marVersion}::uuid`],
    ["re-inserted", () => sql`insert into form_version (form_definition_id, version_no, status, schema)
      select form_definition_id, 99, 'draft', schema from form_version where id = ${marVersion}::uuid`],
  ] as const) {
    it(`can't be ${what}`, async () => {
      await expect(withMember(app, memberId, (trx) => statement().execute(trx))).rejects.toMatchObject({ code: "42501" });
    });
  }

  it("can't have its definition renamed or removed", async () => {
    for (const statement of [sql`update form_definition set name = name`, sql`delete from form_definition`]) {
      await expect(withMember(app, memberId, (trx) => statement.execute(trx))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("a later Version of a Form, as the app role (RP-271)", () => {
  let definition = "";
  let version2 = "";
  let draft = "";

  beforeAll(async () => {
    // The MAR Form Version 1's schema serves as every Version here: only the rows matter.
    const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;
    definition = await one(`insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "V", "ar": "ف"}') returning id`, []);
    const add = (no: number, status: string) =>
      one(
        `insert into form_version (form_definition_id, version_no, status, published_at, schema)
         select $1, $2, $3::text, case when $3::text = 'published' then now() end, schema from form_version where id = $4
         returning id`,
        [definition, no, status, marVersion],
      );
    await add(1, "published");
    version2 = await add(2, "published");
    draft = await add(3, "draft");
  });

  for (const [what, statement] of [
    ["updated", () => sql`update form_version set schema = '{"sections": []}' where id = ${version2}::uuid`],
    ["deleted", () => sql`delete from form_version where id = ${version2}::uuid`],
  ] as const) {
    it(`can't be ${what}`, async () => {
      await expect(withMember(app, memberId, (trx) => statement().execute(trx))).rejects.toMatchObject({ code: "42501" });
    });
  }

  it("is read once published; a draft is neither read nor published", async () => {
    const rows = await asMember<{ version_no: number }>(sql`
      select version_no from form_version where form_definition_id = ${definition}::uuid order by version_no`);
    expect(rows).toEqual([{ version_no: 1 }, { version_no: 2 }]);
    await expect(
      withMember(app, memberId, (trx) =>
        sql`update form_version set status = 'published', published_at = now() where id = ${draft}::uuid`.execute(trx),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("can't be changed by its owner either, while a draft can still be published", async () => {
    await expect(migrator.query("delete from form_version where id = $1", [version2])).rejects.toMatchObject({ code: "42501" });
    await migrator.query("update form_version set status = 'published', published_at = now() where id = $1", [draft]);
    await expect(migrator.query("delete from form_version where id = $1", [draft])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("a published Form Version, even as its owner", () => {
  it("refuses any change or removal", async () => {
    await expect(
      migrator.query(`update form_version set schema = '{"sections": []}' where id = $1`, [marVersion]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(migrator.query("delete from form_version where id = $1", [marVersion])).rejects.toMatchObject({
      code: "42501",
    });
    const { rows } = await migrator.query("select schema -> 'sections' -> 0 ->> 'key' as first from form_version where id = $1", [
      marVersion,
    ]);
    expect(rows).toEqual([{ first: "material" }]);
  });
});
