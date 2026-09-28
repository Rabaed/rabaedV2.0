// Seam 2 for Participants and Project Members (RP-190): a Participant's Project
// Members are visible only to its own Company, and only its Authorized Person
// changes them, even when calling the database directly as the app role.
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

type Company = { id: string; cr: string; ap: string; member: string };
let host: Company;
let consultant: Company;
let projectId = "";
let hostParticipant = "";
let consultantParticipant = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Company with an Authorized Person (also a Project Creator) and a plain Member. */
async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const member = (who: string, creator: boolean) =>
    one(
      "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
      [id, email(who), JSON.stringify({ en: who, ar: who }), creator],
    );
  const ap = await member("ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member("member", false) };
}

const addProjectMember = (as: string, participant: string, member: string) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string }>`select app.add_project_member(${participant}::uuid, ${member}::uuid) as outcome`
      .execute(trx)
      .then((r) => r.rows[0]!.outcome),
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  host = await company(engineer, "Host");
  consultant = await company(engineer, "Consultant");
  app = createDb(urls.app, { max: 2 });

  projectId = await withMember(app, host.ap, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, 'PRJ', 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );
  hostParticipant = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id;
  consultantParticipant = await withMember(app, host.ap, (trx) =>
    sql<{ participant_id: string }>`select participant_id from app.add_participant(${projectId}::uuid, ${consultant.cr}, 'consultant')`
      .execute(trx)
      .then((r) => r.rows[0]!.participant_id),
  );
  expect(await addProjectMember(host.ap, hostParticipant, host.member)).toBe("added");
  expect(await addProjectMember(consultant.ap, consultantParticipant, consultant.member)).toBe("added");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const projectMembersSeen = (trx: Db) =>
  sql<{ member_id: string }>`select member_id from project_member`.execute(trx).then((r) => r.rows.map((x) => x.member_id).sort());

describe("project_member", () => {
  it("shows each Participant's Members only their own Participant's Project Members", async () => {
    expect(await withMember(app, host.member, projectMembersSeen)).toEqual([host.ap, host.member].sort());
    expect(await withMember(app, consultant.member, projectMembersSeen)).toEqual([consultant.member]);
  });

  it("shows a Participant's Authorized Person their own, even before they are on the Project", async () => {
    expect(await withMember(app, consultant.ap, projectMembersSeen)).toEqual([consultant.member]);
  });

  it("shows nothing with no Member set", async () => {
    expect(await app.transaction().execute(projectMembersSeen)).toEqual([]);
  });
});

describe("participant", () => {
  it("shows the Project's Members every Participant of it", async () => {
    const seen = (trx: Db) => sql<{ id: string }>`select id from participant`.execute(trx).then((r) => r.rows.map((x) => x.id).sort());
    expect(await withMember(app, consultant.member, seen)).toEqual([hostParticipant, consultantParticipant].sort());
    // The consultant's Authorized Person is not on the Project: only their own Participant.
    expect(await withMember(app, consultant.ap, seen)).toEqual([consultantParticipant]);
  });
});

describe("the Participant functions", () => {
  it("never add a Member of another Company", async () => {
    expect(await addProjectMember(consultant.ap, consultantParticipant, host.member)).toBe("member_not_found");
  });

  it("never touch another Company's Participant", async () => {
    expect(await addProjectMember(consultant.ap, hostParticipant, consultant.member)).toBe("not_found");
    const removed = await withMember(app, consultant.ap, (trx) =>
      sql<{ outcome: string }>`select app.remove_project_member(${hostParticipant}::uuid, ${host.member}::uuid, now()) as outcome`
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
    expect(removed).toBe("not_found");
  });

  it("are refused to a Member who is not the Authorized Person", async () => {
    await expect(addProjectMember(consultant.member, consultantParticipant, consultant.ap)).rejects.toThrow(
      /only the Authorized Person/,
    );
    await expect(
      withMember(app, consultant.member, (trx) => sql`select * from app.company_participants()`.execute(trx)),
    ).rejects.toThrow(/only the Authorized Person/);
  });

  it("let only a Project Admin add Participants", async () => {
    await expect(
      withMember(app, host.member, (trx) =>
        sql`select * from app.add_participant(${projectId}::uuid, ${consultant.cr}, 'owner')`.execute(trx),
      ),
    ).rejects.toThrow(/only a Project Admin/);
  });

  it("show a Project's Participants' names only to its Members", async () => {
    const names = (as: string) =>
      withMember(app, as, (trx) =>
        sql<{ company_id: string }>`select company_id from app.project_participants(${projectId}::uuid)`
          .execute(trx)
          .then((r) => r.rows.map((x) => x.company_id)),
      );
    expect(await names(consultant.member)).toEqual([host.id, consultant.id]);
    expect(await names(consultant.ap)).toEqual([]);
  });
});
