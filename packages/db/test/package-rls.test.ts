// Seam 2 for Packages (spec RP-616, RP-636; data-model.md package; visibility.md
// scenario RP-588-1), as the app role. A Member of a Participant builds a Package of
// its submittals; while it is Open nobody outside the owning Participant reads
// anything of it: no row, no name, no count, not through `app.sees_package`, the
// Package's items or an item's Package. Membership changes go only through the
// app.* functions.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "PKGRLS";
const name = (text: string) => ({ en: text, ar: `${text} ع` });

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the submittals and owns the Package.
let k1: Company; // Consultant.
let c2: Company; // Another Contractor.
let ow: Company; // Owner.
let c1Pm = "";
let projectId = "";
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, legalName: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: legalName, ar: legalName }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** A Draft of the test submittal Type raised by `as`. */
async function draft(as: string, title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** `as` creates a Package named `text`: its id and sequence number. */
async function createPackage(as: string, text: string, project = projectId): Promise<{ outcome: string; package_id: string; seq: number }> {
  const [row] = await call<{ outcome: string; package_id: string; seq: number }>(
    as,
    sql`select outcome, package_id, seq from app.create_package(${project}::uuid, ${JSON.stringify(name(text))}::jsonb, now())`,
  );
  return row!;
}

const addItem = (as: string, packageId: string, itemId: string) =>
  outcome(as, sql`select app.add_package_item(${packageId}::uuid, ${itemId}::uuid, now()) as outcome`);

/** Everything `as` reads of Package `id`: its row, `app.sees_package`, its items, and the Package of each of `items`. */
async function readsOf(as: string, id: string, items: string[]) {
  return {
    rows: await call<{ id: string }>(as, sql`select id from package where id = ${id}::uuid`),
    sees: (await call<{ sees: boolean }>(as, sql`select app.sees_package(${id}::uuid) as sees`))[0]!.sees,
    items: (await call<{ id: string }>(as, sql`select id from app.package_items(${id}::uuid) as id order by id`)).map((r) => r.id),
    itemPackages: await call<{ package_id: string }>(
      as,
      sql`select p.package_id from unnest(${items}::uuid[]) i cross join lateral app.work_item_package(i) p`,
    ),
  };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text));
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Package (test)", "ar": "الحزمة"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "model", "type": "text", "label": {"en": "Model", "ar": "الطراز"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Package (test)", "ar": "الحزمة"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  ow = await company(engineer, "OW");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'PKR', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1.ap, ["manager"]],
    [c2, participant.c2, c2.member, ["engineer"]],
    [ow, participant.ow, ow.member, ["representative"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-588-1: C1's Open Package of two Drafts is C1's alone", () => {
  let packageId = "";
  let items: string[] = [];

  beforeAll(async () => {
    items = [await draft(c1.member, "Tiles"), await draft(c1.member, "Sanitary ware")];
    const created = await createPackage(c1.member, "Bathrooms – Tower 1");
    expect(created.outcome).toBe("created");
    packageId = created.package_id;
    for (const item of items) expect(await addItem(c1.member, packageId, item)).toBe("added");
  });

  it("C1's Members read it, its two Drafts and each Draft's Package", async () => {
    for (const who of [c1.member, c1Pm]) {
      const reads = await readsOf(who, packageId, items);
      expect(reads.rows).toEqual([{ id: packageId }]);
      expect(reads.sees).toBe(true);
      expect(reads.items).toEqual([...items].sort());
      expect(reads.itemPackages).toEqual([{ package_id: packageId }, { package_id: packageId }]);
    }
  });

  it("is changed only through the functions: no write of a Package, its trail or an item's Package, even by its owner", async () => {
    const refused = async (query: ReturnType<typeof sql>) =>
      expect(withMember(app, c1.member, (trx) => query.execute(trx))).rejects.toThrow(/permission denied/);
    await refused(sql`update package set name = ${JSON.stringify(name("Renamed"))}::jsonb where id = ${packageId}::uuid`);
    await refused(sql`update package set status = 'done' where id = ${packageId}::uuid`);
    await refused(
      sql`insert into package (project_id, participant_id, seq, name, created_by_member_id)
          select project_id, participant_id, 99, name, ${c1.member}::uuid from package where id = ${packageId}::uuid`,
    );
    await refused(sql`delete from package where id = ${packageId}::uuid`);
    await refused(sql`update work_item set package_id = null where id = ${items[0]}::uuid`);
    // The item's Package is read through app.work_item_package only; the trail not at all yet.
    await refused(sql`select package_id from work_item where id = ${items[0]}::uuid`);
    await refused(sql`select id from package_event where package_id = ${packageId}::uuid`);
    await refused(sql`select created_by_member_id, discarded_at from package where id = ${packageId}::uuid`);
  });

  it("K1, C2 and the Owner read nothing of it: no row, no name, no items, no item's Package", async () => {
    for (const who of [k1.member, k1.ap, c2.member, ow.member]) {
      expect(await readsOf(who, packageId, items)).toEqual({ rows: [], sees: false, items: [], itemPackages: [] });
      expect(await call(who, sql<{ id: string }>`select id from package where project_id = ${projectId}::uuid`)).toEqual([]);
    }
  });
});
