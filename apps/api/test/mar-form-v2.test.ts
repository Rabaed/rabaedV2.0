// Seam 1 for the MAR Form Version 2 (RP-286, spec RP-278; form-engine.md §2.5):
// a MAR records what real submittals contain: its Items as a table with a total
// quantity, a required Datasheet (PDF), an optional Test certificate and Sample
// photo. New MARs pin Version 2; a MAR already on Version 1 keeps showing and
// validating with Version 1, leaving Draft included. Version 2 passes the
// part-1 publish checks against Version 1.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, publishProblems, tableTotals, type FormVersion, type TableField, type WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, uploadDocument, type Caller } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

let engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** The MAR Form's published Versions, oldest first, as stored. */
async function marVersions() {
  const { rows } = await sql<{ id: string; version_no: number; schema: unknown }>`
    select v.id, v.version_no, v.schema from form_version v
    join work_item_type t on t.form_definition_id = v.form_definition_id
    where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.status = 'published'
    order by v.version_no
  `.execute(migrator);
  return rows;
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const items = [
  { fixture_type: "Downlight", description: "LED downlight, 12 W", quantity: 120, unit: "pcs" },
  { fixture_type: "Linear", description: "LED linear, 1.2 m", quantity: 36.5, unit: "m" },
];
const complete = { manufacturer: "Philips", model: "CoreLine", specification_section: "26 51 00", description: "LED fixtures", items };
const created = async (answers: Record<string, unknown>) =>
  (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Lighting fixtures", answers: { ...builtIns(), ...answers } }), 201)).json()
    .id as string;
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const send = (id: string) => engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() });
const detail = async (id: string): Promise<WorkItemDetail> => (await ok(engineer.get(`/v1/work-items/${id}`), 200)).json();

beforeAll(async () => {
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

describe("the MAR Form Version 2", () => {
  it("is the MAR's latest Version, and passes the part-1 publish checks against Version 1", async () => {
    const versions = await marVersions();
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
    const [v1, v2] = versions.map((v) => formSchema.parse(v.schema));
    const { rows: lists } = await sql<{ id: string }>`select id from option_list`.execute(migrator);
    expect(publishProblems(v2!, [v1!], { optionListIds: new Set(lists.map((l) => l.id)) })).toEqual([]);
  });

  it("asks for the material, its Items with a total quantity, the Datasheet, Test certificate and Sample photo, and Trade, Location and Scopes", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    expect(form.versionNo).toBe(2);
    const fields = form.schema.sections.flatMap((s) => s.fields);
    expect(fields.map((f) => [f.key, f.type, "required" in f ? f.required : undefined])).toEqual([
      ["manufacturer", "text", true],
      ["model", "text", false],
      ["specification_section", "text", false],
      ["description", "textarea", true],
      ["items", "table", false],
      ["datasheet", "attachments", true],
      ["test_certificate", "attachments", false],
      ["sample_photo", "photos", false],
      ["trade", "trade", true],
      ["location", "location", true],
      ["scopes", "scopes", false],
    ]);
    for (const f of fields) expect("label" in f && f.label.en && f.label.ar, f.key).toBeTruthy();
    const table = fields.find((f) => f.key === "items") as TableField;
    expect(table.columns.map((c) => c.key)).toEqual(["fixture_type", "description", "quantity", "unit"]);
    expect(tableTotals(table, items)).toEqual({ quantity: 156.5 });
    expect(fields.find((f) => f.key === "datasheet")).toMatchObject({ contentTypes: ["application/pdf"] });
  });
});

describe("a new MAR", () => {
  it("pins Version 2, and keeps its Items as rows", async () => {
    const [, v2] = await marVersions();
    const id = await created(complete);
    expect(await detail(id)).toMatchObject({ formVersionId: v2!.id, answers: { ...complete } });
  });

  it("can't be sent for review without the Datasheet, refused per field; with it, it can", async () => {
    const id = await created(complete);
    const refused = await send(id);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "form_incomplete", fields: [{ key: "datasheet", code: "required" }] });
    expect((await detail(id)).stage.key).toBe("draft");

    await attachDatasheet(engineer, id);
    await ok(send(id));
    expect((await detail(id)).stage.key).not.toBe("draft");
  });

  it("takes only a PDF as its Datasheet, and only an image as its Sample photo", async () => {
    const id = await created(complete);
    const start = (fieldKey: string, fileName: string, contentType: string) =>
      engineer.post(`/v1/work-items/${id}/documents`, { fieldKey, fileName, contentType, sizeBytes: 10 });
    expect((await start("datasheet", "datasheet.png", "image/png")).json()).toEqual({ error: "content_type_not_allowed" });
    expect((await start("sample_photo", "photo.pdf", "application/pdf")).json()).toEqual({ error: "content_type_not_allowed" });
    await uploadDocument(engineer, id, { fieldKey: "test_certificate", fileName: "certificate.pdf", contentType: "application/pdf", body: "%PDF-1.7 a certificate" });
  });
});

describe("a MAR on Version 1", () => {
  let onVersion1 = "";

  beforeAll(async () => {
    // Started before Version 2 was published: pinned to Version 1, with Version 1's answers.
    const [v1] = await marVersions();
    onVersion1 = await created({ manufacturer: "Zumtobel" });
    await sql`update work_item set form_version_id = ${v1!.id}::uuid where id = ${onVersion1}::uuid`.execute(migrator);
  });

  it("keeps showing Version 1", async () => {
    const [v1] = await marVersions();
    expect((await detail(onVersion1)).formVersionId).toBe(v1!.id);
    const form: FormVersion = (await ok(engineer.get(`/v1/work-items/${onVersion1}/form`), 200)).json();
    expect(form.versionNo).toBe(1);
  });

  it("validates with Version 1's rules, and leaves Draft with them: no Datasheet needed", async () => {
    // Version 2's Items are unknown to it; Version 1's quantity is still its own.
    const refused = await save(onVersion1, { manufacturer: "Zumtobel", items });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "invalid_answers", fields: [{ key: "items", code: "unknown_field" }] });
    // Version 1's required description still blocks leaving Draft.
    const incomplete = await send(onVersion1);
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toEqual({ error: "form_incomplete", fields: [{ key: "description", code: "required" }] });

    const v1Answers = { manufacturer: "Zumtobel", quantity: 48, description: "Emergency luminaires" };
    await ok(save(onVersion1, v1Answers));
    await ok(send(onVersion1));
    expect(await detail(onVersion1)).toMatchObject({ answers: v1Answers });
  });
});
