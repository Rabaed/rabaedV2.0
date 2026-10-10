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
type Side = { companyId: string; participant: string; member: string; colleague: string; idle: string; projects: string[] };
let a: Side;
let b: Side;
let c: Side;
let d: Side;

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
  return { companyId, participant, member, colleague, idle, projects };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "Company A", ["CNA", "CNB"]);
  b = await side(engineer, "Company B", ["CNC", "CND"]);
  c = await side(engineer, "Company C", ["CNE", "CNF"]);
  d = await side(engineer, "Company D", ["CNG", "CNH"]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** A new active Member of the Company, on the Participant (or on none). */
async function joinedMember(s: Side, participant?: string): Promise<string> {
  const id = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
    s.companyId,
    email("extra"),
    JSON.stringify({ en: "Extra", ar: "إضافي" }),
  ]);
  if (participant) await migrator.query("insert into project_member (project_id, participant_id, member_id) select project_id, id, $2 from participant where id = $1", [participant, id]);
  return id;
}
const asAuthorizedPerson = (s: Side, query: ReturnType<typeof sql>) => withMember(app, s.member, (trx) => query.execute(trx));

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

describe("app.member_project_counts, as people come and go", () => {
  it("keeps a deactivated Member's count, and answers nothing to them", async () => {
    const gone = await joinedMember(c, c.participant);
    expect((await countsAs(c.member))[gone]).toBe(1);
    await asAuthorizedPerson(c, sql`select app.deactivate_member(${gone}::uuid, now())`);
    expect((await migrator.query("select status from member where id = $1", [gone])).rows[0].status).toBe("deactivated");
    expect((await countsAs(c.member))[gone]).toBe(1);
    expect(await countsAs(gone)).toEqual({});
  });

  it("does not count a Project Member who was removed", async () => {
    const leaver = await joinedMember(c, c.participant);
    expect((await countsAs(c.member))[leaver]).toBe(1);
    await asAuthorizedPerson(c, sql`select app.remove_project_member(${c.participant}::uuid, ${leaver}::uuid, now())`);
    expect((await countsAs(c.member))[leaver]).toBeUndefined();
  });

  it("does not count a Project whose Participant was withdrawn", async () => {
    const second = await one("select id from participant where project_id = $1", [c.projects[1]]);
    const member = await joinedMember(c, second);
    expect((await countsAs(c.member))[member]).toBe(1);
    await migrator.query("update participant set status = 'withdrawn', withdrawn_at = now() where id = $1", [second]);
    expect((await countsAs(c.member))[member]).toBeUndefined();
  });

  it("counts a Project shared with another Company for each Company's own people only", async () => {
    const role = await one("select id from project_role where project_id is null and base_role = 'consultant' limit 1", []);
    const theirs = await one("insert into participant (project_id, company_id, project_role_id) values ($1, $2, $3) returning id", [d.projects[0], c.companyId, role]);
    const visitor = await joinedMember(c, theirs);
    const seenByD = await countsAs(d.member);
    const seenByC = await countsAs(visitor);
    // D's Authorized Person and colleague are on the Project; C's Member is on it as C's Participant.
    expect(seenByD[d.colleague]).toBe(1);
    expect(Object.keys(seenByD)).not.toContain(visitor);
    expect(seenByC[visitor]).toBe(1);
    expect(Object.keys(seenByC)).not.toContain(d.colleague);
    expect(Object.keys(seenByC)).not.toContain(d.member);
  });
});
