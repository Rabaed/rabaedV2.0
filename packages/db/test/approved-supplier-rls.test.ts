// Seam 2 for the Approved Supplier List (RP-592, V10; scenario RP-592-1): a
// Project's register of suppliers per Trade. Every Project Member of every
// Participant reads its names, Trade, Scope and status; never what put a
// supplier there (`source`, `source_work_item_id`) nor who added or withdrew it,
// even calling the database directly as the app role. Only the Project's
// Project Admins add or withdraw one; anyone else gets 'not_found', exactly like
// a made-up id.
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
let consultant: Company; // A Participant of Project A; its plain Member is a Project Member.
let other: Company; // Its Authorized Person created Project B; nothing to do with Project A.
let projectA = "";
let projectB = "";
const trade = { electrical: "", mechanical: "", otherProject: "" };
let tower1 = "";
const scope = { lighting: "", hvac: "", otherProject: "" };

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

async function addScope(as: string, project: string, tradeId: string, name: string) {
  const { rows } = await withMember(app, as, (trx) =>
    sql<{ outcome: string; scope_id: string }>`
      select outcome, scope_id from app.add_scope(${project}::uuid, ${tradeId}::uuid, null, ${JSON.stringify(bilingual(name))}::jsonb)
    `.execute(trx),
  );
  expect(rows[0]!.outcome).toBe("added");
  return rows[0]!.scope_id;
}

const addSupplier = (as: string, project: string, tradeId: string, name: string, scopeId: string | null = null) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string; supplier_id: string | null }>`
      select outcome, supplier_id from app.add_approved_supplier(
        ${project}::uuid, ${tradeId}::uuid, ${scopeId}::uuid, ${JSON.stringify(bilingual(name))}::jsonb, now())
    `
      .execute(trx)
      .then((r) => r.rows[0]!),
  );

async function supplier(tradeId: string, name: string, scopeId: string | null = null, project = projectA, as = host.ap) {
  const added = await addSupplier(as, project, tradeId, name, scopeId);
  expect(added.outcome).toBe("added");
  return added.supplier_id!;
}

const withdraw = (as: string, supplierId: string) =>
  withMember(app, as, (trx) =>
    sql<{ outcome: string }>`select app.withdraw_approved_supplier(${supplierId}::uuid, now()) as outcome`
      .execute(trx)
      .then((r) => r.rows[0]!.outcome),
  );

type SupplierRow = { id: string; project_id: string; name: { en: string }; trade_value_id: string; scope_id: string | null; status: string };

/** The rows the Member reads straight from the table, through its row-level security and column grants. */
const suppliersSeen = (as: string) =>
  withMember(app, as, (trx) =>
    sql<SupplierRow>`select id, project_id, name, trade_value_id, scope_id, status from approved_supplier`.execute(trx).then((r) => r.rows),
  );

const stored = async (supplierId: string) =>
  (await migrator.query("select status, source, added_by_member_id, withdrawn_by_member_id from approved_supplier where id = $1", [supplierId]))
    .rows[0] as { status: string; source: string; added_by_member_id: string | null; withdrawn_by_member_id: string | null };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  host = await company(engineer, "Host");
  consultant = await company(engineer, "Consultant");
  other = await company(engineer, "Other");
  app = createDb(urls.app, { max: 2 });

  projectA = await createProject(host.ap, "ASA");
  projectB = await createProject(other.ap, "ASB");
  const hostParticipant = (await migrator.query("select id from participant where project_id = $1", [projectA])).rows[0].id;
  const consultantParticipant = await joinProject(app, projectA, { adminId: host.ap, crNumber: consultant.cr, role: "consultant" }, consultant.ap);
  const addProjectMember = (as: string, participant: string, member: string) =>
    withMember(app, as, (trx) => sql`select app.add_project_member(${participant}::uuid, ${member}::uuid, now())`.execute(trx));
  await addProjectMember(host.ap, hostParticipant, host.member);
  await addProjectMember(consultant.ap, consultantParticipant, consultant.member);

  trade.electrical = await dimensionValue(host.ap, projectA, "trade", "EL");
  trade.mechanical = await dimensionValue(host.ap, projectA, "trade", "ME");
  tower1 = await dimensionValue(host.ap, projectA, "location", "T1");
  trade.otherProject = await dimensionValue(other.ap, projectB, "trade", "EL");
  scope.lighting = await addScope(host.ap, projectA, trade.electrical, "Lighting");
  scope.hvac = await addScope(host.ap, projectA, trade.mechanical, "HVAC");
  scope.otherProject = await addScope(other.ap, projectB, trade.otherProject, "Lighting");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("The Approved Supplier List (RP-592-1)", () => {
  let najd = "";
  let rimal = "";

  beforeAll(async () => {
    najd = await supplier(trade.electrical, "Najd Electrical Supplies", scope.lighting);
    rimal = await supplier(trade.mechanical, "Al-Rimal Building Materials");
  });

  it("is read by every Project Member of every Participant: name, Trade, Scope and status", async () => {
    for (const as of [host.ap, host.member, consultant.member]) {
      const seen = await suppliersSeen(as);
      expect(seen.find((s) => s.id === najd), as).toEqual({
        id: najd,
        project_id: projectA,
        name: bilingual("Najd Electrical Supplies"),
        trade_value_id: trade.electrical,
        scope_id: scope.lighting,
        status: "approved",
      });
      expect(seen.find((s) => s.id === rimal)?.scope_id, as).toBeNull();
    }
  });

  it("records a supplier added by hand as preloaded, by its Project Admin", async () => {
    expect(await stored(najd)).toMatchObject({ status: "approved", source: "preloaded", added_by_member_id: host.ap });
  });

  it("never gives the app role what put a supplier there, nor who added or withdrew it", async () => {
    for (const column of ["source", "source_work_item_id", "added_by_member_id", "added_at", "withdrawn_by_member_id", "withdrawn_at"]) {
      await expect(
        withMember(app, host.ap, (trx) => sql.raw(`select ${column} from approved_supplier`).execute(trx)),
        column,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(withMember(app, host.member, (trx) => sql`select * from approved_supplier`.execute(trx))).rejects.toThrow(/permission denied/);
  });

  it("is never returned to a Member of another Project, nor another Project's to this one's", async () => {
    const otherSupplier = await supplier(trade.otherProject, "Gulf Cables", scope.otherProject, projectB, other.ap);
    for (const as of [host.ap, host.member, consultant.ap, consultant.member]) {
      expect((await suppliersSeen(as)).some((s) => s.id === otherSupplier), as).toBe(false);
    }
    expect((await suppliersSeen(other.ap)).map((s) => s.id)).toEqual([otherSupplier]);
    expect(await suppliersSeen(other.member)).toEqual([]);
    // An Authorized Person who isn't a Project Member reads nothing of it (layer 2).
    expect(await suppliersSeen(consultant.ap)).toEqual([]);
  });

  it("needs a Trade of this Project, and a Scope of that Trade", async () => {
    expect((await addSupplier(host.ap, projectA, tower1, "A Location")).outcome).toBe("trade_not_found");
    expect((await addSupplier(host.ap, projectA, trade.otherProject, "Another Project's")).outcome).toBe("trade_not_found");
    expect((await addSupplier(host.ap, projectA, randomUUID(), "Made up")).outcome).toBe("trade_not_found");
    expect((await addSupplier(host.ap, projectA, trade.electrical, "Wrong Scope", scope.hvac)).outcome).toBe("scope_not_found");
    expect((await addSupplier(host.ap, projectA, trade.electrical, "Other Scope", scope.otherProject)).outcome).toBe("scope_not_found");
    expect((await addSupplier(host.ap, projectA, trade.electrical, "Made-up Scope", randomUUID())).outcome).toBe("scope_not_found");
  });

  it("holds a supplier once per Trade while it is approved", async () => {
    expect((await addSupplier(host.ap, projectA, trade.electrical, "Najd Electrical Supplies")).outcome).toBe("supplier_exists");
    expect((await addSupplier(host.ap, projectA, trade.electrical, " najd electrical supplies ")).outcome).toBe("supplier_exists");
    // Another Trade may list it too.
    expect((await addSupplier(host.ap, projectA, trade.mechanical, "Najd Electrical Supplies")).outcome).toBe("added");
  });

  it("is withdrawn by a Project Admin, and the entry stays, withdrawn", async () => {
    const gone = await supplier(trade.electrical, "Old Cables Co");
    expect(await withdraw(host.ap, gone)).toBe("withdrawn");
    expect(await stored(gone)).toMatchObject({ status: "withdrawn", withdrawn_by_member_id: host.ap });
    expect((await suppliersSeen(consultant.member)).find((s) => s.id === gone)?.status).toBe("withdrawn");
    // Withdrawing again changes nothing; adding it again is a new entry.
    expect(await withdraw(host.ap, gone)).toBe("withdrawn");
    expect((await addSupplier(host.ap, projectA, trade.electrical, "Old Cables Co")).outcome).toBe("added");
  });

  // A 404 that names nothing: anyone but the Project's Project Admins gets the
  // answer a made-up id gets, whether or not they are on the Project.
  it("is changed only by a Project Admin, and answers anyone else as if it didn't exist", async () => {
    for (const as of [host.member, consultant.ap, consultant.member, other.ap]) {
      expect((await addSupplier(as, projectA, trade.electrical, "Sneaky")).outcome, as).toBe("not_found");
      for (const id of [najd, randomUUID()]) {
        expect(await withdraw(as, id), `${as} → ${id}`).toBe("not_found");
      }
    }
    expect((await stored(najd)).status).toBe("approved");
    expect(await withdraw(host.ap, randomUUID())).toBe("not_found");
  });

  it("can't be written by the app role directly", async () => {
    await expect(
      withMember(app, host.ap, (trx) => sql`update approved_supplier set status = 'withdrawn' where id = ${najd}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withMember(app, host.ap, (trx) =>
        sql`insert into approved_supplier (project_id, name, trade_value_id, source, status) values (${projectA}::uuid, ${JSON.stringify(bilingual("X"))}::jsonb, ${trade.electrical}::uuid, 'preloaded', 'approved')`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("can't be changed on a Closed Project", async () => {
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [projectA]);
    try {
      expect((await addSupplier(host.ap, projectA, trade.electrical, "Late")).outcome).toBe("project_closed");
      expect(await withdraw(host.ap, najd)).toBe("project_closed");
    } finally {
      await migrator.query("update project set status = 'active', closed_at = null where id = $1", [projectA]);
    }
  });
});
