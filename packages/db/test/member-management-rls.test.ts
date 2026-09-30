// Seam 2 for Member management (RP-188): only a Company's Authorized Person can
// invite, flag, deactivate or reactivate its Members, and never another
// Company's, even when calling the database directly as the app role.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const tag = randomUUID().slice(0, 8);
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}-${tag}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
const ids = { companyA: "", companyB: "", apA: "", a1: "", apB: "", b1: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, status = "active"): Promise<string> {
  return one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, $4) returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
    status,
  ]);
}

let engineer: string;
function company(name: string): Promise<string> {
  return one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    digits(10),
    `3${digits(13)}3`,
    engineer,
  ]);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  ids.companyA = await company("Company A");
  ids.companyB = await company("Company B");
  ids.apA = await member(ids.companyA, "ap-a");
  ids.a1 = await member(ids.companyA, "a1");
  ids.apB = await member(ids.companyB, "ap-b");
  ids.b1 = await member(ids.companyB, "b1");
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ids.apA, ids.companyA]);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ids.apB, ids.companyB]);
  app = createDb(urls.app, { max: 1 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const inviteEmail = (trx: Db, address: string) =>
  sql<{ outcome: string; member_id: string | null }>`
    select * from app.invite_member(${address}, '{"en":"x","ar":"x"}'::jsonb, 'en',
      ${Buffer.from(randomUUID())}, now() + interval '1 day')
  `
    .execute(trx)
    .then((r) => r.rows[0]!);
const invite = (trx: Db, who = "invitee") => inviteEmail(trx, email(who)).then((r) => r.member_id!);
const reactivate = (trx: Db, target: string) =>
  sql<{ outcome: string | null }>`
    select app.reactivate_member(${target}::uuid, ${Buffer.from(randomUUID())}, now() + interval '1 day', now()) as outcome
  `
    .execute(trx)
    .then((r) => r.rows[0]!.outcome);
const emailOf = async (id: string) => (await migrator.query("select email from member where id = $1", [id])).rows[0].email as string;
const setCreator = (trx: Db, target: string, value: boolean) =>
  sql<{ status: string | null }>`select app.set_project_creator(${target}::uuid, ${value}) as status`
    .execute(trx)
    .then((r) => r.rows[0]!.status);
const deactivate = (trx: Db, target: string) =>
  sql<{ outcome: string | null }>`select app.deactivate_member(${target}::uuid, now()) as outcome`
    .execute(trx)
    .then((r) => r.rows[0]!.outcome);
const row = async (id: string) =>
  (await migrator.query("select company_id, status, can_create_projects from member where id = $1", [id])).rows[0];

describe("the app role", () => {
  it("still cannot write member directly", async () => {
    await expect(
      withMember(app, ids.apA, (trx) => sql`update member set can_create_projects = true where id = ${ids.a1}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withMember(app, ids.apA, (trx) =>
        sql`insert into member (company_id, email, full_name) values (${ids.companyA}, ${email("x")}, '{"en":"x","ar":"x"}')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("inviting", () => {
  it("adds the Member to the Authorized Person's own Company only", async () => {
    const id = await withMember(app, ids.apA, invite);
    expect((await row(id)).company_id).toBe(ids.companyA);
    // Unfiltered: RLS alone decides what each Company sees.
    const everyone = (trx: Db) => sql<{ id: string }>`select id from member`.execute(trx).then((r) => r.rows.map((x) => x.id));
    expect(await withMember(app, ids.a1, everyone)).toContain(id);
    const seenByB = await withMember(app, ids.b1, everyone);
    expect(seenByB).not.toContain(id);
    expect(seenByB).not.toContain(ids.apA);
    expect(await app.transaction().execute(everyone)).toEqual([]);
  });

  it("is refused to a Member who is not the Authorized Person, and with no Member set", async () => {
    await expect(withMember(app, ids.a1, invite)).rejects.toThrow(/only the Authorized Person/);
    await expect(app.transaction().execute(invite)).rejects.toThrow(/only the Authorized Person/);
  });

  it("is refused to a deactivated Authorized Person", async () => {
    const companyC = await company("Company C");
    const gone = await member(companyC, "gone-ap", "deactivated");
    await migrator.query("update company set authorized_person_id = $1 where id = $2", [gone, companyC]);
    await expect(withMember(app, gone, invite)).rejects.toThrow(/only the Authorized Person/);
  });
});

describe("inviting a taken email (V17)", () => {
  it("says only that another Company has it, with no id", async () => {
    const before = await row(ids.b1);
    const taken = ` ${(await emailOf(ids.b1)).toUpperCase()}`;
    expect(await withMember(app, ids.apA, (trx) => inviteEmail(trx, taken))).toEqual({
      outcome: "another_company",
      member_id: null,
    });
    expect(await row(ids.b1)).toEqual(before);
  });

  it("tells the Company's own Members and deactivated Members apart", async () => {
    expect(await withMember(app, ids.apA, async (trx) => inviteEmail(trx, await emailOf(ids.a1)))).toEqual({
      outcome: "already_a_member",
      member_id: null,
    });
    const gone = await member(ids.companyA, "gone", "deactivated");
    expect(await withMember(app, ids.apA, async (trx) => inviteEmail(trx, await emailOf(gone)))).toEqual({
      outcome: "deactivated",
      member_id: gone,
    });
    expect((await row(gone)).status).toBe("deactivated");
  });
});

describe("reactivating", () => {
  it("does not reach another Company's Member", async () => {
    const gone = await member(ids.companyB, "gone-b", "deactivated");
    expect(await withMember(app, ids.apA, (trx) => reactivate(trx, gone))).toBeNull();
    expect((await row(gone)).status).toBe("deactivated");
  });

  it("invites again a Member who never set a password, as the same Member", async () => {
    const gone = await member(ids.companyA, "never-accepted", "deactivated");
    expect(await withMember(app, ids.apA, (trx) => reactivate(trx, gone))).toBe("reactivated");
    expect((await row(gone)).status).toBe("invited");
    const invitations = await migrator.query("select count(*)::int as n from invitation where member_id = $1", [gone]);
    expect(invitations.rows[0].n).toBe(1);
  });

  it("is refused to anyone else", async () => {
    await expect(withMember(app, ids.a1, (trx) => reactivate(trx, ids.a1))).rejects.toThrow(/only the Authorized Person/);
  });
});

describe("flagging a Project Creator", () => {
  it("works on the Authorized Person's own Company", async () => {
    expect(await withMember(app, ids.apA, (trx) => setCreator(trx, ids.a1, true))).toBe("active");
    expect((await row(ids.a1)).can_create_projects).toBe(true);
  });

  it("does not reach another Company's Member", async () => {
    expect(await withMember(app, ids.apA, (trx) => setCreator(trx, ids.b1, true))).toBeNull();
    expect((await row(ids.b1)).can_create_projects).toBe(false);
  });

  it("is refused to anyone else", async () => {
    await expect(withMember(app, ids.a1, (trx) => setCreator(trx, ids.a1, true))).rejects.toThrow(
      /only the Authorized Person/,
    );
    await expect(app.transaction().execute((trx) => setCreator(trx, ids.b1, true))).rejects.toThrow(
      /only the Authorized Person/,
    );
  });
});

describe("deactivating", () => {
  it("does not reach another Company's Member", async () => {
    expect(await withMember(app, ids.apA, (trx) => deactivate(trx, ids.b1))).toBeNull();
    expect((await row(ids.b1)).status).toBe("active");
  });

  it("refuses the Authorized Person", async () => {
    expect(await withMember(app, ids.apA, (trx) => deactivate(trx, ids.apA))).toBe("authorized_person");
    expect((await row(ids.apA)).status).toBe("active");
  });

  it("is refused to anyone else", async () => {
    await expect(withMember(app, ids.a1, (trx) => deactivate(trx, ids.a1))).rejects.toThrow(/only the Authorized Person/);
  });

  it("ends the Member's sessions", async () => {
    const target = await member(ids.companyA, "leaver");
    const hash = Buffer.from(randomUUID());
    await sql`select app.create_session(${hash}, ${target}::uuid, null, now() + interval '1 hour')`.execute(app);
    expect(await withMember(app, ids.apA, (trx) => deactivate(trx, target))).toBe("deactivated");
    const { rows } = await sql`select * from app.session_principal(${hash}, now())`.execute(app);
    expect(rows).toEqual([]);
    const revoked = await migrator.query("select revoked_at from session where token_hash = $1", [hash]);
    expect(revoked.rows[0].revoked_at).not.toBeNull();
  });
});
