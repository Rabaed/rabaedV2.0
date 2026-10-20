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
import { createDb, withMember, type Db, type OutboxHandler } from "../src/index.ts";
import { addTestWorkflow, approveBActionForm, drainOutbox, expectedContentSha256, joinProject, testDatabaseUrls } from "../test-support/index.ts";

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

/** A Draft of the test submittal Type (or of `type`) raised by `as`, in Electrical (or in `trade`). */
async function draft(as: string, title: string, type = TYPE, trade = electrical): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ model: title })}::jsonb,
      ${trade}::uuid, ${buildingA}::uuid, now())`,
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

const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const statusOf = async (as: string, id: string) =>
  (await call<{ status: string }>(as, sql`select status from package where id = ${id}::uuid`))[0]?.status;

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
  let cablesId = ""; // C1's PM's Open Package of a MAR at C1's internal review.
  let cable = "";

  beforeAll(async () => {
    items = [await draft(c1.member, "Tiles"), await draft(c1.member, "Sanitary ware")];
    const created = await createPackage(c1.member, "Bathrooms – Tower 1");
    expect(created.outcome).toBe("created");
    packageId = created.package_id;
    for (const item of items) expect(await addItem(c1.member, packageId, item)).toBe("added");
    cable = await draft(c1.member, "Cable trays");
    expect(await take(c1.member, cable, "send_for_review")).toBe("applied");
    cablesId = (await createPackage(c1Pm, "Cables")).package_id;
    expect(await addItem(c1Pm, cablesId, cable)).toBe("added");
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

  it("RP-588-1: C1's Members read the Open Package \"Cables\", its MAR at C1's internal review and that item's Package", async () => {
    for (const who of [c1.member, c1Pm]) {
      expect(await readsOf(who, cablesId, [cable])).toEqual({ rows: [{ id: cablesId }], sees: true, items: [cable], itemPackages: [{ package_id: cablesId }] });
    }
    expect(await statusOf(c1Pm, cablesId)).toBe("open");
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
      expect(await readsOf(who, cablesId, [cable])).toEqual({ rows: [], sees: false, items: [], itemPackages: [] });
      expect(await call(who, sql<{ id: string }>`select id from package where project_id = ${projectId}::uuid`)).toEqual([]);
    }
  });

  it("RP-588-1: K1, C2 and the Owner change nothing of either Open Package: rename, add, remove, delete and Submit are all 'not_found'", async () => {
    for (const who of [k1.member, k1.ap, c2.member, ow.member]) {
      for (const [id, item] of [
        [packageId, items[0]!],
        [cablesId, cable],
      ] as const) {
        expect(await outcome(who, sql`select app.rename_package(${id}::uuid, ${JSON.stringify(name("Mine now"))}::jsonb, now()) as outcome`), who).toBe(
          "not_found",
        );
        expect(await addItem(who, id, item), who).toBe("not_found");
        expect(await outcome(who, sql`select app.remove_package_item(${id}::uuid, ${item}::uuid, now()) as outcome`), who).toBe("not_found");
        expect(await outcome(who, sql`select app.discard_package(${id}::uuid, now()) as outcome`), who).toBe("not_found");
        const [begun] = await call<{ outcome: string }>(who, sql`select outcome from app.begin_package_submit(${id}::uuid, ${randomUUID()}::uuid)`);
        expect(begun!.outcome, who).toBe("not_found");
      }
    }
    // Nothing moved: C1 still reads both as they were.
    expect(await readsOf(c1Pm, packageId, items)).toMatchObject({ rows: [{ id: packageId }], items: [...items].sort() });
    expect(await readsOf(c1Pm, cablesId, [cable])).toMatchObject({ rows: [{ id: cablesId }], items: [cable] });
    expect(await call(c1Pm, sql<{ name: unknown }>`select name from package where id = ${cablesId}::uuid`)).toEqual([{ name: name("Cables") }]);
  });

  it("RP-588-1: C2's own Packages are numbered from PKG-001, never counting C1's", async () => {
    const own = await createPackage(c2.member, "C2's own");
    expect(own).toMatchObject({ outcome: "created", seq: 1 });
    // C1's next one counts on from C1's own.
    const [c1Last] = await call<{ seq: number }>(c1Pm, sql`select max(seq) as seq from package where project_id = ${projectId}::uuid`);
    expect(c1Last!.seq).toBeGreaterThanOrEqual(2);
    const next = await createPackage(c1Pm, "C1's next");
    expect(next).toMatchObject({ outcome: "created", seq: c1Last!.seq + 1 });
    // Each reads only its own: C2 never C1's, C1 never C2's.
    expect(await call(c2.member, sql<{ id: string }>`select id from package where project_id = ${projectId}::uuid`)).toEqual([{ id: own.package_id }]);
    expect(await readsOf(c1Pm, own.package_id, [])).toEqual({ rows: [], sees: false, items: [], itemPackages: [] });
    // Deleted, so the later scenarios' "C2 reads no Package" stays about C1's.
    for (const [by, id] of [
      [c2.member, own.package_id],
      [c1Pm, next.package_id],
    ]) {
      expect(await outcome(by!, sql`select app.discard_package(${id}::uuid, now()) as outcome`)).toBe("discarded");
    }
  });
});

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

  it("RP-953-1: the Package's Trades as the board reads them are those of the items the caller sees: Electrical alone for the narrowed engineer", async () => {
    const trades = async (as: string) =>
      (
        await call<{ id: string }>(
          as,
          sql`select distinct tdv.dimension_value_id as id
            from app.package_latest_items(${packageId}::uuid) l
            join work_item_dimension_value_seen tdv on tdv.work_item_id = l.work_item_id
            join visibility_dimension d on d.id = tdv.dimension_id and d.kind = 'trade'
            order by 1`,
        )
      ).map((r) => r.id);
    expect(await trades(k1.ap)).toEqual([electrical, mechanical].sort());
    expect(await trades(k1Narrowed)).toEqual([electrical]);
  });

  it("RP-588-2: K1's manager and the Owner (Visibility all) count 8; K1's engineer narrowed to Electrical counts 6, never the Mechanical items", async () => {
    for (const who of [c1Pm, k1.ap, k1.member, ow.member]) {
      expect(await summary(who), who).toEqual([{ total: 8, open: 6, codes: { A: 1, C: 1 } }]);
    }
    expect((await readsOf(ow.member, packageId, [])).items).toEqual([...electricalItems, ...mechanicalItems].sort());
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

  it("RP-976: the rules' helpers that read items whatever the caller sees are not the app role's; the per-viewer readers are", async () => {
    const refused = async (query: ReturnType<typeof sql>) =>
      expect(withMember(app, c1Pm, (trx) => query.execute(trx))).rejects.toThrow(/permission denied/);
    await refused(sql`select * from app.latest_revisions(array[${item}::uuid])`);
    await refused(sql`select * from app.package_unsubmitted(${packageId}::uuid)`);
    // The positive control: the same Member reads the per-viewer ones, of an Open Package holding their own Draft.
    const open = (await createPackage(c1Pm, "Still to Submit")).package_id;
    const own = await draft(c1Pm, "C1 PM's own Draft");
    expect(await addItem(c1Pm, open, own)).toBe("added");
    expect(await call(c1Pm, sql<{ work_item_id: string }>`select work_item_id from app.package_latest_items(${open}::uuid)`)).toEqual([{ work_item_id: own }]);
    expect(await call(c1Pm, sql<{ id: string }>`select i as id from app.package_items_to_submit(${open}::uuid) i`)).toEqual([{ id: own }]);
  });
});

describe("scenario RP-588-2 (story 30): each chain counts once, by the latest Revision its viewer sees", () => {
  let packageId = "";
  let coded = ""; // Closed at Code C by K1.
  let revision = ""; // Its Revision R1: a Draft of C1's, which K1 doesn't see.

  const latest = (as: string) =>
    call<{ work_item_id: string; counted: boolean }>(as, sql`select work_item_id, counted from app.package_latest_items(${packageId}::uuid)`);
  const summary = (as: string) =>
    call<{ total: number; open: number; codes: Record<string, number> }>(as, sql`select total, open, codes from app.package_summary(${packageId}::uuid)`);

  beforeAll(async () => {
    packageId = (await createPackage(c1Pm, "Revised once")).package_id;
    coded = await draft(c1.member, "Coded C");
    expect(await addItem(c1.member, packageId, coded)).toBe("added");
    expect(await take(c1.member, coded, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, coded)).toBe("picked_up");
    expect(await take(c1Pm, coded, "submit")).toBe("applied");
    expect(await pickUp(k1.member, coded)).toBe("picked_up");
    expect(await take(k1.member, coded, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.ap, coded)).toBe("picked_up");
    expect(await take(k1.ap, coded, "revise_c")).toBe("applied");
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_revision(${coded}::uuid, ${randomUUID()}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    revision = created!.work_item_id;
  });

  it("RP-588-2: C1 counts the Code C item and its open Revision once, by the Revision", async () => {
    for (const who of [c1Pm, c1.member]) {
      expect((await readsOf(who, packageId, [])).items, who).toEqual([coded, revision].sort());
      expect(await latest(who), who).toEqual([{ work_item_id: revision, counted: true }]);
      expect(await summary(who), who).toEqual([{ total: 1, open: 1, codes: {} }]);
    }
  });

  it("RP-588-2: K1 and the Owner, who don't see the Draft R1, count the Code C item: R1 is neither listed nor counted for them", async () => {
    for (const who of [k1.ap, k1.member, ow.member]) {
      expect((await readsOf(who, packageId, [revision])).items, who).toEqual([coded]);
      expect((await readsOf(who, packageId, [revision])).itemPackages, who).toEqual([]);
      expect(await latest(who), who).toEqual([{ work_item_id: coded, counted: true }]);
      expect(await summary(who), who).toEqual([{ total: 1, open: 0, codes: { C: 1 } }]);
    }
    // C2 sees neither: nothing at all.
    expect(await latest(c2.member)).toEqual([]);
    expect(await summary(c2.member)).toEqual([]);
  });
});

describe("scenario RP-588-4: K1's manager codes three items in bulk (RP-646)", () => {
  // The test Workflow with Remarks on Code A's Action Form, as the MAR Workflow has.
  const WITH_REMARKS = "PKGRM";
  const REMARKS = "Approved as submitted";
  const INTERNAL_NOTE = "K1 only: checked the datasheets";
  type Event = {
    type: string;
    audience: string;
    company_name: { en: string } | null;
    member_name: { en: string } | null;
    outcome: string | null;
    remarks: string | null;
  };
  const items: string[] = [];
  let single = "";

  /** Item `id`'s history as `as` reads it (app.work_item_history), without times. */
  const historyOf = (as: string, id: string) =>
    call<Event>(as, sql`select type, audience, company_name, member_name, outcome, remarks from app.work_item_history(${id}::uuid) order by seq`);
  /** K1's manager's Code A on `id`, with the Remarks and an Internal Note. */
  const codeA = (id: string) =>
    sql<{ outcome: string }>`
      select app.take_transition(${id}::uuid, 'approve_a', ${JSON.stringify({ remarks: REMARKS })}::jsonb, ${INTERNAL_NOTE}, app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome
    `;

  beforeAll(async () => {
    const workflowId = await addTestWorkflow((text) => migrator.query(text), { publish: false });
    const remarksForm = { sections: [{ key: "code_a", title: name("Approve"), fields: [approveBActionForm.sections[0]!.fields[0]!] }] };
    await migrator.query(
      `update workflow_transition t set action_form = $1::jsonb from workflow_version v
       where v.id = t.workflow_version_id and v.workflow_definition_id = $2 and t.key = 'approve_a'`,
      [JSON.stringify(remarksForm), workflowId],
    );
    await migrator.query("update workflow_version set status = 'published', published_at = now() where workflow_definition_id = $1", [workflowId]);
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       select 'rabaed', 'submittals', $1, '{"en": "Package Remarks (test)", "ar": "ملاحظات الحزمة"}', $2, 'review_code', form_definition_id
       from work_item_type where code = $3`,
      [WITH_REMARKS, workflowId, TYPE],
    );
    for (const title of ["Bulk 1", "Bulk 2", "Bulk 3", "Single"]) {
      const id = await draft(c1.member, title, WITH_REMARKS);
      expect(await take(c1.member, id, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, id)).toBe("picked_up");
      expect(await take(c1Pm, id, "submit")).toBe("applied");
      expect(await pickUp(k1.member, id)).toBe("picked_up");
      expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
      expect(await pickUp(k1.ap, id)).toBe("picked_up");
      if (title === "Single") single = id;
      else items.push(id);
    }
    // A bulk Code takes each item's own Code through app.take_transition, all in one transaction (as the api does).
    const outcomes = await withMember(app, k1.ap, async (trx) => {
      const taken: string[] = [];
      for (const id of items) taken.push((await codeA(id).execute(trx)).rows[0]!.outcome);
      return taken;
    });
    expect(outcomes).toEqual(["applied", "applied", "applied"]);
    expect(await outcome(k1.ap, codeA(single))).toBe("applied");
  });

  it("RP-588-4: C1 reads three separate Code events naming K1's Company and the signer, with the Remarks, as for a single Code, never K1's internal Steps or Notes", async () => {
    const control = await historyOf(c1Pm, single);
    const code = control.filter((e) => e.outcome === "A");
    expect(code).toHaveLength(1);
    expect(code[0]).toMatchObject({ audience: "shared", company_name: { en: "K1" }, member_name: { en: "ap" }, remarks: REMARKS });
    for (const id of items) {
      const reads = await historyOf(c1Pm, id);
      expect(reads).toEqual(control);
      // K1's own move to its manager and its Internal Note stay with K1 (V5).
      expect(reads.some((e) => e.type === "internal_note" || (e.audience === "internal" && e.company_name?.en === "K1"))).toBe(false);
      const k1Notes = await call<{ internal_note: string }>(
        k1.ap,
        sql`select internal_note from app.work_item_history(${id}::uuid) where type = 'internal_note'`,
      );
      expect(k1Notes).toEqual([{ internal_note: INTERNAL_NOTE }]);
      expect(await call(c1Pm, sql<{ internal_note: string }>`select internal_note from app.work_item_history(${id}::uuid) where internal_note is not null`)).toEqual([]);
    }
  });

  it("RP-588-4: each bulk-coded item carries its own Issued Code, which C1 reads", async () => {
    for (const id of items) {
      expect(await call(c1Pm, sql<{ outcome: string }>`select outcome from work_item where id = ${id}::uuid and closed_at is not null`)).toEqual([
        { outcome: "A" },
      ]);
    }
  });

  it("RP-588-4: each item's Code is signed over that item's own content (content_sha256, one per item, story 44)", async () => {
    const { rows } = await migrator.query<{ work_item_id: string; title: string; hash: string }>(
      `select e.work_item_id, w.title, encode(e.content_sha256, 'hex') as hash
       from work_item_event e join work_item w on w.id = e.work_item_id
       where e.work_item_id = any($1::uuid[]) and e.type = 'issue_code' and e.audience = 'shared'`,
      [items],
    );
    expect(rows.map((r) => r.work_item_id).sort()).toEqual([...items].sort());
    for (const r of rows) {
      expect(r.hash).toBe(expectedContentSha256({ title: r.title, data: { model: r.title }, outcome: "A", documents: [] }));
    }
    expect(new Set(rows.map((r) => r.hash)).size).toBe(3);
  });

  it("RP-588-4: one Documental Record per bulk-coded item (RP-23), naming K1 by Company and the Code's signer, with the Remarks; never K1's Internal Note or its internal answers", async () => {
    type Fact = { companyName: { en: string }; memberName: { en: string }; remarks: string | null; answers: unknown; contentSha256: string };
    for (const id of items) {
      const { rows: jobs } = await migrator.query<{ id: string }>(
        "select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1",
        [id],
      );
      expect(jobs, id).toHaveLength(1);
      // The record job reads its facts as the worker, with no Member set.
      const { rows } = await sql<{ facts: { workItemId: string; outcome: string; transitions: Fact[] } }>`
        select app.documental_record_facts(${jobs[0]!.id}::uuid) as facts
      `.execute(app);
      const facts = rows[0]!.facts;
      expect(facts).toMatchObject({ workItemId: id, outcome: "A" });
      const coded = facts.transitions.filter((t) => t.remarks !== null);
      expect(coded).toEqual([expect.objectContaining({ companyName: expect.objectContaining({ en: "K1" }), memberName: expect.objectContaining({ en: "ap" }), remarks: REMARKS })]);
      // A move inside K1 (its engineer's Send to Manager) prints who took it (by design, RP-650), never answers (V5),
      // and the Internal Note is in no fact.
      const insideK1 = facts.transitions.filter((x) => x.companyName.en === "K1" && x.remarks === null);
      expect(insideK1.length).toBeGreaterThan(0);
      for (const t of insideK1) expect(t.answers).toBeNull();
      expect(JSON.stringify(facts)).not.toContain(INTERNAL_NOTE);
    }
  });

  it("RP-588-4: app.lock_work_items holds only the items its caller sees, so a bulk command never waits on one it can't name", async () => {
    const hidden = await draft(c1.member, "C1's own Draft", WITH_REMARKS);
    const fresh = await draft(c1.member, "Seen by K1", WITH_REMARKS);
    expect(await take(c1.member, fresh, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, fresh)).toBe("picked_up");
    expect(await take(c1Pm, fresh, "submit")).toBe("applied");
    /** Whether another session finds item `id` locked (asking without waiting). */
    const locked = async (id: string) => {
      await migrator.query("begin");
      try {
        await migrator.query("select 1 from work_item where id = $1 for update nowait", [id]);
        return false;
      } catch (e) {
        if ((e as { code?: string }).code === "55P03") return true;
        throw e;
      } finally {
        await migrator.query("rollback");
      }
    };
    const held = await withMember(app, k1.ap, async (trx) => {
      await sql`select app.lock_work_items(${[fresh, hidden]}::uuid[])`.execute(trx);
      return { fresh: await locked(fresh), hidden: await locked(hidden) };
    });
    expect(held).toEqual({ fresh: true, hidden: false });
    // C1, who sees both, holds both.
    const byC1 = await withMember(app, c1Pm, async (trx) => {
      await sql`select app.lock_work_items(${[fresh, hidden]}::uuid[])`.execute(trx);
      return { fresh: await locked(fresh), hidden: await locked(hidden) };
    });
    expect(byC1).toEqual({ fresh: true, hidden: true });
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

describe("scenario RP-588-2 (RP-643: notification): a Package Submit's one notification counts what its Member sees", () => {
  let packageId = "";
  const items: string[] = [];
  let k1Electrical = ""; // A K1 engineer narrowed to Electrical.
  let k1Participant = "";
  const notificationOf = async (as: string) =>
    call<{ id: string; work_item_id: string | null }>(
      as,
      sql`select id, work_item_id from notification where kind = 'package_submitted' and package_id = ${packageId}::uuid`,
    );
  const packageOf = async (as: string, notificationId: string) =>
    call<{ package_id: string; seq: number; name: unknown; company_name: unknown; item_count: number }>(
      as,
      sql`select * from app.notification_package(${notificationId}::uuid)`,
    );
  const setTrade = (values: string[]) =>
    outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${k1Electrical}::uuid, 'trade', false, ${values}::uuid[], now()) as outcome`);

  beforeAll(async () => {
    // A second Trade of its own (RP-641's describe adds ME, RP-647's HV).
    const mechanical = (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'PL', '{"en": "Plumbing", "ar": "Plumbing"}'::jsonb)`,
      )
    )[0]!.value_id;
    expect(mechanical).toBeTruthy();
    k1Participant = (await migrator.query("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id])).rows[0].id;
    k1Electrical = await member(k1.id, "electrical engineer");
    await call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1Participant}::uuid, ${k1Electrical}::uuid, now())`);
    expect(await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${k1Electrical}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    expect(await setTrade([electrical])).toBe("set");
    expect(await outcome(k1.ap, sql`select app.set_project_member_positions(${k1Participant}::uuid, ${k1Electrical}::uuid, ${["engineer"]}::text[]) as outcome`)).toBe("set");

    packageId = (await createPackage(c1Pm, "Bathrooms – Tower 1, seam 2")).package_id;
    for (const [title, trade] of [["E1", electrical], ["E2", electrical], ["E3", electrical], ["M1", mechanical]] as const) {
      const [created] = await call<{ outcome: string; work_item_id: string }>(
        c1.member,
        sql`select outcome, work_item_id from app.create_work_item(
          ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
          ${trade}::uuid, ${buildingA}::uuid, now())`,
      );
      const id = created!.work_item_id;
      expect(await take(c1.member, id, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, id)).toBe("picked_up");
      expect(await addItem(c1Pm, packageId, id)).toBe("added");
      items.push(id);
    }
    await drainOutbox(app);
    // Submit Package: each item's Submit, then its record, in one transaction (as the api does).
    await withMember(app, c1Pm, async (trx) => {
      for (const id of items) {
        const r = await sql<{ outcome: string }>`
          select app.take_transition(${id}::uuid, 'submit', '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome
        `.execute(trx);
        expect(r.rows[0]!.outcome).toBe("applied");
      }
      const r = await sql<{ outcome: string }>`
        select app.record_package_submit(${packageId}::uuid, ${items}::uuid[], ${randomUUID()}::uuid, now()) as outcome
      `.execute(trx);
      expect(r.rows[0]!.outcome).toBe("recorded");
    });
    await drainOutbox(app);
  });

  it("the Electrical engineer reads one, of 3, never 4; K1's engineer who sees everything one of 4; neither a Step reached of its items", async () => {
    const [narrowed] = await notificationOf(k1Electrical);
    expect(narrowed).toMatchObject({ work_item_id: null });
    expect(await packageOf(k1Electrical, narrowed!.id)).toEqual([
      { package_id: packageId, seq: expect.any(Number), name: name("Bathrooms – Tower 1, seam 2"), company_name: { en: "C1", ar: "C1" }, item_count: 3 },
    ]);
    const [everything] = await notificationOf(k1.member);
    expect((await packageOf(k1.member, everything!.id))[0]!.item_count).toBe(4);
    for (const who of [k1Electrical, k1.member]) {
      expect(await call(who, sql<{ id: string }>`select id from notification where work_item_id = any (${items}::uuid[])`)).toEqual([]);
    }
  });

  it("reads nothing of another Member's, nor which items a notification holds", async () => {
    const [everything] = await notificationOf(k1.member);
    expect(await packageOf(k1Electrical, everything!.id)).toEqual([]);
    expect(
      (await call<{ n: number }>(k1Electrical, sql`select app.package_notification_count(${everything!.id}::uuid) as n`))[0]!.n,
    ).toBe(0);
    await expect(
      withMember(app, k1Electrical, (trx) => sql`select work_item_id from notification_package_item`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    // C2 and the Owner got none.
    for (const who of [c2.member, ow.member]) expect(await notificationOf(who)).toEqual([]);
  });

  it("is gone from the bell once its Member sees none of its items", async () => {
    expect(await setTrade([])).toBe("set");
    expect(await notificationOf(k1Electrical)).toEqual([]);
    expect(await setTrade([electrical])).toBe("set");
    expect(await notificationOf(k1Electrical)).toHaveLength(1);
  });
});

describe("scenario RP-588-2 (RP-643: email and digest): what a Package Submit's email says is checked again at send time, as its recipient", () => {
  type Sent = { to_address: string; kind: string; work_item_id: string | null; document_number: string | null; package_id: string | null; package_company_name: unknown; item_count: number };
  let packageId = "";
  let k1Participant = "";
  let plumbing = "";
  const eng = { seesAll: "", narrowedLater: "", narrowedOffAll: "", digest: "" }; // K1 engineers; the last narrowed to Electrical, by daily digest.
  const emails: Sent[] = [];
  const digests: Sent[] = [];

  const addressOf = async (id: string) => (await migrator.query("select email from member where id = $1", [id])).rows[0].email as string;
  const setTrade = (who: string, isAll: boolean, values: string[]) =>
    outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${who}::uuid, 'trade', ${isAll}, ${values}::uuid[], now()) as outcome`);
  const takeDigest: OutboxHandler = async (trx, row) => {
    const { rows } = await sql<Sent>`select * from app.take_notification_digest(${row.id}::uuid)`.execute(trx);
    digests.push(...rows);
  };

  beforeAll(async () => {
    k1Participant = (await migrator.query("select id from participant where project_id = $1 and company_id = $2", [projectId, k1.id])).rows[0].id;
    plumbing = (
      await migrator.query(
        "select v.id from dimension_value v join visibility_dimension d on d.id = v.dimension_id where d.project_id = $1 and d.kind = 'trade' and v.code = 'PL'",
        [projectId],
      )
    ).rows[0].id;
    for (const key of Object.keys(eng) as (keyof typeof eng)[]) {
      const id = await member(k1.id, `k1-${key.toLowerCase()}`);
      eng[key] = id;
      await call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1Participant}::uuid, ${id}::uuid, now())`);
      expect(await outcome(k1.ap, sql`select app.set_member_visibility(${k1Participant}::uuid, ${id}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(await setTrade(id, key !== "digest", key === "digest" ? [electrical] : [])).toBe("set");
      expect(await outcome(k1.ap, sql`select app.set_project_member_positions(${k1Participant}::uuid, ${id}::uuid, ${["engineer"]}::text[]) as outcome`)).toBe("set");
    }
    // The digest engineer takes "Step reached" (the group a Package Submit follows) by daily digest; the others email at once (the default).
    await withMember(app, eng.digest, (trx) =>
      sql`insert into notification_setting (member_id, notification_group, email, outcomes, updated_at) values (${eng.digest}::uuid, 'step_reached', 'digest', null, now())`.execute(
        trx,
      ),
    );

    packageId = (await createPackage(c1Pm, "Switchgear, seam 2")).package_id;
    const items: string[] = [];
    for (const [title, trade] of [["S1", electrical], ["S2", electrical], ["S3", electrical], ["SP", plumbing]] as const) {
      const id = await draft(c1.member, title, TYPE, trade);
      expect(await take(c1.member, id, "send_for_review")).toBe("applied");
      expect(await pickUp(c1Pm, id)).toBe("picked_up");
      expect(await addItem(c1Pm, packageId, id)).toBe("added");
      items.push(id);
    }
    await drainOutbox(app);
    await withMember(app, c1Pm, async (trx) => {
      for (const id of items) {
        const r = await sql<{ outcome: string }>`
          select app.take_transition(${id}::uuid, 'submit', '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome
        `.execute(trx);
        expect(r.rows[0]!.outcome).toBe("applied");
      }
      const r = await sql<{ outcome: string }>`
        select app.record_package_submit(${packageId}::uuid, ${items}::uuid[], ${randomUUID()}::uuid, now()) as outcome
      `.execute(trx);
      expect(r.rows[0]!.outcome).toBe("recorded");
    });
    // Delivered to all four as each sees the items now; then, before any email is sent, one is narrowed to
    // Electrical and one off every item: the worker's send (app.take_notification_email) checks again.
    let narrowed = false;
    await drainOutbox(app, {
      email: async (trx, row) => {
        if (!narrowed) {
          narrowed = true;
          expect(await setTrade(eng.narrowedLater, false, [electrical])).toBe("set");
          expect(await setTrade(eng.narrowedOffAll, false, [])).toBe("set");
        }
        const { rows } = await sql<Sent>`select * from app.take_notification_email(${row.id}::uuid)`.execute(trx);
        emails.push(...rows);
      },
      digest: takeDigest,
    });
    expect(narrowed).toBe(true);
    await sql`select app.enqueue_notification_digests()`.execute(app);
    await drainOutbox(app, { digest: takeDigest });
  });

  const ofPackage = async (sent: Sent[], who: string) => {
    const to = await addressOf(who);
    return sent.filter((s) => s.to_address === to && s.package_id === packageId);
  };

  it("RP-588-2: the immediate email names the Package, no item, C1 by Company name only, and the count its recipient sees: 4", async () => {
    expect(await ofPackage(emails, eng.seesAll)).toEqual([
      expect.objectContaining({
        kind: "package_submitted",
        work_item_id: null,
        document_number: null,
        package_company_name: { en: "C1", ar: "C1" },
        item_count: 4,
      }),
    ]);
  });

  it("RP-588-2: narrowed between delivery and the send, the email counts what its recipient sees at send time: 3, and none once they see no item", async () => {
    expect(await ofPackage(emails, eng.narrowedLater)).toEqual([expect.objectContaining({ item_count: 3, package_company_name: { en: "C1", ar: "C1" } })]);
    expect(await ofPackage(emails, eng.narrowedOffAll)).toEqual([]);
  });

  it("RP-588-2: the daily digest carries the Package with the count its recipient sees, 3, naming C1 by Company name only; never an email of its own", async () => {
    expect(await ofPackage(digests, eng.digest)).toEqual([
      expect.objectContaining({ kind: "package_submitted", work_item_id: null, document_number: null, package_company_name: { en: "C1", ar: "C1" }, item_count: 3 }),
    ]);
    expect(await ofPackage(emails, eng.digest)).toEqual([]);
  });
});
