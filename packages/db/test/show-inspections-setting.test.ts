// Seam 2 for the Project setting "Show Inspections in the Submittals tab" (RP-652, INSP-7; spec
// RP-649). Off by default. Only the Project's Admin turns it on or off, through
// app.set_show_inspections_in_submittals; anyone else is told 'not_found' and nothing changes. The
// app role cannot write the column itself, and the Project's Members read it (it is a column of
// the Project they are on; a Company outside it reads no row, as ever).
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
let creator = ""; // the Project's Admin
let colleague = ""; // a Member of the same Company, not on the Project
let consultant = ""; // the Authorized Person of a Company that joined the Project: no Admin
let stranger = ""; // a Member of a Company on no Project
let projectId = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  const crNumbers: string[] = [];
  const company = () => {
    crNumbers.push(digits(10));
    return one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
      JSON.stringify({ en: "S", ar: "س" }),
      crNumbers.at(-1),
      `3${digits(13)}3`,
      engineer,
    ]);
  };
  const member = (companyId: string, who: string, canCreate: boolean) =>
    one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id", [
      companyId,
      email(who),
      JSON.stringify({ en: who, ar: who }),
      canCreate,
    ]);
  const own = await company();
  creator = await member(own, "creator", true);
  colleague = await member(own, "colleague", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [creator, own]);
  const second = await company();
  consultant = await member(second, "consultant", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [consultant, second]);
  const third = await company();
  stranger = await member(third, "stranger", false);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [stranger, third]);
  projectId = await withMember(app, creator, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, 'SIS', 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
  await joinProject(app, projectId, { adminId: creator, crNumber: crNumbers[1]!, role: "consultant" }, consultant);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const shown = async () =>
  (await migrator.query<{ show_inspections_in_submittals: boolean }>("select show_inspections_in_submittals from project where id = $1", [projectId])).rows[0]!
    .show_inspections_in_submittals;
const setAs = (memberId: string, show: boolean | null, project = projectId) =>
  withMember(app, memberId, (trx) => sql<{ outcome: string }>`select app.set_show_inspections_in_submittals(${project}::uuid, ${show}) as outcome`.execute(trx)).then(
    (r) => r.rows[0]!.outcome,
  );

describe("the setting Show Inspections in the Submittals tab", () => {
  it("is off on a new Project", async () => {
    expect(await shown()).toBe(false);
  });

  it("is turned on and off by the Project's Admin", async () => {
    expect(await setAs(creator, true)).toBe("set");
    expect(await shown()).toBe(true);
    // The same value again is fine and changes nothing.
    expect(await setAs(creator, true)).toBe("set");
    expect(await shown()).toBe(true);
    expect(await setAs(creator, false)).toBe("set");
    expect(await shown()).toBe(false);
  });

  it("answers not_found to a Member who is no Admin of the Project, and to a made-up Project, and changes nothing", async () => {
    expect(await setAs(colleague, true)).toBe("not_found");
    expect(await setAs(consultant, true)).toBe("not_found");
    expect(await setAs(stranger, true)).toBe("not_found");
    expect(await setAs(creator, true, randomUUID())).toBe("not_found");
    expect(await setAs(creator, null)).toBe("not_found");
    expect(await shown()).toBe(false);
  });

  it("is read on the Project and not written by the app role", async () => {
    await setAs(creator, true);
    // The Admin reads it; the other Project Members' reads are in the API seam suite (inspections-in-submittals.test.ts).
    const read = await withMember(app, creator, (trx) =>
      sql<{ show: boolean }>`select show_inspections_in_submittals as show from project where id = ${projectId}::uuid`.execute(trx),
    );
    expect(read.rows).toEqual([{ show: true }]);
    // A Company that is not on the Project reads no row of it (the Project's own RLS).
    for (const who of [colleague, stranger]) {
      const outsider = await withMember(app, who, (trx) => sql`select 1 from project where id = ${projectId}::uuid`.execute(trx));
      expect(outsider.rows).toEqual([]);
    }
    await expect(
      withMember(app, creator, (trx) => sql`update project set show_inspections_in_submittals = false where id = ${projectId}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    expect(await shown()).toBe(true);
    await setAs(creator, false);
  });

  it("is refused on a closed Project", async () => {
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [projectId]);
    expect(await setAs(creator, true)).toBe("project_closed");
    expect(await shown()).toBe(false);
    await migrator.query("update project set status = 'active', closed_at = null where id = $1", [projectId]);
  });
});
