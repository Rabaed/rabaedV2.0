// Seam 2 for Trades, Locations and Visibility grants (RP-191): a Participant's
// Visibility is set by a Project Admin, narrowed for its Members by its own
// Authorized Person, never exceeded by a Member (V4), and never shown to another
// Company, even when calling the database directly as the app role.
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
let host: Company; // Its Authorized Person created the Project and is its Project Admin.
let consultant: Company;
let projectId = "";
let hostParticipant = "";
let consultantParticipant = "";
const loc = { tower1: "", buildingA: "", floor1: "", buildingB: "", tower2: "" };
const trade = { electrical: "", mechanical: "" };

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

const outcomeOf = (r: { rows: { outcome: string }[] }) => r.rows[0]!.outcome;

async function addValue(as: string, kind: "trade" | "location", code: string, parent: string | null = null) {
  const { rows } = await withMember(app, as, (trx) =>
    sql<{ outcome: string; value_id: string | null }>`
      select outcome, value_id from app.add_dimension_value(
        ${projectId}::uuid, ${kind}, ${parent}::uuid, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)
    `.execute(trx),
  );
  return rows[0]!;
}

async function value(kind: "trade" | "location", code: string, parent: string | null = null): Promise<string> {
  const added = await addValue(host.ap, kind, code, parent);
  expect(added.outcome).toBe("added");
  return added.value_id!;
}

const setParticipantVisibility = (as: string, participant: string, kind: string, isAll: boolean, values: string[]) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string }>`
      select app.set_participant_visibility(${participant}::uuid, ${kind}, ${isAll}, ${values}::uuid[], now()) as outcome
    `
      .execute(trx)
      .then(outcomeOf),
  );

const setMemberVisibility = (
  as: string,
  participant: string,
  member: string,
  kind: string,
  isAll: boolean,
  values: string[],
) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string }>`
      select app.set_member_visibility(${participant}::uuid, ${member}::uuid, ${kind}, ${isAll}, ${values}::uuid[], now()) as outcome
    `
      .execute(trx)
      .then(outcomeOf),
  );

/** The values of `kind` the Member covers on the Project, sorted. */
const myVisibility = (as: string, kind: string) =>
  withMember(app, as, (trx) =>
    sql<{ value_id: string }>`select value_id from app.my_visibility(${projectId}::uuid) where kind = ${kind}`
      .execute(trx)
      .then((r) => r.rows.map((x) => x.value_id).sort()),
  );

const sorted = (...ids: string[]) => [...ids].sort();

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
  const addProjectMember = (as: string, participant: string, member: string) =>
    withMember(app, as, (trx) =>
      sql`select app.add_project_member(${participant}::uuid, ${member}::uuid, now())`.execute(trx),
    );
  await addProjectMember(host.ap, hostParticipant, host.member);
  await addProjectMember(consultant.ap, consultantParticipant, consultant.member);

  trade.electrical = await value("trade", "EL");
  trade.mechanical = await value("trade", "ME");
  loc.tower1 = await value("location", "T1");
  loc.buildingA = await value("location", "BA", loc.tower1);
  loc.floor1 = await value("location", "F1", loc.buildingA);
  loc.buildingB = await value("location", "BB", loc.tower1);
  loc.tower2 = await value("location", "T2");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Visibility Dimensions", () => {
  it("every Project gets a Trade and a Location dimension when it is created", async () => {
    const kinds = await withMember(app, host.member, (trx) =>
      sql<{ kind: string }>`select kind from visibility_dimension where project_id = ${projectId}::uuid order by kind`
        .execute(trx)
        .then((r) => r.rows.map((x) => x.kind)),
    );
    expect(kinds).toEqual(["location", "trade"]);
  });

  it("keeps Trades flat and Locations to three levels", async () => {
    expect((await addValue(host.ap, "trade", "LI", trade.electrical)).outcome).toBe("parent_not_found");
    expect((await addValue(host.ap, "location", "R1", loc.floor1)).outcome).toBe("too_deep");
    expect((await addValue(host.ap, "location", "BA", loc.tower1)).outcome).toBe("duplicate_code");
    // The same code under another parent is fine (Floor 1 of every Building).
    expect((await addValue(host.ap, "location", "F1", loc.buildingB)).outcome).toBe("added");
  });

  it("lets only a Project Admin add values", async () => {
    await expect(addValue(host.member, "trade", "CV")).rejects.toThrow(/only a Project Admin/);
    // Not a Member of the Project at all: as if it didn't exist.
    expect((await addValue(consultant.ap, "trade", "CV")).outcome).toBe("not_found");
  });
});

describe("a Participant's Visibility", () => {
  it("covers a granted Location's whole subtree", async () => {
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "location", false, [loc.tower1])).toBe("set");
    expect(await setMemberVisibility(consultant.ap, consultantParticipant, consultant.member, "location", true, [])).toBe(
      "set",
    );
    const floor1B = (await migrator.query("select id from dimension_value where parent_id = $1", [loc.buildingB]))
      .rows[0].id;
    expect(await myVisibility(consultant.member, "location")).toEqual(
      sorted(loc.tower1, loc.buildingA, loc.floor1, loc.buildingB, floor1B),
    );
  });

  it("covers nothing of a dimension until it is granted", async () => {
    expect(await myVisibility(consultant.member, "trade")).toEqual([]);
  });

  // RP-233: anyone but a Project Admin gets the answer a made-up id gets, so
  // it never learns that a Participant exists (404, never 403; V15, V16).
  it("is set only by a Project Admin, and answers anyone else as if the Participant didn't exist", async () => {
    for (const as of [host.member, consultant.ap, consultant.member]) {
      for (const participant of [consultantParticipant, hostParticipant, randomUUID()]) {
        expect(await setParticipantVisibility(as, participant, "trade", true, []), `${as} → ${participant}`).toBe(
          "not_found",
        );
      }
    }
  });

  it("rejects a value from another dimension or Project", async () => {
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "trade", false, [loc.tower1])).toBe(
      "value_not_found",
    );
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "trade", false, [randomUUID()])).toBe(
      "value_not_found",
    );
  });
});

describe("a Member's Visibility (V4)", () => {
  beforeAll(async () => {
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "trade", false, [trade.electrical])).toBe("set");
  });

  it("is rejected when it goes beyond the Participant's", async () => {
    const set = (kind: string, isAll: boolean, values: string[]) =>
      setMemberVisibility(consultant.ap, consultantParticipant, consultant.member, kind, isAll, values);
    expect(await set("trade", false, [trade.mechanical])).toBe("exceeds_participant");
    expect(await set("location", false, [loc.tower2])).toBe("exceeds_participant");
    expect(await set("trade", false, [trade.electrical])).toBe("set");
    expect(await set("location", false, [loc.buildingA])).toBe("set");
    expect(await myVisibility(consultant.member, "location")).toEqual(sorted(loc.buildingA, loc.floor1));
  });

  it("is set only by the Participant's own Authorized Person, for its own Project Members", async () => {
    await expect(
      setMemberVisibility(consultant.member, consultantParticipant, consultant.member, "trade", true, []),
    ).rejects.toThrow(/only the Authorized Person/);
    expect(await setMemberVisibility(host.ap, consultantParticipant, consultant.member, "trade", true, [])).toBe(
      "not_found",
    );
    expect(await setMemberVisibility(consultant.ap, consultantParticipant, host.member, "trade", true, [])).toBe(
      "member_not_found",
    );
  });

  it("shrinks with the Participant's when a Project Admin narrows it", async () => {
    expect(await setMemberVisibility(consultant.ap, consultantParticipant, consultant.member, "location", false, [loc.tower1])).toBe("set");
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "location", false, [loc.buildingA])).toBe("set");
    expect(await myVisibility(consultant.member, "location")).toEqual(sorted(loc.buildingA, loc.floor1));
    // Stored as the intersection, so widening the Participant again doesn't widen the Member.
    expect(await setParticipantVisibility(host.ap, consultantParticipant, "location", false, [loc.tower1])).toBe("set");
    expect(await myVisibility(consultant.member, "location")).toEqual(sorted(loc.buildingA, loc.floor1));
  });
});

describe("visibility_grant", () => {
  const grantsSeen = (as: string) =>
    withMember(app, as, (trx) =>
      sql<{ participant_id: string; project_member_id: string | null }>`
        select participant_id, project_member_id from visibility_grant
      `
        .execute(trx)
        .then((r) => r.rows),
    );

  it("shows a Participant's Members only their own Participant's grants", async () => {
    const seen = await grantsSeen(consultant.member);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((g) => g.participant_id === consultantParticipant)).toBe(true);
    expect((await grantsSeen(host.member)).some((g) => g.participant_id === consultantParticipant)).toBe(false);
  });

  it("shows a Project Admin other Participants' grants, never their Members'", async () => {
    const seen = await grantsSeen(host.ap);
    expect(seen.some((g) => g.participant_id === consultantParticipant && g.project_member_id === null)).toBe(true);
    expect(seen.some((g) => g.participant_id === consultantParticipant && g.project_member_id !== null)).toBe(false);
  });

  it("shows grant values by the same rule", async () => {
    const values = (as: string) =>
      withMember(app, as, (trx) =>
        sql<{ grant_id: string }>`select grant_id from visibility_grant_value`.execute(trx).then((r) => r.rows.length),
      );
    expect(await values(host.member)).toBe(0);
    expect(await values(consultant.member)).toBeGreaterThan(0);
  });
});

describe("the Visibility read functions", () => {
  const grants = (as: string, participant: string) =>
    withMember(app, as, (trx) =>
      sql<{ kind: string }>`select kind from app.participant_grants(${participant}::uuid)`
        .execute(trx)
        .then((r) => r.rows.map((x) => x.kind).sort()),
    );

  it("show a Participant's Visibility to its own Company and the Project Admins only", async () => {
    expect(await grants(consultant.member, consultantParticipant)).toEqual(["location", "trade"]);
    expect(await grants(host.ap, consultantParticipant)).toEqual(["location", "trade"]);
    expect(await grants(host.member, consultantParticipant)).toEqual([]);
    expect(await grants(consultant.member, hostParticipant)).toEqual([]);
  });

  it("give an Authorized Person not on the Project their Participant's covered values, and no other", async () => {
    const ap = consultant.ap;
    const onProject = await migrator.query(
      "select 1 from project_member where member_id = $1 and project_id = $2",
      [ap, projectId],
    );
    expect(onProject.rowCount).toBe(0);
    const tableRows = await withMember(app, ap, (trx) => sql`select id from dimension_value`.execute(trx));
    expect(tableRows.rows).toEqual([]);
    const covered = await withMember(app, ap, (trx) =>
      sql<{ id: string }>`select id from app.participant_covered_values(${consultantParticipant}::uuid) where kind = 'trade'`
        .execute(trx)
        .then((r) => r.rows.map((x) => x.id)),
    );
    expect(covered).toEqual([trade.electrical]);
  });

  it("give the member grants only to the Participant's own Company", async () => {
    const memberGrants = (as: string) =>
      withMember(app, as, (trx) =>
        sql<{ kind: string }>`select kind from app.member_grants(${consultantParticipant}::uuid, ${consultant.member}::uuid)`
          .execute(trx)
          .then((r) => r.rows.length),
      );
    expect(await memberGrants(consultant.ap)).toBe(2);
    expect(await memberGrants(host.ap)).toBe(0);
  });
});

describe("a Closed Project", () => {
  it("can't have its Trades, Locations or Visibility changed", async () => {
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [projectId]);
    try {
      expect((await addValue(host.ap, "trade", "CV")).outcome).toBe("project_closed");
      expect(await setParticipantVisibility(host.ap, consultantParticipant, "trade", true, [])).toBe("project_closed");
      expect(await setMemberVisibility(consultant.ap, consultantParticipant, consultant.member, "trade", true, [])).toBe(
        "project_closed",
      );
    } finally {
      await migrator.query("update project set status = 'active', closed_at = null where id = $1", [projectId]);
    }
  });
});
