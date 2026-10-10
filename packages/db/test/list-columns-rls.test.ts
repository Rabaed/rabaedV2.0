// Seam 2 for the List's column layout (RP-409), as the app role: each Member's own
// layout per Module. A Member reads only their own rows, never a colleague's nor
// another Company's; nobody writes the table directly, and app.set_list_columns
// writes the acting Member's own row only, and only a JSON array.
import { randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const people = { a: "", colleague: "", b: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string, query: RawBuilder<unknown>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company and `count` of its Members. */
async function company(engineer: string, name: string, count: number): Promise<string[]> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const members: string[] = [];
  for (let i = 0; i < count; i++) {
    members.push(
      await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
        companyId,
        email(`m${i}`),
        JSON.stringify({ en: `M${i}`, ar: `M${i}` }),
      ]),
    );
  }
  return members;
}

const layout = JSON.stringify([
  { key: "owner", shown: true },
  { key: "revision", shown: false },
]);
const set = (memberId: string, columns = layout) =>
  rowsAs<{ outcome: string }>(memberId, sql`select app.set_list_columns('submittals', ${columns}::jsonb) as outcome`).then((r) => r[0]!.outcome);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  [people.a, people.colleague] = await company(engineer, "Company A", 2);
  [people.b] = await company(engineer, "Company B", 1);
  expect(await set(people.a)).toBe("set");
  expect(await set(people.b)).toBe("set");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("member_list_columns", () => {
  it("is read by its own Member", async () => {
    expect(await rowsAs(people.a, sql`select module_key, columns from member_list_columns`)).toEqual([
      { module_key: "submittals", columns: JSON.parse(layout) },
    ]);
  });

  it("is read by nobody else: not a colleague of the same Company, nor another Company's Member", async () => {
    expect(await rowsAs(people.colleague, sql`select 1 from member_list_columns`)).toEqual([]);
    expect(await rowsAs(people.b, sql`select member_id from member_list_columns`)).toEqual([{ member_id: people.b }]);
  });

  it("can't be written directly by the app role", async () => {
    for (const statement of [
      sql`insert into member_list_columns (member_id, module_key, columns) values (${people.colleague}::uuid, 'submittals', '[]'::jsonb)`,
      sql`update member_list_columns set columns = '[]'::jsonb`,
      sql`delete from member_list_columns`,
    ]) {
      await expect(rowsAs(people.a, statement)).rejects.toThrow(/permission denied/);
    }
  });

  it("is set only for the acting Member, replacing their own row", async () => {
    expect(await set(people.colleague, JSON.stringify([{ key: "stepAge", shown: true }]))).toBe("set");
    expect(await set(people.a, "[]")).toBe("set");
    expect(await rowsAs(people.a, sql`select columns from member_list_columns`)).toEqual([{ columns: [] }]);
    expect(await rowsAs(people.colleague, sql`select columns from member_list_columns`)).toEqual([{ columns: [{ key: "stepAge", shown: true }] }]);
  });

  it("takes only a JSON array", async () => {
    await expect(set(people.a, '{"owner": true}')).rejects.toThrow();
  });
});
