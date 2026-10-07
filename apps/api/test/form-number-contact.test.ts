// Seam 1 for the Form's number, currency, email and phone fields (RP-264, spec
// RP-261): numbers are stored as numbers and contact details as typed, both
// round-trip through the API; an out-of-range number or a bad email address or
// phone number is refused per field.
//
// The MAR Form Version 1 has text fields only, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has every new type.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type FormVersion, type WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { projectMember } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARNC";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "supply",
      title: { en: "Supply", ar: "التوريد" },
      fields: [
        {
          key: "quantity",
          type: "number",
          required: true,
          unit: "m²",
          min: 1,
          max: 5000,
          decimals: 2,
          label: { en: "Quantity", ar: "الكمية" },
        },
        { key: "floors", type: "number", decimals: 0, label: { en: "Floors", ar: "عدد الطوابق" } },
        { key: "unit_price", type: "currency", required: true, min: 0, label: { en: "Unit price", ar: "سعر الوحدة" } },
        { key: "contact_email", type: "email", required: true, label: { en: "Email", ar: "البريد الإلكتروني" } },
        { key: "contact_phone", type: "phone", label: { en: "Phone", ar: "الهاتف" } },
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

const complete = {
  quantity: 1250.5,
  floors: 0,
  unit_price: 87.25,
  contact_email: "sales@supplier.example",
  contact_phone: "+966 50 123 4567",
};

/** The test-only Rabaed Default Type, filled with the Form above and following the MAR's Workflow. */
async function addNumberContactType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Numbers and contacts (test)", "ar": "الأرقام وجهات الاتصال (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Numbers and contacts submittal", "ar": "اعتماد الأرقام وجهات الاتصال"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

/** The Built-in Fields, sent with every set of answers so the number and contact fields are what each test varies. */
const builtIns = () => ({ trade: electrical, location: buildingA });

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Cable trays", answers: { ...builtIns(), ...answers } });

const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });

/** The Form's own answers, without the Built-in Fields. */
const answersOf = async (id: string) => {
  const { answers } = (await ok(engineer.get(`/v1/work-items/${id}`), 200)).json() as WorkItemDetail;
  const { trade: _trade, location: _location, ...own } = answers;
  return own;
};

beforeAll(async () => {
  await addNumberContactType();
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
  // Holds the Contractor review Step that Send for Review leads to.
  await projectMember(api, c1, own, ["project_manager"]);
});

describe("the Form with number and contact fields", () => {
  it("comes with each field's type, limits and currency (SAR by default)", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.schema).toEqual(formSchema.parse(schema));
    expect(form.schema.sections[0]!.fields[2]).toMatchObject({ type: "currency", currency: "SAR" });
  });
});

describe("answers round-trip", () => {
  it("on create: numbers as numbers (0 included), contact details as typed", async () => {
    const id = (await ok(createDraft(complete), 201)).json().id as string;
    const stored = await answersOf(id);
    expect(stored).toEqual(complete);
    expect(typeof stored.quantity).toBe("number");
  });

  it("on Save draft, with required fields still empty; spaces around an email address dropped", async () => {
    const id = (await ok(createDraft({}), 201)).json().id as string;
    await ok(save(id, { floors: 12, contact_email: "  pm@contractor.example " }));
    expect(await answersOf(id)).toEqual({ floors: 12, contact_email: "pm@contractor.example" });
    await ok(save(id, complete));
    expect(await answersOf(id)).toEqual(complete);
  });
});

describe("a bad value", () => {
  const bad = {
    quantity: 5000.01,
    floors: 2.5,
    unit_price: "87.25",
    contact_email: "sales@supplier",
    contact_phone: "050 123 456",
  };
  const perField = [
    { key: "quantity", code: "above_max" },
    { key: "floors", code: "too_many_decimals" },
    { key: "unit_price", code: "wrong_type" },
    { key: "contact_email", code: "invalid_format" },
    { key: "contact_phone", code: "invalid_format" },
  ];

  it("is refused on create, per field in Form order", async () => {
    const res = await createDraft(bad);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: perField });
  });

  it("is refused on Save draft, and changes nothing", async () => {
    const id = (await ok(createDraft({ quantity: 10 }), 201)).json().id as string;
    const res = await save(id, { ...complete, quantity: 0.5, contact_email: "not an email" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "invalid_answers",
      fields: [
        { key: "quantity", code: "below_min" },
        { key: "contact_email", code: "invalid_format" },
      ],
    });
    expect(await answersOf(id)).toEqual({ quantity: 10 });
  });
});

describe("leaving Draft", () => {
  it("needs every required number and contact; 0 counts as an answer", async () => {
    const id = (await ok(createDraft({ floors: 0 }), 201)).json().id as string;
    const send = () => engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });
    const res = await send();
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "quantity", code: "required" },
        { key: "unit_price", code: "required" },
        { key: "contact_email", code: "required" },
      ],
    });
    await ok(save(id, { floors: 0, quantity: 1, unit_price: 0, contact_email: "pm@contractor.example" }));
    await ok(send());
  });
});
