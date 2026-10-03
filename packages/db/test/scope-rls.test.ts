// Seam 2 for Scopes and Sub-scopes (RP-263): a Project Admin defines them under
// the Project's Trades. Every Project Member reads them; an Authorized Person
// not on the Project reads only those of the Trades their Participant covers
// (as V16); nobody else changes them or learns they exist, even when calling the
// database directly as the app role. Scopes never grant or restrict access.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const bilingual = (text: string) => ({ en: text, ar: `${text} ع` });

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let host: Company; // Its Authorized Person created Project A and is its Project Admin.
let consultant: Company; // A Participant of Project A; its Authorized Person is not on it.
let other: Company; // Its Authorized Person created Project B; it has nothing to do with Project A.
let projectA = "";
let projectB = "";
let consultantParticipant = "";
const trade = { electrical: "", mechanical: "", otherProject: "" };
let tower1 = "";

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

const createProject = (as: string, code: string) =>
  withMember(app, as, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`
      .execute(trx)
      .then((r) => r.rows[0]!.project_id),
  );

async function dimensionValue(as: string, project: string, kind: "trade" | "location", code: string) {
  const { rows } = await withMember(app, as, (trx) =>
    sql<{ outcome: string; value_id: string }>`
      select outcome, value_id from app.add_dimension_value(
        ${project}::uuid, ${kind}, null, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)
    `.execute(trx),
  );
  expect(rows[0]!.outcome).toBe("added");
  return rows[0]!.value_id;
}

async function addScope(as: string, project: string, tradeId: string, name: string, parentId: string | null = null) {
  const { rows } = await withMember(app, as, (trx) =>
    sql<{ outcome: string; scope_id: string | null }>`
      select outcome, scope_id from app.add_scope(
        ${project}::uuid, ${tradeId}::uuid, ${parentId}::uuid, ${JSON.stringify(bilingual(name))}::jsonb)
    `.execute(trx),
  );
  return rows[0]!;
}

async function scope(tradeId: string, name: string, parentId: string | null = null, project = projectA, as = host.ap) {
  const added = await addScope(as, project, tradeId, name, parentId);
  expect(added.outcome).toBe("added");
  return added.scope_id!;
}

const updateScope = (as: string, scopeId: string, change: { name?: string; active?: boolean }) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string }>`
      select app.update_scope(
        ${scopeId}::uuid,
        ${change.name === undefined ? null : JSON.stringify(bilingual(change.name))}::jsonb,
        ${change.active ?? null}::boolean,
        now()) as outcome
    `
      .execute(trx)
      .then((r) => r.rows[0]!.outcome),
  );

type ScopeRow = { id: string; trade_value_id: string; parent_id: string | null; name: { en: string }; status: string };

/** The scope rows the Member reads straight from the table. */
const scopesSeen = (as: string) =>
  withMember(app, as, (trx) =>
    sql<ScopeRow>`select id, trade_value_id, parent_id, name, status from scope`.execute(trx).then((r) => r.rows),
  );

const stored = async (scopeId: string) =>
  (await migrator.query("select name, status from scope where id = $1", [scopeId])).rows[0] as {
    name: { en: string };
    status: string;
  };

const sorted = (...ids: string[]) => [...ids].sort();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  host = await company(engineer, "Host");
  consultant = await company(engineer, "Consultant");
  other = await company(engineer, "Other");
  app = createDb(urls.app, { max: 2 });

  projectA = await createProject(host.ap, "PRA");
  projectB = await createProject(other.ap, "PRB");
  const hostParticipant = (await migrator.query("select id from participant where project_id = $1", [projectA])).rows[0]
    .id;
  consultantParticipant = await joinProject(app, projectA, { adminId: host.ap, crNumber: consultant.cr, role: "consultant" }, consultant.ap);
  const addProjectMember = (as: string, participant: string, member: string) =>
    withMember(app, as, (trx) => sql`select app.add_project_member(${participant}::uuid, ${member}::uuid, now())`.execute(trx));
  await addProjectMember(host.ap, hostParticipant, host.member);
  await addProjectMember(consultant.ap, consultantParticipant, consultant.member);

  trade.electrical = await dimensionValue(host.ap, projectA, "trade", "EL");
  trade.mechanical = await dimensionValue(host.ap, projectA, "trade", "ME");
  tower1 = await dimensionValue(host.ap, projectA, "location", "T1");
  trade.otherProject = await dimensionValue(other.ap, projectB, "trade", "EL");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Scopes and Sub-scopes", () => {
  let lighting = "";
  let indoor = "";
  let hvac = "";

  beforeAll(async () => {
    lighting = await scope(trade.electrical, "Lighting");
    indoor = await scope(trade.electrical, "Indoor lighting", lighting);
    hvac = await scope(trade.mechanical, "HVAC");
  });

  it("sit under a Trade of the Project, Sub-scopes under a Scope", async () => {
    const seen = await scopesSeen(host.member);
    expect(seen.find((s) => s.id === lighting)).toMatchObject({ trade_value_id: trade.electrical, parent_id: null, status: "active" });
    expect(seen.find((s) => s.id === indoor)).toMatchObject({ trade_value_id: trade.electrical, parent_id: lighting });
    expect(seen.find((s) => s.id === hvac)).toMatchObject({ trade_value_id: trade.mechanical, parent_id: null });
  });

  it("go two levels deep, and a Sub-scope stays in its Scope's Trade", async () => {
    expect((await addScope(host.ap, projectA, trade.electrical, "Too deep", indoor)).outcome).toBe("parent_not_found");
    expect((await addScope(host.ap, projectA, trade.mechanical, "Wrong Trade", lighting)).outcome).toBe("parent_not_found");
    expect((await addScope(host.ap, projectA, trade.electrical, "Made up", randomUUID())).outcome).toBe("parent_not_found");
  });

  it("need a Trade of this Project", async () => {
    expect((await addScope(host.ap, projectA, tower1, "A Location")).outcome).toBe("trade_not_found");
    expect((await addScope(host.ap, projectA, trade.otherProject, "Another Project's")).outcome).toBe("trade_not_found");
    expect((await addScope(host.ap, projectA, randomUUID(), "Made up")).outcome).toBe("trade_not_found");
  });

  it("are renamed, deactivated and reactivated by a Project Admin, and never deleted", async () => {
    const pumps = await scope(trade.mechanical, "Pumps");
    expect(await updateScope(host.ap, pumps, { name: "Pumps and valves" })).toBe("updated");
    expect(await stored(pumps)).toEqual({ name: bilingual("Pumps and valves"), status: "active" });
    expect(await updateScope(host.ap, pumps, { active: false })).toBe("updated");
    expect(await stored(pumps)).toEqual({ name: bilingual("Pumps and valves"), status: "deactivated" });
    // Still there for the Work Items that already use it.
    expect((await scopesSeen(consultant.member)).find((s) => s.id === pumps)?.status).toBe("deactivated");
    expect(await updateScope(host.ap, pumps, { active: true })).toBe("updated");
    expect((await stored(pumps)).status).toBe("active");
  });

  it("take no new Sub-scopes under a deactivated Scope", async () => {
    const cabling = await scope(trade.electrical, "Cabling");
    expect(await updateScope(host.ap, cabling, { active: false })).toBe("updated");
    expect((await addScope(host.ap, projectA, trade.electrical, "Trays", cabling)).outcome).toBe("parent_not_found");
  });

  it("reactivate a Sub-scope only once its Scope is active again", async () => {
    const earthing = await scope(trade.electrical, "Earthing");
    const rods = await scope(trade.electrical, "Rods", earthing);
    expect(await updateScope(host.ap, rods, { active: false })).toBe("updated");
    expect(await updateScope(host.ap, earthing, { active: false })).toBe("updated");
    expect(await updateScope(host.ap, rods, { active: true })).toBe("parent_deactivated");
    // Renaming it is still fine.
    expect(await updateScope(host.ap, rods, { name: "Earth rods" })).toBe("updated");
    expect(await updateScope(host.ap, earthing, { active: true })).toBe("updated");
    expect(await updateScope(host.ap, rods, { active: true })).toBe("updated");
  });

  it("never nest a Sub-scope under a Sub-scope, however the row is written", async () => {
    await expect(
      migrator.query(
        "insert into scope (project_id, trade_value_id, parent_id, depth, name) values ($1, $2, $3, 2, $4)",
        [projectA, trade.electrical, indoor, JSON.stringify(bilingual("Too deep"))],
      ),
    ).rejects.toThrow(/scope_parent_fk/);
  });

  // A 404 that names nothing: anyone but the Project's Project Admins gets the
  // answer a made-up id gets, whether or not they are on the Project.
  it("are changed only by a Project Admin, and answer anyone else as if they didn't exist", async () => {
    for (const as of [host.member, consultant.ap, consultant.member, other.ap]) {
      expect((await addScope(as, projectA, trade.electrical, "Sneaky")).outcome, as).toBe("not_found");
      expect((await addScope(as, projectA, trade.electrical, "Sneaky", lighting)).outcome, as).toBe("not_found");
      for (const scopeId of [lighting, indoor, randomUUID()]) {
        expect(await updateScope(as, scopeId, { name: "Sneaky" }), `${as} → ${scopeId}`).toBe("not_found");
        expect(await updateScope(as, scopeId, { active: false }), `${as} → ${scopeId}`).toBe("not_found");
      }
    }
    expect(await stored(lighting)).toEqual({ name: bilingual("Lighting"), status: "active" });
    expect(await updateScope(host.ap, randomUUID(), { name: "Made up" })).toBe("not_found");
  });

  it("can't be written by the app role directly", async () => {
    await expect(
      withMember(app, host.ap, (trx) => sql`update scope set status = 'deactivated' where id = ${lighting}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  describe("of another Project", () => {
    let otherScope = "";
    beforeAll(async () => {
      otherScope = await scope(trade.otherProject, "Lighting", null, projectB, other.ap);
    });

    it("are never returned to a Member of Project A", async () => {
      for (const as of [host.ap, host.member, consultant.ap, consultant.member]) {
        const seen = await scopesSeen(as);
        expect(seen.some((s) => s.id === otherScope), as).toBe(false);
      }
      expect((await scopesSeen(other.ap)).map((s) => s.id)).toEqual([otherScope]);
    });

    it("can't be changed by Project A's Project Admin", async () => {
      expect(await updateScope(host.ap, otherScope, { name: "Mine now" })).toBe("not_found");
      expect((await addScope(host.ap, projectA, trade.electrical, "Borrowed", otherScope)).outcome).toBe("parent_not_found");
    });
  });

  describe("for an Authorized Person who isn't a Project Member", () => {
    const covered = (as: string, participant = consultantParticipant) =>
      withMember(app, as, (trx) =>
        sql<{ id: string }>`select id from app.participant_scopes(${participant}::uuid)`
          .execute(trx)
          .then((r) => r.rows.map((x) => x.id).sort()),
      );

    beforeAll(async () => {
      const { rows } = await withMember(app, host.ap, (trx) =>
        sql<{ outcome: string }>`
          select app.set_participant_visibility(${consultantParticipant}::uuid, 'trade', false, ${[trade.electrical]}::uuid[], now()) as outcome
        `.execute(trx),
      );
      expect(rows[0]!.outcome).toBe("set");
    });

    it("are only those of the Trades their Participant covers", async () => {
      const onProject = await migrator.query("select 1 from project_member where member_id = $1 and project_id = $2", [
        consultant.ap,
        projectA,
      ]);
      expect(onProject.rowCount).toBe(0);
      expect(await scopesSeen(consultant.ap)).toEqual([]);
      const electrical = (await migrator.query("select id from scope where trade_value_id = $1", [trade.electrical])).rows;
      expect(await covered(consultant.ap)).toEqual(sorted(...electrical.map((r: { id: string }) => r.id)));
      expect(await covered(consultant.ap)).toContain(indoor);
      expect(await covered(consultant.ap)).not.toContain(hvac);
    });

    it("are nobody else's to read through it", async () => {
      // Its own Company's, and the Project's Project Admins: the V16 line.
      expect(await covered(host.ap)).toContain(lighting);
      for (const as of [host.member, other.ap, other.member]) {
        expect(await covered(as), as).toEqual([]);
      }
      expect(await covered(consultant.ap, randomUUID())).toEqual([]);
    });
  });

  it("can't be changed on a Closed Project", async () => {
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [projectA]);
    try {
      expect((await addScope(host.ap, projectA, trade.electrical, "Late")).outcome).toBe("project_closed");
      expect(await updateScope(host.ap, lighting, { name: "Late" })).toBe("project_closed");
    } finally {
      await migrator.query("update project set status = 'active', closed_at = null where id = $1", [projectA]);
    }
  });
});
