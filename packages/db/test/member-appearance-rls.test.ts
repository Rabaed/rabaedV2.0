// Seam 2 for a Member's Appearance (owner decision 2026-10-11, spec RP-447): each Member's
// own Theme and Mode, as the app role. A Member reads only their own row, never a colleague's
// nor another Company's; nobody writes the table directly, and app.set_member_appearance
// writes the acting Member's own row only, and only a Theme and Mode the app offers.
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

const rowsAs = <T = Record<string, unknown>>(memberId: string | null, query: RawBuilder<unknown>) =>
  memberId === null
    ? query.execute(app).then((r) => r.rows as T[])
    : withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

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

const set = (memberId: string | null, theme: string, mode: string) =>
  rowsAs<{ outcome: string }>(memberId, sql`select app.set_member_appearance(${theme}, ${mode}) as outcome`).then((r) => r[0]!.outcome);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const [a, colleague] = await company(engineer, "Company A", 2);
  const [other] = await company(engineer, "Company B", 1);
  Object.assign(people, { a: a!, colleague: colleague!, b: other! });
  expect(await set(people.a, "grey", "dark")).toBe("set");
  expect(await set(people.b, "warm", "light")).toBe("set");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("member_appearance", () => {
  it("is read by its own Member", async () => {
    expect(await rowsAs(people.a, sql`select member_id, theme, mode from member_appearance`)).toEqual([
      { member_id: people.a, theme: "grey", mode: "dark" },
    ]);
  });

  it("is read by nobody else: not a colleague of the same Company, nor another Company's Member", async () => {
    expect(await rowsAs(people.colleague, sql`select 1 from member_appearance`)).toEqual([]);
    expect(await rowsAs(people.b, sql`select member_id from member_appearance`)).toEqual([{ member_id: people.b }]);
  });

  it("can't be written directly by the app role", async () => {
    for (const statement of [
      sql`insert into member_appearance (member_id, theme, mode) values (${people.colleague}::uuid, 'grey', 'dark')`,
      sql`update member_appearance set theme = 'warm'`,
      sql`delete from member_appearance`,
    ]) {
      await expect(rowsAs(people.a, statement)).rejects.toThrow(/permission denied/);
    }
  });

  it("is set only for the acting Member, replacing their own row", async () => {
    expect(await set(people.colleague, "warm", "system")).toBe("set");
    expect(await set(people.a, "warm", "dark")).toBe("set");
    expect(await rowsAs(people.a, sql`select theme, mode from member_appearance`)).toEqual([{ theme: "warm", mode: "dark" }]);
    expect(await rowsAs(people.colleague, sql`select theme, mode from member_appearance`)).toEqual([{ theme: "warm", mode: "system" }]);
  });

  it("is 'not_found' with no acting Member, and writes nothing", async () => {
    expect(await set(null, "grey", "light")).toBe("not_found");
  });

  it("takes only the Themes and Modes the app offers", async () => {
    await expect(set(people.a, "pink", "dark")).rejects.toThrow();
    await expect(set(people.a, "grey", "dusk")).rejects.toThrow();
    expect(await rowsAs(people.a, sql`select theme, mode from member_appearance`)).toEqual([{ theme: "warm", mode: "dark" }]);
  });
});
