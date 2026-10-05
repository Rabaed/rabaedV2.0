// Seam 2 for Participant Codes (RP-314; visibility.md V15): a code is read only
// with the Participant it belongs to (its own Company's Members and the Project
// Admins), and set only through app.set_participant_code by a Project Admin.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let engineer = "";

type Company = { id: string; cr: string; ap: string };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function company(name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [id, email("ap"), JSON.stringify({ en: name, ar: name })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

/** C1 creates a Project (its Participant is 01) and invites C2 (02), who accepts. */
async function project(code: string) {
  const c1 = await company("C1");
  const c2 = await company("C2");
  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const p1 = await one("select id from participant where project_id = $1", [projectId]);
  const p2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const setCode = async (as: string, participantId: string, value: string) =>
    (await call<{ outcome: string }>(as, sql`select app.set_participant_code(${participantId}::uuid, ${value}) as outcome`))[0]!.outcome;
  const codeSeenBy = async (as: string, participantId: string) =>
    (await call<{ code: string | null }>(as, sql`select code from participant where id = ${participantId}::uuid`)).map((r) => r.code);
  return { c1, c2, p1, p2, projectId, setCode, codeSeenBy };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Participant Codes at the database role", () => {
  it("is read with the Participant it belongs to: the Project Admin sees every code, another Company only its own", async () => {
    const t = await project("PCA");
    expect(await t.setCode(t.c1.ap, t.p2, "ctw")).toBe("set");
    expect(await t.setCode(t.c1.ap, t.p1, "ccm")).toBe("set");
    expect(await t.codeSeenBy(t.c1.ap, t.p2)).toEqual(["CTW"]);
    expect(await t.codeSeenBy(t.c2.ap, t.p2)).toEqual(["CTW"]);
    // C2 sees no row of C1's Participant, so no code (V15).
    expect(await t.codeSeenBy(t.c2.ap, t.p1)).toEqual([]);
  });

  it("is not writable around the function", async () => {
    const t = await project("PCB");
    await expect(call(t.c1.ap, sql<{ x: 1 }>`update participant set code = 'ZZZ' where id = ${t.p1}::uuid`)).rejects.toThrow();
    await expect(call(t.c1.ap, sql<{ x: 1 }>`update participant set code_locked_at = null where id = ${t.p1}::uuid`)).rejects.toThrow();
  });

  it("is set only by a Project Admin: C2's Authorized Person sees its own Participant but may not set its code, as a Project Member", async () => {
    const t = await project("PCC");
    await call(t.c2.ap, sql<{ x: 1 }>`select app.add_project_member(${t.p2}::uuid, ${t.c2.ap}::uuid, now())`);
    await expect(t.setCode(t.c2.ap, t.p2, "CTW")).rejects.toThrow(/only a Project Admin/);
    // Another Company's Participant is not found at all.
    expect(await t.setCode(t.c2.ap, t.p1, "CTW")).toBe("not_found");
    expect(await t.setCode(t.c1.ap, randomUUID(), "CTW")).toBe("not_found");
    expect(await t.codeSeenBy(t.c1.ap, t.p2)).toEqual([null]);
  });

  it("keeps a code unique in the Project and valid", async () => {
    const t = await project("PCD");
    expect(await t.setCode(t.c1.ap, t.p1, "CCM")).toBe("set");
    expect(await t.setCode(t.c1.ap, t.p2, "ccm")).toBe("duplicate_code");
    for (const bad of ["A", "TOOLONG1", "12", "A-B", " "]) expect(await t.setCode(t.c1.ap, t.p2, bad), bad).toBe("invalid_code");
  });
});
