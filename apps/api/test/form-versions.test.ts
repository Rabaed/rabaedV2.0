// Seam 1 for publishing Form Versions (RP-271, spec RP-261; form-engine.md §7):
// publishing Version 2 of a Form moves new Work Items onto it, while an item
// pinned to Version 1 keeps showing and validating with Version 1, leaving
// Draft included. A schema the publish-time checks refuse is never published.
//
// The Form is test-only: a Rabaed Default Work Item Type (the MAR's Workflow)
// pointed at a new Form on every run, so its Versions start from 1.
import { randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormVersion } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARVR";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const classification = {
  key: "classification",
  title: bilingual("Classification"),
  fields: [
    { key: "trade", type: "trade", label: bilingual("Trade") },
    { key: "location", type: "location", label: bilingual("Location") },
    { key: "scopes", type: "scopes", label: bilingual("Scopes") },
  ],
};

/** Version 1: a required colour. */
const version1 = {
  sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "colour", type: "text", required: true, label: bilingual("Colour") }] }, classification],
};
/** Version 2 drops the colour and asks whether it is fire rated. */
const version2 = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "fire_rated", type: "yes_no", required: true, label: bilingual("Fire rated") }] },
    classification,
  ],
};

let formId = "";
let engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

/** A new Form for the test Type, so every run publishes its Versions from 1. */
async function newFormForTestType(): Promise<string> {
  const { id } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Versions (test)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  await sql`
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    select 'rabaed', module_key, ${TYPE}, '{"en": "Versions submittal", "ar": "اعتماد الإصدارات"}',
      workflow_definition_id, outcome_kind, ${id}::uuid
    from work_item_type where owner_kind = 'rabaed' and code = 'MAR'
    on conflict do nothing
  `.execute(migrator);
  await migrator.updateTable("work_item_type").set({ form_definition_id: id }).where("owner_kind", "=", "rabaed").where("code", "=", TYPE).execute();
  return id;
}

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const newItemForm = async (): Promise<FormVersion> => (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
const created = async (answers: Record<string, unknown>) =>
  (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Fire doors", answers: { ...builtIns(), ...answers } }), 201)).json()
    .id as string;
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const send = (id: string) => engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", confirmed: true, idempotencyKey: randomUUID() });

beforeAll(async () => {
  formId = await newFormForTestType();
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

describe("publishing Version 2 of a Form", () => {
  let onVersion1 = "";
  let v1: FormVersion;
  let v2: FormVersion;

  beforeAll(async () => {
    expect(await publishFormVersion(migrator, formId, version1)).toMatchObject({ ok: true, versionNo: 1 });
    v1 = await newItemForm();
    // Started on Version 1, colour still to fill.
    onVersion1 = await created({});
    expect(await publishFormVersion(migrator, formId, version2)).toMatchObject({ ok: true, versionNo: 2 });
    v2 = await newItemForm();
  });

  it("gives new items Version 2, and pins them to it", async () => {
    expect(v2).toMatchObject({ versionNo: 2, schema: { sections: [{ fields: [{ key: "fire_rated" }] }, {}] } });
    const id = await created({ fire_rated: false });
    expect(await detail(engineer, id)).toMatchObject({ formVersionId: v2.id, answers: { fire_rated: false } });
    expect((await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json()).toEqual(v2);
    await ok(send(id));
  });

  it("leaves an item on Version 1 showing Version 1", async () => {
    expect(v1.versionNo).toBe(1);
    expect((await detail(engineer, onVersion1)).formVersionId).toBe(v1.id);
    expect((await ok(engineer.get(`/v1/work-items/${onVersion1}/form`), 200)).json()).toEqual(v1);
  });

  it("keeps validating that item with Version 1, leaving Draft included", async () => {
    // Version 2's field is unknown to it.
    const refused = await save(onVersion1, { fire_rated: true });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "invalid_answers", fields: [{ key: "fire_rated", code: "unknown_field" }] });
    // Version 1's required colour, which Version 2 no longer has, still blocks leaving Draft.
    const incomplete = await send(onVersion1);
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toEqual({ error: "form_incomplete", fields: [{ key: "colour", code: "required" }] });
    await ok(save(onVersion1, { colour: "Red" }));
    await ok(send(onVersion1));
    expect(await detail(engineer, onVersion1)).toMatchObject({ formVersionId: v1.id, answers: { colour: "Red" } });
  });
});

describe("a schema the publish-time checks refuse", () => {
  it("is never published: new items stay on the latest Version", async () => {
    const before = await newItemForm();
    // Version 1's `colour` was text: a later Version can't make it Yes/No, even after Version 2 dropped it.
    const reused = {
      sections: [{ ...version2.sections[0], fields: [{ key: "colour", type: "yes_no", label: bilingual("Coloured") }] }, classification],
    };
    expect(await publishFormVersion(migrator, formId, reused)).toEqual({
      ok: false,
      reason: "schema_problems",
      problems: [{ key: "colour", code: "key_type_changed" }],
    });
    const withoutBuiltIns = { sections: [version2.sections[0]] };
    expect(await publishFormVersion(migrator, formId, withoutBuiltIns)).toMatchObject({
      ok: false,
      reason: "schema_problems",
      problems: [
        { key: "trade", code: "built_in_missing" },
        { key: "location", code: "built_in_missing" },
        { key: "scopes", code: "built_in_missing" },
      ],
    });
    expect(await publishFormVersion(migrator, formId, { sections: [] })).toMatchObject({ ok: false, reason: "invalid_schema" });
    expect(await newItemForm()).toEqual(before);
  });

  it("is refused when an Option List field or table column names a list that doesn't exist (RP-282), and takes one that does", async () => {
    const withList = (list: string) => ({
      sections: [
        {
          ...version2.sections[0],
          fields: [
            { key: "grade", type: "option_list", label: bilingual("Grade"), list },
            {
              key: "items",
              type: "table",
              label: bilingual("Items"),
              columns: [{ key: "kind", type: "option_list", label: bilingual("Kind"), list }],
            },
          ],
        },
        classification,
      ],
    });
    const before = await newItemForm();
    expect(await publishFormVersion(migrator, formId, withList(randomUUID()))).toEqual({
      ok: false,
      reason: "schema_problems",
      problems: [
        { key: "grade", code: "unknown_option_list" },
        { key: "items", code: "unknown_option_list" },
      ],
    });
    expect(await newItemForm()).toEqual(before);

    const { rows } = await sql<{ id: string }>`
      insert into option_list (name) values ('{"en": "Versions (test)", "ar": "إصدارات (اختبار)"}') returning id
    `.execute(migrator);
    expect(await publishFormVersion(migrator, formId, withList(rows[0]!.id))).toMatchObject({ ok: true });
  });

  it("is refused for a Form that doesn't exist", async () => {
    expect(await publishFormVersion(migrator, randomUUID(), version1)).toEqual({ ok: false, reason: "form_not_found" });
  });
});
