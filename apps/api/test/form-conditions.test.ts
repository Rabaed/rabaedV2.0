// Seam 1 for Form conditions (RP-267, spec RP-261): an answer to a field that
// becomes hidden is cleared on save, and a conditionally required field blocks
// leaving Draft only while it is shown. The API runs the shared validator, so
// it clears exactly what the browser does.
//
// The MAR Form Version 1 has no conditions, so this file adds a test-only
// Rabaed Default Work Item Type (the MAR's Workflow) whose Form has them.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail } from "@rabaed/domain";
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

const TYPE = "MARCO";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "sample",
      title: { en: "Sample", ar: "العينة" },
      fields: [
        { key: "sample_heading", type: "heading", text: { en: "About the sample", ar: "عن العينة" } },
        { key: "sample_provided", type: "yes_no", required: true, label: { en: "Sample provided", ar: "تم تقديم عينة" } },
        {
          key: "sample_reference",
          type: "text",
          required: true,
          visible_if: { field: "sample_provided", op: "=", value: true },
          label: { en: "Sample reference", ar: "مرجع العينة" },
        },
        {
          key: "finish",
          type: "select",
          label: { en: "Finish", ar: "التشطيب" },
          options: [
            { value: "galvanised", label: { en: "Galvanised", ar: "مجلفن" } },
            { value: "other", label: { en: "Other", ar: "أخرى" } },
          ],
        },
        {
          key: "finish_details",
          type: "text",
          required: { field: "finish", op: "=", value: "other" },
          label: { en: "Finish details", ar: "تفاصيل التشطيب" },
        },
      ],
    },
  ],
};
/** The test-only Rabaed Default Type, filled with the conditional Form above and following the MAR's Workflow. */
async function addConditionsType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Conditions (test)", "ar": "الشروط (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Conditions submittal", "ar": "اعتماد الشروط"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let engineer: Caller;
let projectId = "";
let electrical = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const createDraft = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Cable trays", tradeId: electrical, answers });

const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers });

const answersOf = async (id: string) =>
  ((await ok(engineer.get(`/v1/work-items/${id}`), 200)).json() as WorkItemDetail).answers;

beforeAll(async () => {
  await addConditionsType();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
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
  // Holds the Contractor review Step that Send for Review leads to.
  await projectMember(["project_manager"]);
});

const send = (id: string) =>
  engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });

describe("an answer to a field that becomes hidden", () => {
  it("is cleared on save", async () => {
    const id = (await ok(createDraft({ sample_provided: true, sample_reference: "S-1" }), 201)).json().id as string;
    expect(await answersOf(id)).toEqual({ sample_provided: true, sample_reference: "S-1" });
    await ok(save(id, { sample_provided: false, sample_reference: "S-1" }));
    expect(await answersOf(id)).toEqual({ sample_provided: false });
  });

  it("is cleared on create, and isn't checked", async () => {
    const id = (await ok(createDraft({ sample_provided: false, sample_reference: ["not text"] }), 201)).json().id as string;
    expect(await answersOf(id)).toEqual({ sample_provided: false });
  });

  it("is still checked while the field is shown", async () => {
    const res = await createDraft({ sample_provided: true, sample_reference: ["not text"] });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "sample_reference", code: "wrong_type" }] });
  });

  it("can't be given to a layout field", async () => {
    const res = await createDraft({ sample_heading: "x" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "invalid_answers", fields: [{ key: "sample_heading", code: "unknown_field" }] });
  });
});

describe("a conditionally required field", () => {
  it("blocks leaving Draft only while it is shown", async () => {
    const id = (await ok(createDraft({ sample_provided: true }), 201)).json().id as string;
    const res = await send(id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "form_incomplete", fields: [{ key: "sample_reference", code: "required" }] });
    await ok(save(id, { sample_provided: false }));
    await ok(send(id));
  });

  it("blocks leaving Draft only while its required condition holds", async () => {
    const id = (await ok(createDraft({ sample_provided: false, finish: "other" }), 201)).json().id as string;
    const res = await send(id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "form_incomplete", fields: [{ key: "finish_details", code: "required" }] });
    await ok(save(id, { sample_provided: false, finish: "galvanised" }));
    await ok(send(id));
  });
});
