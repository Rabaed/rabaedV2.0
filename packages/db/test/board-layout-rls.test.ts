// Seam 2 for the Card view layout (RP-410), as the app role: a Member reads only
// their own layout rows, never a colleague's on the same Project nor anyone's on
// another; nobody writes the table directly, and app.set_board_layout writes the
// acting Member's own row on a Project they are on, else answers not_found.
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
let a = { member: "", colleague: "", projectId: "" };
let b = { member: "", colleague: "", projectId: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string, query: RawBuilder<unknown>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company whose Authorized Person creates a Project, and a colleague on it. */
async function side(engineer: string, name: string, code: string) {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const person = (who: string, creator: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      creator,
    ]);
  const member = await person("creator", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [member, companyId]);
  const [project] = await rowsAs<{ project_id: string }>(
    member,
    sql`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = project!.project_id;
  const colleague = await person("colleague", false);
  const participant = await one("select id from participant where project_id = $1", [projectId]);
  await migrator.query("insert into project_member (project_id, participant_id, member_id) values ($1, $2, $3)", [projectId, participant, colleague]);
  return { member, colleague, projectId };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "Company A", "BLA");
  b = await side(engineer, "Company B", "BLB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const set = (memberId: string, projectId: string) =>
  rowsAs<{ outcome: string }>(memberId, sql`select app.set_board_layout(${projectId}::uuid, 'submittals', true, false, true) as outcome`).then(
    (r) => r[0]!.outcome,
  );

describe("member_board_layout", () => {
  beforeAll(async () => {
    expect(await set(a.member, a.projectId)).toBe("set");
    expect(await set(b.member, b.projectId)).toBe("set");
  });

  it("is read by its own Member", async () => {
    expect(await rowsAs(a.member, sql`select project_id, contractor_name, location, creation_date from member_board_layout`)).toEqual([
      { project_id: a.projectId, contractor_name: true, location: false, creation_date: true },
    ]);
  });

  it("is read by nobody else: not a colleague on the same Project, nor another Project's Member", async () => {
    expect(await rowsAs(a.colleague, sql`select 1 from member_board_layout`)).toEqual([]);
    expect(await rowsAs(b.member, sql`select project_id from member_board_layout`)).toEqual([{ project_id: b.projectId }]);
  });

  it("can't be written directly by the app role", async () => {
    for (const statement of [
      sql`insert into member_board_layout (member_id, project_id, module_key, contractor_name, location, creation_date) values (${a.colleague}::uuid, ${a.projectId}::uuid, 'submittals', true, true, true)`,
      sql`update member_board_layout set location = true`,
      sql`delete from member_board_layout`,
    ]) {
      await expect(rowsAs(a.member, statement)).rejects.toThrow(/permission denied/);
    }
  });

  it("is set only for the acting Member, on a Project they are on", async () => {
    expect(await set(b.member, a.projectId)).toBe("not_found");
    expect(await set(a.colleague, a.projectId)).toBe("set");
    // The colleague's own row; A's stays as it was.
    expect(await rowsAs(a.colleague, sql`select count(*)::int as n from member_board_layout`)).toEqual([{ n: 1 }]);
    expect(await rowsAs(a.member, sql`select count(*)::int as n from member_board_layout`)).toEqual([{ n: 1 }]);
  });
});
