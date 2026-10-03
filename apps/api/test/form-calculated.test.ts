// Seam 1 for the Form's `calculated` field (RP-283, spec RP-278; form-engine.md
// §2.4): the server works the result out on every save, whatever the client
// sent, and stores it with the answers, so the answer hash covers it; a required
// calculated field that is empty blocks leaving Draft.
//
// The MAR Form Version 1 has no calculated field, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has one.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type FormVersion, type WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARCL";
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
          columns: [
            { key: "fixture", type: "text", label: { en: "Fixture type", ar: "نوع التجهيز" } },
            { key: "quantity", type: "number", label: { en: "Quantity", ar: "الكمية" }, min: 0, decimals: 0 },
          ],
        },
        { key: "unit_price", type: "currency", label: { en: "Unit price", ar: "سعر الوحدة" }, min: 0 },
        {
          key: "total",
          type: "calculated",
          label: { en: "Total", ar: "الإجمالي" },
          formula: "sum(items.quantity) × unit_price",
          decimals: 2,
          required: true,
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

const items = [
  { fixture: "Downlight", quantity: 12 },
  { fixture: "Panel light", quantity: 30 },
];

/** The test-only Rabaed Default Type, filled with the Form above and following the MAR's Workflow. */
async function addCalculatedType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Calculated (test)", "ar": "محسوب (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Calculated submittal", "ar": "اعتماد محسوب"}',
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

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** The Built-in Fields, sent with every set of answers so the Form's own fields are what each test varies. */
const builtIns = () => ({ trade: electrical, location: buildingA });

const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Fixtures", answers: { ...builtIns(), ...answers } });
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const take = (id: string, transition: string) =>
  engineer.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID() });
const answersOf = async (id: string) => {
  const detail: WorkItemDetail = (await ok(engineer.get(`/v1/work-items/${id}`), 200)).json();
  const { trade: _trade, location: _location, ...own } = detail.answers;
  return own;
};
/** The answers as stored, which the answer hash is taken over (read as the migrator: the app role can't, ADR 0012). */
const storedData = async (id: string) =>
  (await sql<{ data: Record<string, unknown> }>`select data from work_item where id = ${id}::uuid`.execute(migrator)).rows[0]!.data;

beforeAll(async () => {
  await addCalculatedType();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const projectMember = async (positions: string[]) => {
    const { member, caller } = await api.member(c1.caller);
    await api.addProjectMember(c1.caller, own, member.id);
    await ok(c1.caller.request("PUT", `/v1/participants/${own}/members/${member.id}/visibility`, { trade: all, location: all }));
    await ok(c1.caller.request("PUT", `/v1/participants/${own}/members/${member.id}/positions`, { positions }));
    return caller;
  };
  engineer = await projectMember(["engineer"]);
  // Holds Internal Review, so the item can be sent there.
  await projectMember(["project_manager"]);
});

describe("the Form with a calculated field", () => {
  it("comes with its formula and decimals", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.schema).toEqual(formSchema.parse(schema));
  });
});

describe("the server's result", () => {
  it("is worked out on create and stored with the answers", async () => {
    const id = (await ok(createDraft({ items, unit_price: 80.25 }), 201)).json().id as string;
    expect(await answersOf(id)).toEqual({ items, unit_price: 80.25, total: 3370.5 });
    expect(await storedData(id)).toEqual({ items, unit_price: 80.25, total: 3370.5 });
  });

  it("replaces a value the client sent, on create and on Save draft", async () => {
    const id = (await ok(createDraft({ items, unit_price: 10, total: 1 }), 201)).json().id as string;
    expect((await answersOf(id)).total).toBe(420);
    await ok(save(id, { items: [items[0]], unit_price: 10, total: 999_999 }));
    expect(await answersOf(id)).toEqual({ items: [items[0]], unit_price: 10, total: 120 });
    expect((await storedData(id)).total).toBe(120);
  });

  it("is never refused for the client's value, whatever its type", async () => {
    const id = (await ok(createDraft({ items, unit_price: 10, total: "lots" }), 201)).json().id as string;
    expect((await answersOf(id)).total).toBe(420);
  });

  it("is cleared when an input is cleared, even if the client still sends one", async () => {
    const id = (await ok(createDraft({ items, unit_price: 10 }), 201)).json().id as string;
    await ok(save(id, { items, total: 420 }));
    expect(await answersOf(id)).toEqual({ items });
    expect(await storedData(id)).toEqual({ items });
  });
});

describe("leaving Draft", () => {
  it("is blocked while a required calculated field is empty, then goes ahead on the stored answers", async () => {
    const id = (await ok(createDraft({ items, total: 420 }), 201)).json().id as string;
    const res = await take(id, "send_for_review");
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "total", code: "required" }] },
    });
    await ok(save(id, { items, unit_price: 10 }));
    // The database lets the item move on only with the hash of answers the api found complete,
    // so the stored result is the one that was checked.
    await ok(take(id, "send_for_review"));
    expect((await answersOf(id)).total).toBe(420);
  });
});
