// Seam 2 for scenario RP-1072-1 (Participant Invitation emails; visibility.md V15): the Project
// Admin's invitation answers the same for K1, a Company on Rabaed, and for a CR number not on Rabaed,
// and only K1's invitation queues an email, whose outbox payload names only the invitation and its
// time. The worker (the app role with no Member set) reads only K1's Authorized Person, their
// language, the Project's name, the Host Company and the offered Project Role; a withdrawn
// invitation reads as nothing, and the invitation sent again reads once, in its new Project Role.
// Seam 1 is apps/api/test/participant-invitation-email.test.ts.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { digits, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let engineer = "";

type Company = { id: string; cr: string; ap: string; apEmail: string };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function company(name: string, locale: "en" | "ar"): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const apEmail = email(`${name.toLowerCase()}-ap`);
  const ap = await one("insert into member (company_id, email, full_name, status, can_create_projects, locale) values ($1, $2, $3, 'active', true, $4) returning id", [
    id,
    apEmail,
    JSON.stringify({ en: name, ar: name }),
    locale,
  ]);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, apEmail };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

/** The Project's invitation outbox rows, as the worker finds them. */
const invitationsQueued = async (projectId: string) =>
  (await migrator.query("select payload from outbox where kind = 'participant_invitation' and project_id = $1 order by created_at, payload->>'invitedAt'", [projectId])).rows.map(
    (r: { payload: { participantId: string; invitedAt: string } }) => r.payload,
  );

/** What the worker reads to email invitation `participantId` sent at `invitedAt`. */
const emailFor = async (participantId: string, invitedAt: string) =>
  (await sql<{ to_address: string; language: string; project_name: unknown; host_company_name: unknown; role_name: { en: string } }>`
    select * from app.participant_invitation_email(${participantId}::uuid, ${invitedAt}::timestamptz)
  `.execute(app)).rows;

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

describe("scenario RP-1072-1: a Project Admin invites K1 and a CR number not on Rabaed, withdraws, and invites K1 again", () => {
  it("answers the same for both, queues K1's email only, and sends nothing for a withdrawn invitation", async () => {
    const c1 = await company("C1", "en");
    const k1 = await company("K1", "ar");
    const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'RIE', 'contractor')`);
    const projectId = created!.project_id;
    const invite = async (cr: string, role: string) =>
      (await call<{ outcome: string }>(c1.ap, sql`select app.add_participant(${projectId}::uuid, ${cr}, ${role}, now()) as outcome`))[0]!.outcome;

    expect(await invite(k1.cr, "consultant")).toBe("invited");
    expect(await invite(digits(10), "consultant")).toBe("invited");
    const k1Participant = await one("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id]);

    // Only K1's invitation is queued (the lead queues nothing), and its payload is the invitation and its time.
    const first = await invitationsQueued(projectId);
    expect(first).toEqual([{ participantId: k1Participant, invitedAt: expect.any(String) }]);

    const sent = await emailFor(k1Participant, first[0]!.invitedAt);
    expect(sent).toEqual([
      {
        to_address: k1.apEmail,
        language: "ar",
        project_name: { en: "Tower", ar: "برج" },
        host_company_name: { en: "C1", ar: "C1" },
        role_name: expect.objectContaining({ en: "Consultant" }),
      },
    ]);

    // Withdrawn before the worker runs: the same read gave K1's email just above, and now gives none.
    expect(await call<{ outcome: string }>(c1.ap, sql`select app.withdraw_invitation(${projectId}::uuid, ${k1Participant}::uuid, now()) as outcome`)).toEqual([
      { outcome: "withdrawn" },
    ]);
    expect(await emailFor(k1Participant, first[0]!.invitedAt)).toEqual([]); // not hidden-from: the same read gave K1's email before the withdraw

    // Invited again in another Project Role: one more row, read once, in the new role; the old row still reads as nothing.
    expect(await invite(k1.cr, "owner_representative")).toBe("invited");
    const again = await invitationsQueued(projectId);
    expect(again.map((p) => p.participantId)).toEqual([k1Participant, k1Participant]);
    const second = again[1]!;
    const resent = await emailFor(k1Participant, second.invitedAt);
    expect(resent.map((r) => [r.to_address, r.role_name.en])).toEqual([[k1.apEmail, "Owner Representative"]]);
    expect(await emailFor(k1Participant, first[0]!.invitedAt)).toEqual([]); // not hidden-from: an older send of an invitation sent again since
  });
});
