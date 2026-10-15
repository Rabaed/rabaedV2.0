// Seams 1 and 2 for "a SAR closed at Code A or B adds its supplier to the Approved Supplier
// List" (RP-594, spec RP-598; workflow-engine.md §6; visibility.md V10; scenario RP-594-1),
// as the app role. C1's SAR closed at A by K1 puts its supplier on the list for its Trade,
// readable by every Participant, with no link to the SAR (the app role has no grant on
// `source_work_item_id`); at C nothing is added; a supplier the Trade lists already (the
// same name, whatever its case or outer spaces, English or Arabic) is not added twice.
// Scenario RP-598-2: a MAR's `approved_supplier` answer is the supplier's id, which every
// Participant reads as its name on the list, and never leads to the SAR.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "SARADD";
const MAR_TYPE = "MARSUP";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the SAR.
let k1: Company; // Consultant: closes it.
let c2: Company; // Another Contractor of the same Project (V10).
let c1Pm = "";
let projectId = "";
let electrical = "";
let mechanical = "";
let buildingA = "";
let lighting = "";
let k1Manager = "";

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

/** C1's SAR for `supplier`, Submitted and closed by K1's manager with `closing`; returns the SAR. */
async function closedSar(
  supplier: { en: string; ar: string },
  closing: "approve_a" | "approve_b" | "revise_c",
  options: { trade?: string; scopes?: string[] } = {},
): Promise<string> {
  const data = { supplier_name_en: supplier.en, supplier_name_ar: supplier.ar };
  const [created] = await call<{ work_item_id: string }>(
    c1.member,
    sql`select work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${supplier.en}, app.latest_form_version(${TYPE}), ${JSON.stringify(data)}::jsonb,
      ${options.trade ?? electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  const id = created!.work_item_id;
  for (const scope of options.scopes ?? []) {
    await migrator.query("insert into work_item_scope (work_item_id, project_id, scope_id) values ($1, $2, $3)", [id, projectId, scope]);
  }
  expect(await take(c1.member, id, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, id)).toBe("picked_up");
  expect(await take(c1Pm, id, "submit")).toBe("applied");
  expect(await pickUp(k1.member, id)).toBe("picked_up");
  expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1Manager, id)).toBe("picked_up");
  expect(await take(k1Manager, id, closing)).toBe("applied");
  return id;
}

type Row = { name: { en: string; ar: string }; trade_value_id: string; scope_id: string | null; status: string };
/** The Project's suppliers as `as` reads them (the columns V10 grants). */
const listed = (as: string) =>
  call<Row>(as, sql`select name, trade_value_id, scope_id, status from approved_supplier where project_id = ${projectId}::uuid`);
/** The rows the migrator reads, with what the app role may not. */
const raw = async (en: string) =>
  (
    await migrator.query<{ source: string; source_work_item_id: string; added_by_member_id: string | null; trade_value_id: string; scope_id: string | null }>(
      "select source, source_work_item_id, added_by_member_id, trade_value_id, scope_id from approved_supplier where project_id = $1 and name ->> 'en' = $2",
      [projectId, en],
    )
  ).rows;

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
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "SAR (test)", "ar": "طلب اعتماد مورد"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "supplier", "title": {"en": "Supplier", "ar": "المورد"},
          "fields": [
            {"key": "supplier_name_en", "type": "text", "label": {"en": "Supplier name (English)", "ar": "اسم المورد"}},
            {"key": "supplier_name_ar", "type": "text", "label": {"en": "Supplier name (Arabic)", "ar": "اسم المورد"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id, adds_approved_supplier)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "SAR (test)", "ar": "طلب اعتماد مورد"}', '${workflowId}', 'review_code', v_form, true);
        -- A MAR's supplier field (RP-595), for scenario RP-598-2.
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "MAR supplier (test)", "ar": "مورد طلب اعتماد مواد"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "supplier", "type": "approved_supplier", "label": {"en": "Approved supplier", "ar": "المورد المعتمد"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${MAR_TYPE}', '{"en": "MAR supplier (test)", "ar": "مورد طلب اعتماد مواد"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");
  k1Manager = k1.ap;

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'SAT', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
  };
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
  lighting = (
    await call<{ scope_id: string }>(
      c1.ap,
      sql`select scope_id from app.add_scope(${projectId}::uuid, ${electrical}::uuid, null, '{"en": "Lighting", "ar": "الإنارة"}'::jsonb)`,
    )
  )[0]!.scope_id;
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
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(
        await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
      ).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-594-1: a SAR closed at Code A or B adds its supplier to the list", () => {
  it("at A: the supplier appears for its Trade, source 'submittal', for every Participant, with no link to the SAR", async () => {
    const sar = await closedSar({ en: "Najd Cables", ar: "كابلات نجد" }, "approve_a");
    const rows = await raw("Najd Cables");
    expect(rows).toEqual([
      { source: "submittal", source_work_item_id: sar, added_by_member_id: null, trade_value_id: electrical, scope_id: null },
    ]);
    for (const who of [c1.member, k1.member, c2.member]) {
      expect(await listed(who), who).toContainEqual({
        name: { en: "Najd Cables", ar: "كابلات نجد" }, trade_value_id: electrical, scope_id: null, status: "approved",
      });
    }
  });

  it("at B too, for the Scope when the SAR names exactly one", async () => {
    await closedSar({ en: "Lumen Lighting", ar: "لومن للإنارة" }, "approve_b", { scopes: [lighting] });
    expect((await raw("Lumen Lighting"))[0]!.scope_id).toBe(lighting);
  });

  it("at C nothing is added", async () => {
    await closedSar({ en: "Rejected Wires", ar: "أسلاك مرفوضة" }, "revise_c");
    expect(await raw("Rejected Wires")).toEqual([]);
  });

  it("is not added twice for a Trade: the same name in English or Arabic, case and outer spaces ignored", async () => {
    await closedSar({ en: "Once Only Supply", ar: "التوريد مرة" }, "approve_a");
    await closedSar({ en: "  once only SUPPLY ", ar: "اسم آخر" }, "approve_a");
    await closedSar({ en: "Another English Name", ar: " التوريد مرة " }, "approve_a");
    expect(await raw("Once Only Supply")).toHaveLength(1);
    expect(await raw("once only SUPPLY")).toEqual([]);
    expect(await raw("Another English Name")).toEqual([]);
  });

  it("the same supplier of another Trade is its own entry", async () => {
    await closedSar({ en: "Two Trades Co", ar: "شركة تجارتين" }, "approve_a");
    await closedSar({ en: "Two Trades Co", ar: "شركة تجارتين" }, "approve_a", { trade: mechanical });
    const rows = await raw("Two Trades Co");
    expect(rows.map((r) => r.trade_value_id).sort()).toEqual([electrical, mechanical].sort());
  });
});

describe("scenario RP-594-1 (seam 2): the other Contractor reads the supplier, never the SAR", () => {
  it("C2 reads the row's name, Trade and Scope, and has no grant on `source_work_item_id`", async () => {
    const sar = await closedSar({ en: "Visible Supplier", ar: "مورد ظاهر" }, "approve_a");
    expect((await listed(c2.member)).map((r) => r.name.en)).toContain("Visible Supplier");
    for (const column of ["source_work_item_id", "source", "added_by_member_id"]) {
      await expect(
        call(c2.member, sql.raw(`select ${column} from approved_supplier where project_id = '${projectId}'`) as ReturnType<typeof sql<object>>),
        column,
      ).rejects.toThrow(/permission denied/);
    }
    // And the SAR itself stays hidden from C2 (V1): no item, no event.
    expect(await call(c2.member, sql<{ id: string }>`select id from work_item where id = ${sar}::uuid`)).toEqual([]);
  });
});

describe("scenario RP-598-2 (seam 2): a MAR names its supplier, never the SAR that approved it", () => {
  it("C2's MAR holds the id of the supplier C1's SAR added; C2 reads it as the supplier's name only", async () => {
    const sar = await closedSar({ en: "Shared Cables", ar: "كابلات مشتركة" }, "approve_a");
    const supplierId = (await migrator.query("select id from approved_supplier where project_id = $1 and name ->> 'en' = 'Shared Cables'", [projectId])).rows[0]
      .id as string;
    const [created] = await call<{ work_item_id: string }>(
      c2.member,
      sql`select work_item_id from app.create_work_item(
        ${projectId}::uuid, ${MAR_TYPE}, 'Cable drums', app.latest_form_version(${MAR_TYPE}), ${JSON.stringify({ supplier: supplierId })}::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    const mar = created!.work_item_id;
    // The answer is the supplier's id, as stored: it is Project-wide (V10), so nothing strips it, and nothing adds the SAR.
    const [read] = await call<{ data: Record<string, unknown> }>(c2.member, sql`select app.work_item_answers(${mar}::uuid) as data`);
    expect(read!.data.supplier).toBe(supplierId);
    expect(JSON.stringify(read!.data)).not.toContain(sar);
    // The id reads as the supplier's name on the list, and no further: the SAR is hidden from C2 (V1, V10).
    expect(
      await call<{ id: string; name: { en: string; ar: string } }>(c2.member, sql`select id, name from approved_supplier where id = ${supplierId}::uuid`),
    ).toEqual([{ id: supplierId, name: { en: "Shared Cables", ar: "كابلات مشتركة" } }]);
    expect(await call(c2.member, sql<{ id: string }>`select id from work_item where id = ${sar}::uuid`)).toEqual([]);
  });
});
