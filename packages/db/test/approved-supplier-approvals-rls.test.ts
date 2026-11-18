// Seam 2 for "an approved supplier links to the SAR that approved it" (RP-1306; visibility.md V10,
// amended 2026-11-16; scenarios RP-1306-1 to RP-1306-5), as the app role. app.approved_supplier_approvals
// gives a supplier's SAR (its id, Document Number and Subject) only to a Member who sees that SAR now
// (app.sees_work_item, at read time): C1, which raised it, and K1, which closed it. C2, another
// Contractor, gets no row for it, exactly as no Member gets one for an entry a Project Admin added by
// hand. Narrowing a Member's Visibility takes the row away at the next read. The table's grants are
// unchanged: the app role still can't read `source` or `source_work_item_id`. A MAR choosing the
// supplier holds no Link to the SAR, and its Documental Record names the supplier only.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "SARLNK";
const MAR_TYPE = "MARLNK";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the SARs.
let k1: Company; // Consultant: closes them.
let c2: Company; // Another Contractor of the same Project: never sees C1's SARs (V1).
let c1Pm = "";
let c1Viewer = ""; // A C1 engineer whose Visibility is narrowed in RP-1306-3.
let c2Pm = "";
let k1Manager = "";
const participant = { c1: "", k1: "", c2: "" };
let projectId = "";
let electrical = "";
let mechanical = "";
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

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** `raiser`'s item of `type`, Submitted by `pm` and closed by K1's manager at Code A; returns it. */
async function closedItem(raiser: string, pm: string, type: string, title: string, data: Record<string, unknown>): Promise<string> {
  const [created] = await call<{ work_item_id: string }>(
    raiser,
    sql`select work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify(data)}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  const id = created!.work_item_id;
  expect(await take(raiser, id, "send_for_review")).toBe("applied");
  expect(await pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, id, "submit")).toBe("applied");
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1Manager, id)).toBe("picked_up");
  expect(await take(k1Manager, id, "approve_a")).toBe("applied");
  return id;
}

/** C1's SAR for `en`, closed at Code A, so its supplier joins the list; returns the SAR and the supplier. */
async function approvedBySar(en: string, ar: string): Promise<{ sar: string; supplier: string }> {
  const sar = await closedItem(c1.member, c1Pm, TYPE, `${en} approval`, { supplier_name_en: en, supplier_name_ar: ar });
  const supplier = await one("select id from approved_supplier where project_id = $1 and source_work_item_id = $2", [projectId, sar]);
  return { sar, supplier };
}

type Approval = { supplier_id: string; work_item_id: string; document_number: string; subject: string };
/** The Project's supplier approvals as `as` reads them. */
const approvals = (as: string) =>
  call<Approval>(as, sql`select supplier_id, work_item_id, document_number, subject from app.approved_supplier_approvals(${projectId}::uuid)`);
/** The approvals `as` reads, keyed by the SAR, for expectHiddenFrom. */
const approvalSars = (as: string) => approvals(as).then((rows) => rows.map((r) => ({ id: r.work_item_id })));
/** The SAR's own Document Number and Subject, as the migrator reads them. */
const sarRow = async (sar: string) =>
  (await migrator.query<{ document_number: string; title: string }>("select document_number, title from work_item where id = $1", [sar])).rows[0]!;
const whoIs = (as: string) =>
  ({ [c1.member]: "C1 engineer", [c1Viewer]: "C1 viewer", [k1.member]: "K1 engineer", [k1Manager]: "K1 manager", [c2.member]: "C2 engineer" })[as] ?? as;

const setVisibility = (as: string, p: string, m: string, kind: string, all: boolean, values: string[]) =>
  outcome(as, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, ${all}, ${values}::uuid[], now()) as outcome`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { withApproveB: true });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "SAR (link test)", "ar": "طلب اعتماد مورد"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "supplier", "title": {"en": "Supplier", "ar": "المورد"},
          "fields": [
            {"key": "supplier_name_en", "type": "text", "label": {"en": "Supplier name (English)", "ar": "اسم المورد"}},
            {"key": "supplier_name_ar", "type": "text", "label": {"en": "Supplier name (Arabic)", "ar": "اسم المورد"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id, adds_approved_supplier)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "SAR (link test)", "ar": "طلب اعتماد مورد"}', '${workflowId}', 'review_code', v_form, true);
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "MAR supplier (link test)", "ar": "مورد طلب اعتماد مواد"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "supplier", "type": "approved_supplier", "label": {"en": "Approved supplier", "ar": "المورد المعتمد"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${MAR_TYPE}', '{"en": "MAR supplier (link test)", "ar": "مورد طلب اعتماد مواد"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");
  c1Viewer = await member(c1.id, "viewer");
  c2Pm = await member(c2.id, "pm");
  k1Manager = k1.ap;

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'SAL', 'contractor')`,
  );
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  participant.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  participant.c2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  mechanical = await value("trade", "ME");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [c1, participant.c1, c1Viewer, ["engineer"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1.ap, ["manager"]],
    [c2, participant.c2, c2.member, ["engineer"]],
    [c2, participant.c2, c2Pm, ["project_manager"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) expect(await setVisibility(co.ap, p, m, kind, true, [])).toBe("set");
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1306-1 (seam 2): a Member who sees the SAR reads it as the supplier's approval", () => {
  it("C1, which raised it, and K1, which closed it, read the SAR's id, Document Number and Subject", async () => {
    const { sar, supplier } = await approvedBySar("Linked Cables", "كابلات مرتبطة");
    const { document_number, title } = await sarRow(sar);
    expect(document_number).toMatch(/\S/);
    for (const who of [c1.member, c1Viewer, k1.member, k1Manager]) {
      expect((await approvals(who)).filter((r) => r.supplier_id === supplier), whoIs(who)).toEqual([
        { supplier_id: supplier, work_item_id: sar, document_number, subject: title },
      ]);
    }
  });
});

describe("scenario RP-1306-2 (seam 2): a viewer who can't see the SAR reads the supplier as one added by hand", () => {
  it("C2 gets no approval for the SAR it can't see, though C1 and K1 do", async () => {
    const { sar } = await approvedBySar("Hidden Approval Co", "شركة الاعتماد المخفي");
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: [c1.member, k1.member], hiddenFrom: [c2.member, c2Pm], name: whoIs, label: "the SAR as an approval" });
    // The positive control: C2 does read an approval, its own SAR's, which C1 in turn can't see.
    const own = await closedItem(c2.member, c2Pm, TYPE, "C2 Own Supplies approval", { supplier_name_en: "C2 Own Supplies", supplier_name_ar: "توريدات سي 2" });
    await expectHiddenFrom({ read: approvalSars, target: own, seenBy: [c2.member, k1.member], hiddenFrom: [c1.member, c1Viewer], name: whoIs, label: "C2's own SAR as an approval" });
  });

  it("an entry a Project Admin added by hand has no approval for anyone: only entries a seen SAR added are given", async () => {
    const [added] = await call<{ outcome: string; supplier_id: string }>(
      c1.ap,
      sql`select outcome, supplier_id from app.add_approved_supplier(
        ${projectId}::uuid, ${electrical}::uuid, null, '{"en": "By Hand Supplies", "ar": "توريدات يدوية"}'::jsonb, now())`,
    );
    expect(added!.outcome).toBe("added");
    // Every C1 SAR's supplier, as the migrator reads them: C1 sees each of those SARs (and K1 those and C2's).
    const bySar = (
      await migrator.query<{ id: string }>(
        `select s.id from approved_supplier s join work_item w on w.id = s.source_work_item_id
         where s.project_id = $1 and w.raised_by_participant_id = $2`,
        [projectId, participant.c1],
      )
    ).rows.map((r) => r.id);
    expect(bySar.length).toBeGreaterThan(0);
    for (const who of [c1.member]) {
      // The exact set: the hand-added entry is not in it, nor any row of another Project.
      expect((await approvals(who)).map((r) => r.supplier_id).sort(), whoIs(who)).toEqual([...bySar].sort());
    }
    // K1 closed every SAR, C2's too: its exact set is every entry a SAR added, and still not the hand-added one.
    const everySar = (
      await migrator.query<{ id: string }>("select id from approved_supplier where project_id = $1 and source = 'submittal'", [projectId])
    ).rows.map((r) => r.id);
    expect(everySar.length).toBeGreaterThan(bySar.length);
    for (const who of [k1.member, k1Manager]) {
      expect((await approvals(who)).map((r) => r.supplier_id).sort(), whoIs(who)).toEqual([...everySar].sort());
    }
    // And the hand-added entry itself is on the list for everyone, by id.
    for (const who of [c1.member, c2.member]) {
      expect((await call<{ id: string }>(who, sql`select id from approved_supplier where id = ${added!.supplier_id}::uuid`)).map((r) => r.id)).toEqual([
        added!.supplier_id,
      ]);
    }
  });
});

describe("scenario RP-1306-3 (seam 2): narrowing a Member's Visibility takes the approval away at the next read", () => {
  it("C1's viewer reads the approval, then not once their Trade grant leaves Electrical; given back, it returns", async () => {
    const { sar } = await approvedBySar("Narrowed Cables", "كابلات مضيقة");
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: c1Viewer, hiddenFrom: c2.member, name: whoIs, label: "before narrowing" });
    expect(await setVisibility(c1.ap, participant.c1, c1Viewer, "trade", false, [mechanical])).toBe("set");
    await expectHiddenFrom({ read: approvalSars, target: sar, seenBy: [c1.member, k1.member], hiddenFrom: c1Viewer, name: whoIs, label: "after narrowing" });
    expect(await setVisibility(c1.ap, participant.c1, c1Viewer, "trade", true, [])).toBe("set");
    expect((await approvalSars(c1Viewer)).map((r) => r.id)).toContain(sar);
  });
});

describe("scenario RP-1306-4 (seam 2): the MAR's Links and Documental Record carry no SAR", () => {
  it("C2's closed MAR holds no Link to the SAR, and its Record names the supplier by id and name only", async () => {
    const { sar, supplier } = await approvedBySar("Record Cables", "كابلات السجل");
    const { document_number, title } = await sarRow(sar);
    const mar = await closedItem(c2.member, c2Pm, MAR_TYPE, "Cable drums", { supplier });
    const links = await migrator.query("select 1 from work_item_link where from_id = $1 or to_id = $1", [mar]);
    expect(links.rows).toEqual([]); // not hidden-from: the migrator's read, choosing the supplier made no Link
    // The record job's read, as the worker: the app role with no Member set.
    const outbox = await one("select id from outbox where kind = 'documental_record' and payload ->> 'closed_work_item_id' = $1", [mar]);
    const facts = (await sql<{ facts: { form: { suppliers: unknown } } }>`select app.documental_record_facts(${outbox}::uuid) as facts`.execute(app)).rows[0]!.facts;
    expect(facts.form.suppliers).toEqual([{ id: supplier, name: { en: "Record Cables", ar: "كابلات السجل" } }]);
    const printed = JSON.stringify(facts);
    for (const [what, text] of [["id", sar], ["Document Number", document_number], ["Subject", title]] as const) {
      expect(printed.includes(text), `the Record holds the SAR's ${what}`).toBe(false);
    }
  });
});

describe("scenario RP-1306-5 (seam 2): the app role still reads no source of an entry", () => {
  it("every Member, the one who sees the SAR included, is refused `source` and `source_work_item_id`", async () => {
    await approvedBySar("Ungranted Source Co", "شركة المصدر");
    for (const who of [c1.member, k1.member, c2.member]) {
      for (const column of ["source_work_item_id", "source", "added_by_member_id"]) {
        await expect(
          call(who, sql.raw(`select ${column} from approved_supplier where project_id = '${projectId}'`) as ReturnType<typeof sql<object>>),
          `${whoIs(who)}: ${column}`,
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});
