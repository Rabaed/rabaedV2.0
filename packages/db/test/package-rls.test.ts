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

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const statusOf = async (as: string, id: string) =>
  (await call<{ status: string }>(as, sql`select status from package where id = ${id}::uuid`))[0]?.status;

describe("Submit Package (RP-638): the status follows the items", () => {
  let packageId = "";
  let sent = "";
  let left = "";

  beforeAll(async () => {
    packageId = (await createPackage(c1Pm, "Submitted together")).package_id;
    [sent, left] = [await draft(c1.member, "Sent"), await draft(c1.member, "Left")];
    for (const item of [sent, left]) {
      expect(await take(c1.member, item, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, item)).toBe("picked_up");
      expect(await addItem(c1Pm, packageId, item)).toBe("added");
    }
  });

  it("an item Submitted through app.take_transition makes it In Progress, in the same transaction; then no removal, no delete", async () => {
    expect(await statusOf(c1Pm, packageId)).toBe("open");
    expect(await take(c1Pm, sent, "submit")).toBe("applied");
    expect(await statusOf(c1Pm, packageId)).toBe("in_progress");
    expect(await outcome(c1Pm, sql`select app.remove_package_item(${packageId}::uuid, ${left}::uuid, now()) as outcome`)).toBe("package_not_open");
    expect(await outcome(c1Pm, sql`select app.discard_package(${packageId}::uuid, now()) as outcome`)).toBe("package_not_open");
    // Adding stays open to it.
    expect(await addItem(c1Pm, packageId, await draft(c1Pm, "Added late"))).toBe("added");
  });

  it("is written only by the database: no status write, no call of its recompute, and no trail for anyone outside C1", async () => {
    const refused = async (as: string, query: ReturnType<typeof sql>) =>
      expect(withMember(app, as, (trx) => query.execute(trx))).rejects.toThrow(/permission denied/);
    await refused(c1Pm, sql`update package set status = 'open' where id = ${packageId}::uuid`);
    await refused(c1Pm, sql`select app.recompute_package_status(${packageId}::uuid)`);
    await refused(c1Pm, sql`select app.write_package_event(${packageId}::uuid, 'submitted', null, '{}'::jsonb, now())`);
    for (const who of [k1.member, c2.member, ow.member]) {
      const [begun] = await call<{ outcome: string }>(who, sql`select outcome from app.begin_package_submit(${packageId}::uuid, ${randomUUID()}::uuid)`);
      expect(begun!.outcome).toBe("not_found");
      expect(
        await outcome(who, sql`select app.record_package_submit(${packageId}::uuid, ${[sent]}::uuid[], ${randomUUID()}::uuid, now()) as outcome`),
      ).toBe("not_found");
      expect((await call<{ hides: boolean }>(who, sql`select app.package_hides_unsubmitted(${packageId}::uuid) as hides`))[0]!.hides).toBe(false);
    }
    // C1 records only items of the Package that have been Submitted.
    expect(
      await outcome(c1Pm, sql`select app.record_package_submit(${packageId}::uuid, ${[left]}::uuid[], ${randomUUID()}::uuid, now()) as outcome`),
    ).toBe("item_not_submitted");
  });
});

describe("RP-641: who sees a Submitted Package, and each viewer's counts (scenarios RP-588-2, RP-588-3)", () => {
  let packageId = "";
  let mechanical = "";
  let k1Narrowed = ""; // A K1 engineer who sees Electrical only.
  const electricalItems: string[] = [];
  const mechanicalItems: string[] = [];

  /** A Draft of the test submittal Type in Trade `trade`, raised by C1's engineer. */
  async function draftIn(trade: string, title: string): Promise<string> {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
        ${trade}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }

  /** K1 closes item `id` with Code `code` (A or C): its engineer sends it to its manager, who codes it. */
  async function code(id: string, transition: "approve_a" | "revise_c") {
    await pickUp(k1.member, id);
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    await pickUp(k1.ap, id);
    expect(await take(k1.ap, id, transition)).toBe("applied");
  }

  const summary = (as: string) =>
    call<{ total: number; open: number; codes: Record<string, number> }>(as, sql`select total, open, codes from app.package_summary(${packageId}::uuid)`);
  const ownerName = async (as: string) =>
    (await call<{ name: { en: string } | null }>(as, sql`select app.package_owner_name(${packageId}::uuid) as name`))[0]!.name;

  beforeAll(async () => {
    mechanical = (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'ME', ${JSON.stringify({ en: "ME", ar: "ME" })}::jsonb)`,
      )
    )[0]!.value_id;
    const k1Participant = (await migrator.query("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id])).rows[0]
      .id as string;
    k1Narrowed = await member(k1.id, "narrowed");
    await call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1Participant}::uuid, ${k1Narrowed}::uuid, now())`);
    expect(
      await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${k1Narrowed}::uuid, 'trade', false, ${[electrical]}::uuid[], now()) as outcome`),
    ).toBe("set");
    expect(
      await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${k1Narrowed}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`),
    ).toBe("set");
    expect(
      await outcome(k1.ap, sql`select app.set_project_member_positions(${k1Participant}::uuid, ${k1Narrowed}::uuid, ${["engineer"]}::text[]) as outcome`),
    ).toBe("set");

    packageId = (await createPackage(c1Pm, "Electrical and Mechanical")).package_id;
    for (let i = 1; i <= 6; i++) electricalItems.push(await draftIn(electrical, `EL ${i}`));
    for (let i = 1; i <= 2; i++) mechanicalItems.push(await draftIn(mechanical, `ME ${i}`));
    for (const item of [...electricalItems, ...mechanicalItems]) {
      expect(await take(c1.member, item, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, item)).toBe("picked_up");
      expect(await addItem(c1Pm, packageId, item)).toBe("added");
    }
    // Submit Package takes each item's own Submit (RP-638): here one by one, as the api does in one transaction.
    for (const item of [...electricalItems, ...mechanicalItems]) expect(await take(c1Pm, item, "submit")).toBe("applied");
    await code(electricalItems[0]!, "approve_a");
    await code(mechanicalItems[0]!, "revise_c");
    electricalItems.sort();
  });

  it("RP-588-2: K1's manager (Visibility all) counts 8; its engineer narrowed to Electrical counts 6, never the Mechanical items", async () => {
    for (const who of [c1Pm, k1.ap, k1.member]) {
      expect(await summary(who)).toEqual([{ total: 8, open: 6, codes: { A: 1, C: 1 } }]);
    }
    expect(await summary(k1Narrowed)).toEqual([{ total: 6, open: 5, codes: { A: 1 } }]);
    const reads = await readsOf(k1Narrowed, packageId, mechanicalItems);
    expect(reads).toEqual({ rows: [{ id: packageId }], sees: true, items: electricalItems, itemPackages: [] });
    // The overall status, from all its items, as one word.
    expect(await statusOf(k1Narrowed, packageId)).toBe("in_progress");
    expect((await readsOf(k1Narrowed, packageId, electricalItems)).itemPackages).toHaveLength(6);
  });

  it("RP-588-3: C2 sees none of its items and reads nothing of it, while K1 and the Owner do", async () => {
    expect(await readsOf(c2.member, packageId, electricalItems)).toEqual({ rows: [], sees: false, items: [], itemPackages: [] });
    expect(await call(c2.member, sql<{ id: string }>`select id from package where project_id = ${projectId}::uuid`)).toEqual([]);
    expect(await summary(c2.member)).toEqual([]);
    expect(await ownerName(c2.member)).toBeNull();
    for (const who of [k1.member, k1.ap, k1Narrowed, ow.member]) {
      expect((await readsOf(who, packageId, [])).sees, who).toBe(true);
      // The owner by its Company's name, for every viewer of the Package.
      expect((await ownerName(who))?.en).toBe("C1");
    }
  });

  it("K1 sees it but changes nothing of it: every write is the owner's alone, the same 'not_found'", async () => {
    for (const who of [k1.ap, k1Narrowed, ow.member]) {
      expect(await outcome(who, sql`select app.rename_package(${packageId}::uuid, ${JSON.stringify(name("Mine now"))}::jsonb, now()) as outcome`)).toBe(
        "not_found",
      );
      expect(await addItem(who, packageId, electricalItems[1]!)).toBe("not_found");
      expect(await outcome(who, sql`select app.remove_package_item(${packageId}::uuid, ${electricalItems[1]}::uuid, now()) as outcome`)).toBe("not_found");
      expect(await outcome(who, sql`select app.discard_package(${packageId}::uuid, now()) as outcome`)).toBe("not_found");
      const [begun] = await call<{ outcome: string }>(who, sql`select outcome from app.begin_package_submit(${packageId}::uuid, ${randomUUID()}::uuid)`);
      expect(begun!.outcome).toBe("not_found");
      expect((await call<{ hides: boolean }>(who, sql`select app.package_hides_unsubmitted(${packageId}::uuid) as hides`))[0]!.hides).toBe(false);
      expect((await call<{ owns: boolean }>(who, sql`select app.owns_package(${packageId}::uuid) as owns`))[0]!.owns).toBe(false);
    }
    expect((await call<{ owns: boolean }>(c1.member, sql`select app.owns_package(${packageId}::uuid) as owns`))[0]!.owns).toBe(true);
    expect(await call(c1Pm, sql<{ name: unknown }>`select name from package where id = ${packageId}::uuid`)).toEqual([{ name: name("Electrical and Mechanical") }]);
  });
});

describe("RP-642: Done follows the closures, in the same transaction, and a Revision joins by itself", () => {
  let packageId = "";
  let item = "";

  /** C1 Submits `id`; K1's engineer sends it to K1's manager, who picks it up. */
  async function atK1Manager(id: string) {
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.ap, id)).toBe("picked_up");
  }

  beforeAll(async () => {
    packageId = (await createPackage(c1Pm, "Closed together")).package_id;
    item = await draft(c1.member, "Coded");
    expect(await addItem(c1.member, packageId, item)).toBe("added");
    await atK1Manager(item);
  });

  it("a Code C closes the item and keeps it In Progress; its Revision joins the Package; Code A on it makes it Done", async () => {
    expect(await take(k1.ap, item, "revise_c")).toBe("applied");
    expect(await statusOf(c1Pm, packageId)).toBe("in_progress");
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_revision(${item}::uuid, ${randomUUID()}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    const revision = created!.work_item_id;
    expect((await readsOf(c1.member, packageId, [revision])).itemPackages).toEqual([{ package_id: packageId }]);
    await atK1Manager(revision);
    expect(await take(k1.ap, revision, "approve_a")).toBe("applied");
    expect(await statusOf(c1Pm, packageId)).toBe("done");
  });

  it("is written only by the database: the app role calls none of the triggers' helpers", async () => {
    const refused = async (query: ReturnType<typeof sql>) =>
      expect(withMember(app, c1Pm, (trx) => query.execute(trx))).rejects.toThrow(/permission denied/);
    await refused(sql`select app.recompute_package_status(${packageId}::uuid)`);
    await refused(sql`update package set status = 'in_progress' where id = ${packageId}::uuid`);
    await refused(sql`select package_id from work_item where id = ${item}::uuid`);
  });
});

describe("RP-647: the Package's Comments, only those the caller sees (scenario RP-647-1)", () => {
  const CODE_B = "PKGRB";
  let packageId = "";
  let hvac = ""; // A Trade K1's narrowed engineer doesn't see.
  let k1Narrowed = ""; // A K1 engineer who sees Electrical only.
  let electricalItem = "";
  let hvacItem = "";
  let commentOf = new Map<string, string[]>(); // Each item's Comments, by the migrator.

  /** A Draft of the Code B Type in Trade `trade`, raised by C1's engineer. */
  async function draftB(trade: string, title: string): Promise<string> {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${CODE_B}, ${title}, app.latest_form_version(${CODE_B}), ${JSON.stringify({ model: title })}::jsonb,
        ${trade}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }

  /** K1 closes Submitted item `id` with Code B, a Comment per row. */
  async function codeB(id: string, rows: string[]) {
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.ap, id)).toBe("picked_up");
    const answers = JSON.stringify({ items_to_create: rows.map((comment) => ({ comment })) });
    expect(
      await outcome(
        k1.ap,
        sql`select app.take_transition(${id}::uuid, 'approve_b', ${answers}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
      ),
    ).toBe("applied");
  }

  const comments = (as: string) =>
    call<{ work_item_id: string; raised_from_id: string }>(
      as,
      sql`select work_item_id, raised_from_id from app.package_comments(${packageId}::uuid) order by raised_from_id, work_item_id`,
    );
  const expected = (...items: string[]) =>
    items.flatMap((i) => commentOf.get(i)!.map((c) => ({ work_item_id: c, raised_from_id: i }))).sort((a, b) =>
      a.raised_from_id === b.raised_from_id ? (a.work_item_id < b.work_item_id ? -1 : 1) : a.raised_from_id < b.raised_from_id ? -1 : 1,
    );

  beforeAll(async () => {
    const workflowId = await addTestWorkflow((text) => migrator.query(text), { withApproveB: true });
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', 'submittals', $1, '{"en": "Package Code B (test)", "ar": "حزمة"}', $2, 'review_code', form_definition_id
       from work_item_type where code = $3`,
      [CODE_B, workflowId, TYPE],
    );
    hvac = (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'HV', ${JSON.stringify({ en: "HV", ar: "HV" })}::jsonb)`,
      )
    )[0]!.value_id;
    const k1Participant = (await migrator.query("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id])).rows[0]
      .id as string;
    k1Narrowed = await member(k1.id, "narrowed-b");
    await call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1Participant}::uuid, ${k1Narrowed}::uuid, now())`);
    for (const [kind, isAll, values] of [
      ["trade", false, [electrical]],
      ["location", true, []],
    ] as const) {
      expect(
        await outcome(
          k1.ap,
          sql`select app.set_member_visibility(${k1Participant}::uuid, ${k1Narrowed}::uuid, ${kind}, ${isAll}, ${values}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
    }
    expect(
      await outcome(k1.ap, sql`select app.set_project_member_positions(${k1Participant}::uuid, ${k1Narrowed}::uuid, ${["engineer"]}::text[]) as outcome`),
    ).toBe("set");

    packageId = (await createPackage(c1Pm, "With Comments")).package_id;
    electricalItem = await draftB(electrical, "Code B EL");
    hvacItem = await draftB(hvac, "Code B HV");
    const loose = await draftB(electrical, "Code B in no Package");
    for (const item of [electricalItem, hvacItem, loose]) {
      expect(await take(c1.member, item, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, item)).toBe("picked_up");
      if (item !== loose) expect(await addItem(c1Pm, packageId, item)).toBe("added");
      expect(await take(c1Pm, item, "submit")).toBe("applied");
    }
    await codeB(electricalItem, ["EL one", "EL two"]);
    await codeB(hvacItem, ["HV one"]);
    await codeB(loose, ["Loose one"]);
    const { rows } = await migrator.query<{ to_id: string; from_id: string }>(
      "select to_id, from_id from work_item_link where kind = 'raised_from' and to_id = any($1::uuid[])",
      [[electricalItem, hvacItem]],
    );
    commentOf = new Map([electricalItem, hvacItem].map((i) => [i, rows.filter((r) => r.to_id === i).map((r) => r.from_id)]));
    expect(commentOf.get(electricalItem)).toHaveLength(2);
  });

  it("C1, K1 and the Owner read every Comment raised from its items, each with its item; never one of an item outside it", async () => {
    for (const who of [c1Pm, c1.member, k1.ap, k1.member, ow.member]) expect(await comments(who), who).toEqual(expected(electricalItem, hvacItem));
  });

  it("RP-647-1: K1's engineer narrowed to Electrical reads the Electrical item's Comments only; C2 reads none", async () => {
    expect(await comments(k1Narrowed)).toEqual(expected(electricalItem));
    expect(await comments(c2.member)).toEqual([]);
    // A Comment is not in the Package: no package_id, so not among its items or in its counts.
    const [counted] = await call<{ total: number; codes: Record<string, number> }>(c1Pm, sql`select total, codes from app.package_summary(${packageId}::uuid)`);
    expect(counted).toEqual({ total: 2, codes: { B: 2 } });
    expect(await statusOf(c1Pm, packageId)).toBe("done");
  });
});
