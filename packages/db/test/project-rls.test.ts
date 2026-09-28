// Seam 2 for Projects (RP-189; ADR 0007): the Project is the tenancy boundary.
// With a Member of Project A set, an unfiltered SELECT on any Project table
// returns no Project B rows; with no Member set, nothing at all.
//
// The tables are found, not listed: every table with a project_id column (and
// project itself) is checked, so each later Project table is covered as soon as
// its migration lands.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const ids = { creatorA: "", colleagueA: "", creatorB: "", projectA: "", projectB: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Company with a Project Creator and a plain Member, inserted as the migrator. */
async function company(engineer: string, name: string) {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const member = (who: string, creator: boolean) =>
    one(
      "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
      [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
    );
  return { companyId, creator: await member("creator", true), colleague: await member("colleague", false) };
}

/** Creates a Project the way the API does: app.create_project, as the Project Creator. */
function createProject(memberId: string, code: string): Promise<string> {
  return withMember(app, memberId, (trx) =>
    sql<{ project_id: string }>`
      select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')
    `
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  const a = await company(engineer, "Company A");
  const b = await company(engineer, "Company B");
  ids.creatorA = a.creator;
  ids.colleagueA = a.colleague;
  ids.creatorB = b.creator;
  app = createDb(urls.app, { max: 2 });
  ids.projectA = await createProject(ids.creatorA, "AAA");
  ids.projectB = await createProject(ids.creatorB, "BBB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** Every Project table and the column holding its Project. */
async function projectTables(): Promise<{ table: string; column: string }[]> {
  const { rows } = await migrator.query<{ table: string }>(`
    select c.table_name as table from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'project_id' and t.table_type = 'BASE TABLE'
    order by 1
  `);
  return [{ table: "project", column: "id" }, ...rows.map((r) => ({ table: r.table, column: "project_id" }))];
}

/** The Projects whose rows `trx` sees in `table`, unfiltered. */
async function projectsSeen(trx: Db, { table, column }: { table: string; column: string }): Promise<string[]> {
  const { rows } = await sql<{ project: string | null }>`
    select distinct ${sql.ref(column)} as project from ${sql.table(table)}
  `.execute(trx);
  return rows.map((r) => r.project).filter((p): p is string => p !== null);
}

describe("every Project table", () => {
  it("includes the tables this ticket adds", async () => {
    const tables = (await projectTables()).map((t) => t.table);
    expect(tables).toEqual(expect.arrayContaining(["project", "participant", "project_member", "project_admin", "project_role"]));
  });

  it("shows a Member of Project A no Project B rows, and does show Project A's", async () => {
    for (const t of await projectTables()) {
      const seenByA = await withMember(app, ids.creatorA, (trx) => projectsSeen(trx, t));
      expect(seenByA, t.table).not.toContain(ids.projectB);
      const seenByB = await withMember(app, ids.creatorB, (trx) => projectsSeen(trx, t));
      expect(seenByB, t.table).not.toContain(ids.projectA);
    }
    for (const table of ["project", "participant", "project_member", "project_admin"]) {
      const t = (await projectTables()).find((x) => x.table === table)!;
      expect(await withMember(app, ids.creatorA, (trx) => projectsSeen(trx, t)), table).toEqual([ids.projectA]);
    }
  });

  it("shows a Member of the same Company who is not on the Project nothing of it", async () => {
    for (const t of await projectTables()) {
      expect(await withMember(app, ids.colleagueA, (trx) => projectsSeen(trx, t)), t.table).toEqual([]);
    }
  });

  it("returns no rows at all with no Member set", async () => {
    for (const { table } of await projectTables()) {
      const { rows } = await app.transaction().execute((trx) => sql`select 1 from ${sql.table(table)}`.execute(trx));
      expect(rows, table).toEqual([]);
    }
  });

  it("cannot be written directly by the app role", async () => {
    for (const { table } of await projectTables()) {
      await expect(
        withMember(app, ids.creatorA, (trx) => sql`delete from ${sql.table(table)}`.execute(trx)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("company_project_counter", () => {
  it("is out of the app role's reach", async () => {
    await expect(
      withMember(app, ids.creatorA, (trx) => sql`select * from company_project_counter`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("app.create_project", () => {
  it("is refused to a Member who is not a Project Creator, and with no Member set", async () => {
    await expect(createProject(ids.colleagueA, "NOPE")).rejects.toThrow(/only a Project Creator/);
    await expect(
      app.transaction().execute((trx) =>
        sql`select * from app.create_project('{"en": "P", "ar": "م"}'::jsonb, 'NOPE', 'contractor')`.execute(trx),
      ),
    ).rejects.toThrow(/only a Project Creator/);
  });

  it("gives the Project Number back when the creation fails after taking it", async () => {
    const counter = async () =>
      (
        await migrator.query(
          "select last_project_number from company_project_counter c join member m on m.company_id = c.company_id where m.id = $1",
          [ids.creatorA],
        )
      ).rows[0].last_project_number as number;
    const before = await counter();
    // A lowercase code passes the function's checks but fails project's own constraint, after the increment.
    await expect(createProject(ids.creatorA, "bad")).rejects.toThrow(/check constraint/);
    expect(await counter()).toBe(before);
    await createProject(ids.creatorA, "NEXT");
    expect(await counter()).toBe(before + 1);
  });
});
