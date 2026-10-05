// Seam 1 for who fills which Form Section (RP-301, spec RP-299; form-engine.md
// §4): a Form Section names the Workflow Steps where it is edited (`editable_at`).
// Publishing checks those Steps against the Type's Workflow. The raiser sees a
// section filled by another Participant read-only and empty, marked with who
// fills it, and a save into it is refused as a whole (visibility.md scenario
// 46's shape, with a test-only Form: the MAR Form Version 4 comes in Form 3-07).
//
// The Form is test-only: a Rabaed Default Work Item Type (the MAR's Workflow)
// pointed at a new Form on every run, so its Versions start from 1.
import { randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormToFill, WorkItemDetail } from "@rabaed/domain";
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

const TYPE = "MARFS";
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
const material = { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] };
const verification = (editableAt: string[]) => ({
  key: "verification",
  title: bilingual("Consultant verification"),
  editable_at: editableAt,
  fields: [
    { key: "sample_checked", type: "yes_no", label: bilingual("Sample checked") },
    { key: "verification_note", type: "textarea", label: bilingual("Verification note") },
  ],
});
const schema = { sections: [material, verification(["consultant_review"]), classification] };

let formId = "";
let engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

/** A new Form for the test Type, so every run publishes its Versions from 1. */
async function newFormForTestType(): Promise<string> {
  const { id } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Form Sections (test)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  await sql`
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    select 'rabaed', module_key, ${TYPE}, '{"en": "Form Sections submittal", "ar": "اعتماد أقسام النموذج"}',
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
const create = (answers: Record<string, unknown>) =>
  engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Fire doors", answers: { ...builtIns(), ...answers } });
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const detail = async (id: string): Promise<WorkItemDetail> => (await ok(engineer.get(`/v1/work-items/${id}`), 200)).json();
/** The Form's own answers, without the Built-in Fields. */
const answersOf = async (id: string) => {
  const { trade: _trade, location: _location, ...own } = (await detail(id)).answers;
  return own;
};

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

describe("publishing a Form whose sections name Steps", () => {
  it("refuses a Step the Type's Workflow doesn't have, naming the section", async () => {
    const unknown = { sections: [material, verification(["consultant_review", "site_visit"]), classification] };
    expect(await publishFormVersion(migrator, formId, unknown)).toEqual({
      ok: false,
      reason: "schema_problems",
      problems: [{ key: "verification", code: "unknown_step" }],
    });
  });

  it("refuses Steps held by two different Participant roles in one section", async () => {
    const mixed = { sections: [material, verification(["internal_review", "consultant_review"]), classification] };
    expect(await publishFormVersion(migrator, formId, mixed)).toEqual({
      ok: false,
      reason: "schema_problems",
      problems: [{ key: "verification", code: "mixed_roles" }],
    });
  });

  it("refuses a link question in a section the Consultant fills, naming the section", async () => {
    const held = verification(["consultant_review"]);
    const links = { ...held, fields: [...held.fields, { key: "relies_on", type: "work_item_ref", label: bilingual("Relies on") }] };
    expect(await publishFormVersion(migrator, formId, { sections: [material, links, classification] })).toEqual({
      ok: false,
      reason: "schema_problems",
      problems: [{ key: "verification", code: "not_for_other_participant" }],
    });
  });

  it("publishes one consistent with the Workflow", async () => {
    expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true, versionNo: 1 });
  });
});

describe("a section filled by another Participant, to the raiser", () => {
  const consultant = { en: "Consultant", ar: "الاستشاري" };

  it("is read-only and marked with who fills it on a new item's Form", async () => {
    const form: FormToFill = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.editableSections).toEqual(["material", "classification"]);
    expect(form.filledBy).toEqual({ verification: consultant });
  });

  it("can't be answered when the item is created", async () => {
    const res = await create({ model: "FD-90", sample_checked: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_editable" });
  });

  describe("on a Draft", () => {
    let id = "";
    beforeAll(async () => {
      id = (await ok(create({ model: "FD-90" }), 201)).json().id as string;
    });

    it("is empty and read-only, marked with who fills it", async () => {
      const form: FormToFill = (await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json();
      expect(form.editableSections).toEqual(["material", "classification"]);
      expect(form.filledBy).toEqual({ verification: consultant });
      expect(await answersOf(id)).toEqual({ model: "FD-90" });
    });

    it("refuses a save into it as a whole, writing nothing", async () => {
      const res = await save(id, { model: "FD-120", verification_note: "Checked on site" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: "not_editable" });
      expect(await answersOf(id)).toEqual({ model: "FD-90" });
    });

    it("still takes the raiser's own answers, with the section left as it is", async () => {
      await ok(save(id, { model: "FD-120" }));
      expect(await answersOf(id)).toEqual({ model: "FD-120" });
    });
  });

  it("stays read-only at the raiser's internal Step", async () => {
    const id = (await ok(create({ model: "FD-90" }), 201)).json().id as string;
    await ok(engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() }));
    const form: FormToFill = (await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json();
    expect(form.editableSections).toEqual(["material", "classification"]);
    const res = await save(id, { model: "FD-90", sample_checked: false });
    expect(res.statusCode).toBe(409);
    expect(await answersOf(id)).toEqual({ model: "FD-90" });
  });
});
