// Seam 2 for the Members page's Projects column (RP-413, scenario RP-413-1), as the
// app role: app.member_project_counts gives any Member of a Company the number of
// active Projects each of their own Company's Members is on, and nothing else: no
// Project, and no Member of another Company.
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
type Side = { member: string; colleague: string; idle: string; projects: string[] };
let a: Side;
let b: Side;

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const countsAs = (memberId: string) =>
  withMember(app, memberId, (trx) => sql<{ member_id: string; project_count: number }>`select * from app.member_project_counts()`.execute(trx)).then(
    (r) => Object.fromEntries(r.rows.map((x) => [x.member_id, x.project_count])),
  );

/** A Company with two Projects: its Authorized Person is on both (as creator), a colleague on the first, one Member on none. */
async function side(engineer: string, name: string, codes: [string, string]): Promise<Side> {
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
  const projects: string[] = [];
  for (const code of codes) {
    const r = await withMember(app, member, (trx) =>
      sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`.execute(trx),
    );
    projects.push(r.rows[0]!.project_id);
  }
  const colleague = await person("colleague", false);
  const idle = await person("idle", false);
  const participant = await one("select id from participant where project_id = $1", [projects[0]]);
  await migrator.query("insert into project_member (project_id, participant_id, member_id) values ($1, $2, $3)", [projects[0], participant, colleague]);
  return { member, colleague, idle, projects };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "Company A", ["CNA", "CNB"]);
  b = await side(engineer, "Company B", ["CNC", "CND"]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("app.member_project_counts", () => {
  it("gives a plain Member the counts of their own Company's Members, who may be on Projects they are not", async () => {
    const counts = await countsAs(a.colleague);
    expect(counts[a.member]).toBe(2);
    expect(counts[a.colleague]).toBe(1);
    // Nobody on no Project has a row.
    expect(counts[a.idle]).toBeUndefined();
  });

  it("gives the Authorized Person the same", async () => {
    expect(await countsAs(a.member)).toEqual(await countsAs(a.colleague));
  });

  it("names no Member of another Company, for either Company", async () => {
    const seenByA = Object.keys(await countsAs(a.colleague));
    expect(seenByA).not.toContain(b.member);
    expect(seenByA).not.toContain(b.colleague);
    expect(Object.keys(await countsAs(b.colleague)).sort()).toEqual([b.member, b.colleague].sort());
  });

  it("does not count a Project that closed", async () => {
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [b.projects[1]]);
    expect((await countsAs(b.member))[b.member]).toBe(1);
  });

  it("answers nothing to someone who is not a Member", async () => {
    expect(await countsAs(randomUUID())).toEqual({});
  });

  it("is executable by the app role only", async () => {
    const r = await migrator.query(
      "select has_function_privilege('public', 'app.member_project_counts()', 'execute') as pub, has_function_privilege('rabaed_app', 'app.member_project_counts()', 'execute') as app",
    );
    expect(r.rows[0]).toEqual({ pub: false, app: true });
  });
});
