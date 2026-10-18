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
import { addTestWorkflow, drainOutbox, joinProject, testDatabaseUrls } from "../test-support/index.ts";

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
    const mechanical = (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'ME', '{"en": "ME", "ar": "ME"}'::jsonb)`,
      )
    )[0]!.value_id;
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
