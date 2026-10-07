// Seam 1 for the Form's date, time and choice fields (RP-265, spec RP-261): their
// answers round-trip through the API exactly as stored, and a bad value (an
// unknown option, a date that isn't ISO) is refused per field.
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

const TYPE = "MARFT";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "delivery",
      title: { en: "Delivery", ar: "التوريد" },
      fields: [
        { key: "delivery_date", type: "date", required: true, label: { en: "Delivery date", ar: "تاريخ التوريد" } },
        { key: "inspected_at", type: "datetime", label: { en: "Inspected at", ar: "وقت الفحص" } },
        { key: "start_time", type: "time", label: { en: "Start time", ar: "وقت البدء" } },
        { key: "sample_provided", type: "yes_no", required: true, label: { en: "Sample provided", ar: "تم تقديم عينة" } },
        {
          key: "finish",
          type: "select",
          label: { en: "Finish", ar: "التشطيب" },
          options: [
            { value: "galvanised", label: { en: "Galvanised", ar: "مجلفن" } },
            { value: "powder_coated", label: { en: "Powder coated", ar: "مطلي بالبودرة" } },
          ],
        },
        {
          key: "certificates",
          type: "multi_select",
          required: true,
          label: { en: "Certificates", ar: "الشهادات" },
          options: [
            { value: "iso_9001", label: { en: "ISO 9001", ar: "ISO 9001" } },
            { value: "saso", label: { en: "SASO", ar: "ساسو" } },
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

const complete = {
  delivery_date: "2026-10-03",
  inspected_at: "2026-10-03T06:30:00.000Z",
  start_time: "07:30",
  sample_provided: false,
  finish: "powder_coated",
  certificates: ["saso", "iso_9001"],
};

/** The test-only Rabaed Default Type, filled with the Form above and following the MAR's Workflow. */
async function addFieldTypesType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Field types (test)", "ar": "أنواع الحقول (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Field types submittal", "ar": "اعتماد أنواع الحقول"}',
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

/** The Built-in Fields, sent with every set of answers so the date and choice fields are what each test varies. */
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
  await addFieldTypesType();
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

describe("the Form with date, time and choice fields", () => {
  it("comes with each field's type and options", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.schema).toEqual(formSchema.parse(schema));
  });
});

describe("answers round-trip", () => {
  it("on create: exactly as sent, No included", async () => {
    const id = (await ok(createDraft(complete), 201)).json().id as string;
    expect(await answersOf(id)).toEqual(complete);
  });

  it("on Save draft, with required fields still empty, an empty list dropped", async () => {
    const id = (await ok(createDraft({}), 201)).json().id as string;
    await ok(save(id, { start_time: "07:30", finish: "galvanised", certificates: [] }));
    expect(await answersOf(id)).toEqual({ start_time: "07:30", finish: "galvanised" });
    await ok(save(id, complete));
    expect(await answersOf(id)).toEqual(complete);
  });
});

describe("a bad value", () => {
  const bad = {
    delivery_date: "03/10/2026",
    inspected_at: "2026-10-03T09:30:00+03:00",
    start_time: "7:30",
    sample_provided: "yes",
    finish: "painted",
    certificates: ["saso", "ul"],
  };
  const perField = [
    { key: "delivery_date", code: "invalid_format" },
    { key: "inspected_at", code: "invalid_format" },
    { key: "start_time", code: "invalid_format" },
    { key: "sample_provided", code: "wrong_type" },
    { key: "finish", code: "unknown_option" },
    { key: "certificates", code: "unknown_option" },
  ];

  it("is refused on create, per field in Form order", async () => {
    const res = await createDraft(bad);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: perField });
  });

  it("is refused on Save draft, and changes nothing", async () => {
    const id = (await ok(createDraft({ finish: "galvanised" }), 201)).json().id as string;
    const res = await save(id, { ...complete, finish: "painted" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "finish", code: "unknown_option" }] });
    expect(await answersOf(id)).toEqual({ finish: "galvanised" });
  });
});

describe("leaving Draft", () => {
  it("needs every required date and choice; No counts as an answer", async () => {
    const id = (await ok(createDraft({ finish: "galvanised" }), 201)).json().id as string;
    const send = () => engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });
    const res = await send();
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "delivery_date", code: "required" },
        { key: "sample_provided", code: "required" },
        { key: "certificates", code: "required" },
      ],
    });
    await ok(save(id, { delivery_date: "2026-10-03", sample_provided: false, certificates: ["saso"] }));
    await ok(send());
  });
});
