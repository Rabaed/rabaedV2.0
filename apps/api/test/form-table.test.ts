// Seam 1 for the Form's `table` field (RP-280, spec RP-278; form-engine.md §2):
// table answers round-trip through the API exactly as stored, a wrong cell is
// refused with its row and column, too few rows blocks leaving Draft, and
// another Company reads the table in full, read-only, on an item it can see (V13).
//
// The MAR Form Version 1 has no table, so this file adds a test-only Rabaed
// Default Type (the MAR's Workflow) whose Form has one.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type FormVersion } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARTB";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "supply",
      title: { en: "Supply", ar: "التوريد" },
      fields: [
        {
          key: "items",
          type: "table",
          label: { en: "Items", ar: "البنود" },
          required: true,
          minRows: 1,
          maxRows: 3,
          columns: [
            { key: "fixture", type: "text", label: { en: "Fixture type", ar: "نوع التجهيز" }, required: true },
            { key: "quantity", type: "number", label: { en: "Quantity", ar: "الكمية" }, min: 0, decimals: 0, total: true, required: true },
            { key: "tested", type: "yes_no", label: { en: "Tested", ar: "تم الفحص" } },
          ],
        },
      ],
    },
    {
      // The Built-in Fields every Form places (RP-270).
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
  ],
};

const rows = [
  { fixture: "Downlight", quantity: 12, tested: true },
  { fixture: "Panel light", quantity: 30, tested: false },
];

/** The test-only Rabaed Default Type, filled with the Form above and following the MAR's Workflow. */
async function addTableType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Table (test)", "ar": "جدول (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Table submittal", "ar": "اعتماد جدول"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let engineer: Caller; // Raises the item.
let pm: Caller; // Holds Internal Review and Submits.
let consultant: Caller; // Another Company, which sees the item once Submitted.
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** The Built-in Fields, sent with every set of answers so the table is what each test varies. */
const builtIns = () => ({ trade: electrical, location: buildingA });

const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Fixtures", answers: { ...builtIns(), ...answers } });
const save = (by: Caller, id: string, answers: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const answersOf = async (by: Caller, id: string) => {
  const { trade: _trade, location: _location, ...own } = (await detail(by, id)).answers;
  return own;
};

beforeAll(async () => {
  await addTableType();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await api.authorizedPerson();
  const k1Participant = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1Participant}/visibility`, { trade: all, location: all }));
  consultant = await projectMember(api, k1, k1Participant, ["manager"]);
});

describe("the Form with a table", () => {
  it("comes with the table's columns and limits", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.schema).toEqual(formSchema.parse(schema));
  });
});

describe("table answers round-trip", () => {
  it("on create: the rows exactly as sent, in order", async () => {
    const id = (await ok(createDraft({ items: rows }), 201)).json().id as string;
    expect(await answersOf(engineer, id)).toEqual({ items: rows });
  });

  it("on Save draft: more rows, with a row just added (nothing in it) left out", async () => {
    const id = (await ok(createDraft({}), 201)).json().id as string;
    await ok(save(engineer, id, { items: [rows[0], {}] }));
    expect(await answersOf(engineer, id)).toEqual({ items: [rows[0]] });
    await ok(save(engineer, id, { items: rows }));
    expect(await answersOf(engineer, id)).toEqual({ items: rows });
    await ok(save(engineer, id, { items: [] }));
    expect(await answersOf(engineer, id)).toEqual({});
  });

  it("with more rows than the maximum in a Draft, still being edited", async () => {
    const id = (await ok(createDraft({ items: [...rows, ...rows] }), 201)).json().id as string;
    expect((await answersOf(engineer, id)).items).toHaveLength(4);
  });
});

describe("a wrong cell", () => {
  const bad = [rows[0], { fixture: "Panel light", quantity: "30" }];
  const refused = { error: "invalid_answers", fields: [{ key: "items", code: "wrong_type", row: 1, column: "quantity" }] };

  it("is refused on create, naming its row and column", async () => {
    const res = await createDraft({ items: bad });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: refused });
  });

  it("is refused on Save draft, and changes nothing", async () => {
    const id = (await ok(createDraft({ items: rows }), 201)).json().id as string;
    const res = await save(engineer, id, { items: bad });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 422, body: refused });
    expect(await answersOf(engineer, id)).toEqual({ items: rows });
  });

  it("includes a cell outside its column's limits", async () => {
    const res = await createDraft({ items: [{ fixture: "Panel light", quantity: -2 }] });
    expect(res.json().fields).toEqual([{ key: "items", code: "below_min", row: 0, column: "quantity" }]);
  });
});

describe("leaving Draft", () => {
  it("is blocked by too few rows, with a per-field error", async () => {
    const id = (await ok(createDraft({}), 201)).json().id as string;
    const res = await tryTake(engineer, id, "send_for_review");
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "items", code: "required" }] },
    });
    await ok(save(engineer, id, { items: rows }));
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("is blocked by too many rows and by a required cell left empty, row by row", async () => {
    const id = (await ok(createDraft({ items: [...rows, ...rows] }), 201)).json().id as string;
    expect((await tryTake(engineer, id, "send_for_review")).json()).toEqual({
      error: "form_incomplete",
      fields: [{ key: "items", code: "too_many_rows" }],
    });
    await ok(save(engineer, id, { items: [rows[0], { fixture: "Panel light", tested: true }] }));
    expect((await tryTake(engineer, id, "send_for_review")).json()).toEqual({
      error: "form_incomplete",
      fields: [{ key: "items", code: "required", row: 1, column: "quantity" }],
    });
  });
});

describe("another Company", () => {
  let id = "";

  beforeAll(async () => {
    id = (await ok(createDraft({ items: rows }), 201)).json().id as string;
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await ok(tryTake(pm, id, "submit"));
  });

  it("sees the whole table once the item reaches them (V13)", async () => {
    expect(await answersOf(consultant, id)).toEqual({ items: rows });
  });

  it("sees it read-only: a save is refused and changes nothing", async () => {
    expect((await detail(consultant, id)).actions.saveAnswers).toBe(false);
    const res = await save(consultant, id, { items: [{ fixture: "Changed", quantity: 1 }] });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
    expect(await answersOf(consultant, id)).toEqual({ items: rows });
  });
});
