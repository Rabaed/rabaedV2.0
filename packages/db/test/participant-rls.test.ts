// Seam 2 for Participants and Project Members (RP-190): a Participant's Project
// Members are visible only to its own Company, and only its Authorized Person
// changes them, even when calling the database directly as the app role.
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
async function company(engineer: string, name: string, cr = digits(10)): Promise<Company> {
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
    sql<{ outcome: string }>`select app.add_project_member(${participant}::uuid, ${member}::uuid, now()) as outcome`
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
  consultantParticipant = await joinProject(app, projectId, { adminId: host.ap, crNumber: consultant.cr, role: "consultant" }, consultant.ap);
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

describe("project_admin", () => {
  it("shows only your own Company's Project Admins", async () => {
    const admins = (trx: Db) => sql<{ member_id: string }>`select member_id from project_admin`.execute(trx).then((r) => r.rows.map((x) => x.member_id));
    expect(await withMember(app, host.member, admins)).toEqual([host.ap]);
    expect(await withMember(app, consultant.member, admins)).toEqual([]);
  });
});

// visibility.md V15, scenarios 28 and 29 (RP-223).
describe("participant", () => {
  const seen = (trx: Db) => sql<{ id: string }>`select id from participant`.execute(trx).then((r) => r.rows.map((x) => x.id).sort());

  it("shows a Participant's Members only their own Participant, never the others (scenario 28)", async () => {
    expect(await withMember(app, consultant.member, seen)).toEqual([consultantParticipant]);
    expect(await withMember(app, host.member, seen)).toEqual([hostParticipant]);
    // The consultant's Authorized Person is not on the Project: still only their own Participant.
    expect(await withMember(app, consultant.ap, seen)).toEqual([consultantParticipant]);
  });

  it("shows a Project Admin every Participant (scenario 29)", async () => {
    expect(await withMember(app, host.ap, seen)).toEqual([hostParticipant, consultantParticipant].sort());
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
        sql`select app.add_participant(${projectId}::uuid, ${consultant.cr}, 'owner', now())`.execute(trx),
      ),
    ).rejects.toThrow(/only a Project Admin/);
  });

  it("list a Project's Participants in full only to its Project Admins, and otherwise only your own (V15)", async () => {
    const names = (as: string) =>
      withMember(app, as, (trx) =>
        sql<{ company_id: string }>`select company_id from app.project_participants(${projectId}::uuid)`
          .execute(trx)
          .then((r) => r.rows.map((x) => x.company_id)),
      );
    expect(await names(host.ap)).toEqual([host.id, consultant.id]);
    expect(await names(host.member)).toEqual([host.id]);
    expect(await names(consultant.member)).toEqual([consultant.id]);
    expect(await names(consultant.ap)).toEqual([]);
  });

  it("name the Host Company to every Member of a Participant, and to nobody else", async () => {
    const hostName = (as: string) =>
      withMember(app, as, (trx) =>
        sql<{ en: string }>`select app.project_host_company_name(${projectId}::uuid) ->> 'en' as en`
          .execute(trx)
          .then((r) => r.rows[0]!.en),
      );
    expect(await hostName(consultant.member)).toBe("Host");
    // Before they are on the Project themselves (the Company Projects view).
    expect(await hostName(consultant.ap)).toBe("Host");
    const outsider = await company(
      (await migrator.query("select onboarded_by from company where id = $1", [host.id])).rows[0].onboarded_by,
      "Outsider",
    );
    expect(await hostName(outsider.ap)).toBeNull();
    expect(await hostName(outsider.member)).toBeNull();
  });
});

// Participant Invitations (RP-224; ADR 0009; visibility.md V15, scenarios 30 and 31).
describe("a Participant Invitation", () => {
  let engineer = "";
  let project = "";
  let invitee: Company;
  let invitedParticipant = "";

  const invite = (as: string, cr: string, role = "consultant") =>
    withMember(app, as, (trx) =>
      sql<{ outcome: string }>`select app.add_participant(${project}::uuid, ${cr}, ${role}, now()) as outcome`
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
  const invitations = (as: string) =>
    withMember(app, as, (trx) => sql<Record<string, unknown>>`select * from app.company_invitations()`.execute(trx).then((r) => r.rows));
  const pending = (as: string) =>
    withMember(app, as, (trx) =>
      sql<Record<string, unknown>>`select * from app.project_invitations(${project}::uuid)`.execute(trx).then((r) => r.rows),
    );
  const respond = (as: string, participant: string, accept: boolean) =>
    withMember(app, as, (trx) =>
      sql<{ outcome: string }>`select app.respond_to_invitation(${participant}::uuid, ${accept}, now()) as outcome`
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
  const participantsSeen = (as: string) =>
    withMember(app, as, (trx) =>
      sql<{ id: string }>`select id from participant where project_id = ${project}`.execute(trx).then((r) => r.rows.map((x) => x.id)),
    );
  const listed = (as: string) =>
    withMember(app, as, (trx) =>
      sql<{ participant_id: string }>`select participant_id from app.project_participants(${project}::uuid)`
        .execute(trx)
        .then((r) => r.rows.map((x) => x.participant_id)),
    );

  beforeAll(async () => {
    engineer = (await migrator.query("select onboarded_by from company where id = $1", [host.id])).rows[0].onboarded_by;
    project = await withMember(app, host.ap, (trx) =>
      sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Tower", "ar": "Tower"}'::jsonb, 'TWR', 'contractor')`
        .execute(trx)
        .then((r) => r.rows[0]!.project_id),
    );
    // The consultant joins, each with a Project Member; the invitee is only invited.
    const joined = await joinProject(app, project, { adminId: host.ap, crNumber: consultant.cr, role: "consultant" }, consultant.ap);
    expect(await addProjectMember(consultant.ap, joined, consultant.member)).toBe("added");
    const hostOnProject = (
      await migrator.query("select id from participant where project_id = $1 and company_id = $2", [project, host.id])
    ).rows[0].id;
    expect(await addProjectMember(host.ap, hostOnProject, host.member)).toBe("added");
    invitee = await company(engineer, "Invitee");
    expect(await invite(host.ap, invitee.cr, "owner_representative")).toBe("invited");
    invitedParticipant = (await invitations(invitee.ap))[0]!.participant_id as string;
  });

  it("answers a CR number that isn't on Rabaed exactly as one that is (scenario 31)", async () => {
    expect(await invite(host.ap, digits(10))).toBe("invited");
    expect(await invite(host.ap, invitee.cr, "owner_representative")).toBe("invited");
  });

  it("keeps a CR number that isn't on Rabaed as an onboarding lead the app role can't read", async () => {
    const cr = digits(10);
    await invite(host.ap, cr);
    const lead = await migrator.query("select project_id, requested_by_member_id from onboarding_lead where cr_number = $1", [cr]);
    expect(lead.rows).toEqual([{ project_id: project, requested_by_member_id: host.ap }]);
    await expect(withMember(app, host.ap, (trx) => sql`select * from onboarding_lead`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("hides the invited Company from every other Participant (scenario 30)", async () => {
    for (const as of [consultant.member, consultant.ap, host.member]) {
      expect(await participantsSeen(as)).not.toContain(invitedParticipant);
      expect(await listed(as)).not.toContain(invitedParticipant);
    }
  });

  it("shows the Project Admins the pending invitation by CR number only, never the Company", async () => {
    expect(await participantsSeen(host.ap)).not.toContain(invitedParticipant);
    expect(await listed(host.ap)).not.toContain(invitedParticipant);
    const rows = await pending(host.ap);
    expect(rows).toContainEqual({
      invitation_id: invitedParticipant,
      cr_number: invitee.cr,
      base_role: "owner_representative",
      role_name: expect.any(Object),
      invited_at: expect.any(Date),
    });
    expect(JSON.stringify(rows)).not.toContain(invitee.id);
    // Not for the Project's other Members.
    expect(await pending(host.member)).toEqual([]);
    expect(await pending(consultant.member)).toEqual([]);
  });

  it("shows the invited Authorized Person only the invitation (scenario 30)", async () => {
    expect(await invitations(invitee.ap)).toEqual([
      {
        participant_id: invitedParticipant,
        project_name: { en: "Tower", ar: "Tower" },
        host_name: { en: "Host", ar: "Host" },
        base_role: "owner_representative",
        role_name: expect.any(Object),
        invited_at: expect.any(Date),
      },
    ]);
    expect(await participantsSeen(invitee.ap)).toEqual([]);
    const participation = await withMember(app, invitee.ap, (trx) =>
      sql`select * from app.participation(${invitedParticipant}::uuid)`.execute(trx),
    );
    expect(participation.rows).toEqual([]);
    expect(await addProjectMember(invitee.ap, invitedParticipant, invitee.member)).toBe("not_found");
  });

  it("can be answered only by the invited Company's Authorized Person", async () => {
    expect(await respond(consultant.ap, invitedParticipant, true)).toBe("not_found");
    expect(await respond(host.ap, invitedParticipant, true)).toBe("not_found");
    await expect(respond(invitee.member, invitedParticipant, true)).rejects.toThrow(/only the Authorized Person/);
    await expect(invitations(invitee.member)).rejects.toThrow(/only the Authorized Person/);
  });

  it("changes nothing on the Project when declined, and can be sent again", async () => {
    const other = await company(engineer, "Decliner");
    const numbered = async () =>
      (await migrator.query("select count(*)::int as n from participant where project_id = $1 and ordinal is not null", [project]))
        .rows[0].n;
    const before = await numbered();
    await invite(host.ap, other.cr);
    const id = (await invitations(other.ap))[0]!.participant_id as string;

    expect(await respond(other.ap, id, false)).toBe("declined");
    expect(await invitations(other.ap)).toEqual([]);
    expect(await listed(host.ap)).not.toContain(id);
    // Still pending for the Project Admins, exactly like a CR number that isn't on Rabaed (scenario 31).
    expect(await pending(host.ap)).toContainEqual({
      invitation_id: id,
      cr_number: other.cr,
      base_role: "consultant",
      role_name: expect.any(Object),
      invited_at: expect.any(Date),
    });
    expect(await respond(other.ap, id, true)).toBe("not_found");
    expect(await numbered()).toBe(before);

    expect(await invite(host.ap, other.cr, "owner")).toBe("invited");
    expect(await invitations(other.ap)).toEqual([expect.objectContaining({ participant_id: id, base_role: "owner" })]);
  });

  it("makes the Company a Participant in the offered role when accepted", async () => {
    const other = await company(engineer, "Accepter");
    await invite(host.ap, other.cr, "owner");
    const id = (await invitations(other.ap))[0]!.participant_id as string;

    expect(await respond(other.ap, id, true)).toBe("accepted");
    expect(await listed(host.ap)).toContain(id);
    expect(await participantsSeen(other.ap)).toEqual([id]);
    const joined = await migrator.query(
      "select p.ordinal, r.base_role from participant p join project_role r on r.id = p.project_role_id where p.id = $1",
      [id],
    );
    expect(joined.rows[0]).toEqual({ ordinal: expect.any(Number), base_role: "owner" });
    // Now its Authorized Person adds Project Members (V15).
    expect(await addProjectMember(other.ap, id, other.member)).toBe("added");
    // Inviting it again is refused: its Project Admins see it already.
    expect(await invite(host.ap, other.cr)).toBe("already_participant");
  });

  // RP-260, scenario 38: withdrawing goes through the pending list alone, and both kinds answer alike.
  it("is withdrawn only by a Project Admin, a lead and a Company on Rabaed alike, even calling the database directly", async () => {
    const withdraw = (as: string, id: string) =>
      withMember(app, as, (trx) =>
        sql<{ outcome: string }>`select app.withdraw_invitation(${project}::uuid, ${id}::uuid, now()) as outcome`
          .execute(trx)
          .then((r) => r.rows[0]!.outcome),
      );
    const leadCr = digits(10);
    expect(await invite(host.ap, leadCr)).toBe("invited");
    const k1 = await company(engineer, "K1");
    expect(await invite(host.ap, k1.cr)).toBe("invited");
    const ids = (await pending(host.ap)).filter((r) => [leadCr, k1.cr].includes(r.cr_number as string)).map((r) => r.invitation_id as string);
    expect(ids).toHaveLength(2);

    // A Project Member who is not a Project Admin, another Participant and the invited Company.
    for (const as of [host.member, consultant.ap, consultant.member, k1.ap]) {
      for (const id of ids) expect(await withdraw(as, id)).toBe("not_found");
    }
    for (const id of ids) expect(await withdraw(host.ap, id)).toBe("withdrawn");
    for (const id of ids) expect(await withdraw(host.ap, id)).toBe("not_found");

    const left = (await pending(host.ap)).map((r) => r.invitation_id);
    for (const id of ids) expect(left).not.toContain(id);
    expect(await invitations(k1.ap)).toEqual([]);
    for (const as of [host.ap, k1.ap]) expect(await participantsSeen(as)).not.toContain(ids[1]);
  });
});

// RP-252: Rabaed onboards a Company whose CR number was invited as an onboarding
// lead (ADR 0009; visibility.md V9, scenario 31).
describe("an onboarding lead, converted when Rabaed onboards its Company", () => {
  let admin: Db;
  let engineer = "";
  let project = "";
  let newcomer: Company;
  const cr = digits(10);
  let before: Record<string, unknown>[] = [];

  const pending = (crNumber = cr) =>
    withMember(app, host.ap, (trx) =>
      sql<Record<string, unknown>>`select * from app.project_invitations(${project}::uuid)`
        .execute(trx)
        .then((r) => r.rows.filter((x) => x.cr_number === crNumber)),
    );
  const invite = (crNumber: string, role: string, on = project) =>
    withMember(app, host.ap, (trx) =>
      sql<{ outcome: string }>`select app.add_participant(${on}::uuid, ${crNumber}, ${role}, now()) as outcome`
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
  const newProject = (code: string) =>
    withMember(app, host.ap, (trx) =>
      sql<{ project_id: string }>`
        select project_id from app.create_project(${JSON.stringify({ en: code, ar: code })}::jsonb, ${code}, 'contractor')`
        .execute(trx)
        .then((r) => r.rows[0]!.project_id),
    );
  const convert = (companyId: string) =>
    admin
      .transaction()
      .execute((trx) =>
        sql<{ lead_id: string; participant_id: string; project_id: string }>`
          select * from app.convert_onboarding_leads(${companyId}::uuid, now())`
          .execute(trx)
          .then((r) => r.rows),
      );

  beforeAll(async () => {
    admin = createDb(urls.admin, { max: 1 });
    engineer = (await migrator.query("select onboarded_by from company where id = $1", [host.id])).rows[0].onboarded_by;
    project = await newProject("LTW");
    await joinProject(app, project, { adminId: host.ap, crNumber: consultant.cr, role: "consultant" }, consultant.ap);
    expect(await invite(cr, "owner_representative")).toBe("invited");
    before = await pending();
    expect(before).toHaveLength(1);
    newcomer = await company(engineer, "Newcomer", cr);
  });

  afterAll(async () => {
    await admin?.destroy();
  });

  it("is for Rabaed Admin only: the app role can't convert a lead", async () => {
    await expect(
      withMember(app, host.ap, (trx) => sql`select * from app.convert_onboarding_leads(${newcomer.id}::uuid, now())`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("becomes an Invited Participant with the lead's id, in the offered role, closing the lead for audit", async () => {
    const [lead] = (await migrator.query("select id from onboarding_lead where cr_number = $1", [cr])).rows;
    expect(await convert(newcomer.id)).toEqual([{ lead_id: lead.id, participant_id: lead.id, project_id: project }]);
    const { rows } = await migrator.query(
      `select p.id, p.status, p.company_id, r.base_role, p.invited_by_member_id
       from participant p join project_role r on r.id = p.project_role_id where p.id = $1`,
      [lead.id],
    );
    expect(rows).toEqual([
      { id: lead.id, status: "invited", company_id: newcomer.id, base_role: "owner_representative", invited_by_member_id: host.ap },
    ]);
    const closed = (await migrator.query("select converted_at, participant_id from onboarding_lead where id = $1", [lead.id])).rows[0];
    expect(closed.participant_id).toBe(lead.id);
    expect(closed.converted_at).not.toBeNull();
    // Converted once: again, nothing more.
    expect(await convert(newcomer.id)).toEqual([]);
  });

  it("shows the Project Admin the same row as before, once (scenario 31)", async () => {
    expect(await pending()).toEqual(before);
  });

  it("keeps the converted lead as it was when the CR number is invited again: only the invitation changes", async () => {
    const kept = (await migrator.query("select * from onboarding_lead where cr_number = $1", [cr])).rows;
    expect(await invite(cr, "owner")).toBe("invited");
    expect((await migrator.query("select * from onboarding_lead where cr_number = $1", [cr])).rows).toEqual(kept);
    expect(await pending()).toEqual([expect.objectContaining({ invitation_id: before[0]!.invitation_id, base_role: "owner" })]);
  });

  it("never lists a lead beside an invitation of its CR number, such as one written while its Company was onboarded", async () => {
    const racer = await company(engineer, "Racer");
    expect(await invite(racer.cr, "consultant")).toBe("invited");
    const role = (await migrator.query("select id from project_role where owner_kind = 'rabaed' and base_role = 'owner'")).rows[0].id;
    await migrator.query(
      "insert into onboarding_lead (cr_number, project_id, project_role_id, requested_by_member_id) values ($1, $2, $3, $4)",
      [racer.cr, project, role, host.ap],
    );
    expect(await pending(racer.cr)).toEqual([expect.objectContaining({ cr_number: racer.cr, base_role: "consultant" })]);
  });

  it("converts a lead invited while its Company is being onboarded: the invitation waits for the onboarding", async () => {
    const late = digits(10);
    const onboarding = new pg.Client({ connectionString: urls.admin });
    await onboarding.connect();
    try {
      await onboarding.query("begin");
      const companyId = (
        await onboarding.query(
          "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
          [JSON.stringify({ en: "Late", ar: "Late" }), late, `3${digits(13)}3`, engineer],
        )
      ).rows[0].id as string;
      await onboarding.query("select * from app.convert_onboarding_leads($1, now())", [companyId]);
      let answered = false;
      const invited = invite(late, "consultant").then((outcome) => {
        answered = true;
        return outcome;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(answered).toBe(false);
      await onboarding.query("commit");
      expect(await invited).toBe("invited");
      // The Company is invited, and no lead is left behind for it.
      const leads = await migrator.query("select count(*)::int as n from onboarding_lead where cr_number = $1", [late]);
      expect(leads.rows[0].n).toBe(0);
      const joined = await migrator.query("select status from participant where company_id = $1 and project_id = $2", [
        companyId,
        project,
      ]);
      expect(joined.rows).toEqual([{ status: "invited" }]);
    } finally {
      await onboarding.end();
    }
  });

  it("leaves a lead on a closed Project as it was", async () => {
    const closedProject = await newProject("CLD");
    const closedCr = digits(10);
    expect(await invite(closedCr, "consultant", closedProject)).toBe("invited");
    await migrator.query("update project set status = 'closed' where id = $1", [closedProject]);
    const closer = await company(engineer, "Closer", closedCr);
    expect(await convert(closer.id)).toEqual([]);
    const lead = await migrator.query("select converted_at from onboarding_lead where cr_number = $1", [closedCr]);
    expect(lead.rows).toEqual([{ converted_at: null }]);
  });

  it("shows the invitation to the new Company's Authorized Person, and to no other Participant", async () => {
    const invitations = await withMember(app, newcomer.ap, (trx) =>
      sql<{ participant_id: string; base_role: string }>`select participant_id, base_role from app.company_invitations()`
        .execute(trx)
        .then((r) => r.rows),
    );
    expect(invitations.map((i) => i.participant_id)).toEqual([before[0]!.invitation_id]);
    for (const as of [consultant.ap, consultant.member, host.member]) {
      const seen = await withMember(app, as, (trx) =>
        sql<{ id: string }>`select id from participant where project_id = ${project}`.execute(trx).then((r) => r.rows.map((x) => x.id)),
      );
      expect(seen, as).not.toContain(before[0]!.invitation_id);
    }
  });
});
