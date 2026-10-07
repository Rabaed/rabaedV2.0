// Seam 1 for the Form's `checklist` field (RP-285, spec RP-278; form-engine.md §3):
// inspections are recorded item by item. Answers are stored per item and come back
// exactly as sent; a negative answer (No, Fail) without the comment or photo its item
// requires blocks Send for Review, per item, and with them the Send succeeds; an
// item's photos are Documents tied to the checklist and the item (they take only
// images, only on an item that has photos, at most 10), and anyone who can't see the
// item gets a 404 for them (V13).
//
// The MAR Form Version 1 has no checklist, so this file adds a test-only Rabaed
// Default Type (the MAR's Workflow) whose Form has one.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, StartedDocumentUpload } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARCK";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "inspection",
      title: { en: "Inspection", ar: "الفحص" },
      fields: [
        {
          key: "pour_check",
          type: "checklist",
          label: { en: "Pour check", ar: "فحص الصب" },
          items: [
            // A failed cover needs a comment and a photo.
            { key: "rebar_cover", text: bilingual("Rebar cover"), answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative" },
            // A failed formwork check needs a photo only.
            { key: "formwork", text: bilingual("Formwork"), answers: "pass_fail_na", comment: "optional", photo: "required_on_negative" },
            { key: "permit_on_site", text: bilingual("Permit on site"), answers: "yes_no_na", comment: "off", photo: "off" },
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

/** The test-only Rabaed Default Type, with the Form above and following the MAR's Workflow. */
async function addChecklistType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Checklist (test)", "ar": "قائمة فحص (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Checklist submittal", "ar": "اعتماد قائمة فحص"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let engineer: Caller; // Raises the item; holds Attach.
let pm: Caller; // Holds Internal Review and Submits.
let consultant: Caller; // Another Company, which sees the item once Submitted.
let c2Engineer: Caller; // Another Contractor, which never sees the item.
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const createDraft = async (answers: Record<string, unknown> = {}) =>
  (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Pour 7", answers: { ...builtIns(), ...answers } }), 201)).json()
    .id as string;
const save = (id: string, answers: Record<string, unknown>) =>
  engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } });
const checklistOf = async (by: Caller, id: string) => (await detail(by, id)).answers.pour_check;

const documentsUrl = (itemId: string) => `/v1/work-items/${itemId}/documents`;
const documentUrl = (itemId: string, documentId: string) => `${documentsUrl(itemId)}/${documentId}`;

type Photo = { itemKey?: string | null; fieldKey?: string; fileName?: string; contentType?: string; body?: Buffer | string };
const start = (by: Caller, id: string, { body = jpegWithExif(), itemKey = "rebar_cover", ...file }: Photo = {}) =>
  by.post(documentsUrl(id), {
    fileName: "evidence.jpg",
    contentType: "image/jpeg",
    fieldKey: "pour_check",
    sizeBytes: Buffer.byteLength(body),
    ...(itemKey === null ? {} : { itemKey }),
    ...file,
  });

/** Starts, uploads and confirms an item's photo; returns the Document's id. */
async function uploaded(by: Caller, id: string, file: Photo = {}): Promise<string> {
  const body = file.body ?? jpegWithExif();
  const started: StartedDocumentUpload = (await ok(start(by, id, { ...file, body }), 201)).json();
  const stored = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  expect(stored.status).toBe(200);
  await ok(by.post(`${documentUrl(id, started.id)}/confirm`));
  return started.id;
}

const list = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(documentsUrl(id)), 200)).json();
const refusedWith = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  await addChecklistType();
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
  const other = async (role: "consultant" | "contractor", positions: string[]) => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return projectMember(api, company, participantId, positions);
  };
  consultant = await other("consultant", ["manager"]);
  c2Engineer = await other("contractor", ["engineer"]);
});

const answers = {
  rebar_cover: { answer: "pass" },
  formwork: { answer: "fail", comment: "Gap at the corner" },
  permit_on_site: { answer: "na" },
};

describe("a checklist's answers", () => {
  it("round-trip exactly as sent, per item, on create and on Save draft", async () => {
    const id = await createDraft({ pour_check: answers });
    expect(await checklistOf(engineer, id)).toEqual(answers);
    await ok(save(id, { pour_check: { permit_on_site: { answer: "yes" } } }));
    expect(await checklistOf(engineer, id)).toEqual({ permit_on_site: { answer: "yes" } });
  });

  it("keep a Fail's evidence out of a Draft's way: saving it is never refused", async () => {
    const id = await createDraft({ pour_check: { rebar_cover: { answer: "fail" } } });
    expect(await checklistOf(engineer, id)).toEqual({ rebar_cover: { answer: "fail" } });
  });

  it("are refused when an answer isn't in its item's set, naming the item", async () => {
    const res = await engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: TYPE,
      title: "Pour 7",
      answers: { ...builtIns(), pour_check: { permit_on_site: { answer: "pass" } } },
    });
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 422,
      body: { error: "invalid_answers", fields: [{ key: "pour_check", code: "unknown_option", item: "permit_on_site" }] },
    });
  });
});

describe("an item's photos", () => {
  it("are Documents tied to the checklist and the item, with the file's time and place", async () => {
    const id = await createDraft();
    const photo = await uploaded(engineer, id, { itemKey: "formwork", body: jpegWithExif({ takenAt: "2026:10:03 14:22:05", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 }) });
    expect((await list(engineer, id)).documents).toEqual([
      expect.objectContaining({
        id: photo,
        fieldKey: "pour_check",
        itemKey: "formwork",
        takenAt: "2026-10-03T11:22:05.000Z",
        takenWhere: { latitude: 24.7136, longitude: 46.6753 },
      }),
    ]);
  });

  it("are refused on an item that takes none, on an item the checklist doesn't have, and for no item at all", async () => {
    const id = await createDraft();
    expect(await refusedWith(start(engineer, id, { itemKey: "permit_on_site" }))).toEqual({ status: 422, body: { error: "field_not_found" } });
    expect(await refusedWith(start(engineer, id, { itemKey: "welding" }))).toEqual({ status: 422, body: { error: "field_not_found" } });
    expect(await refusedWith(start(engineer, id, { itemKey: null }))).toEqual({ status: 422, body: { error: "field_not_found" } });
    expect((await list(engineer, id)).documents).toEqual([]);
  });

  it("take images only", async () => {
    const id = await createDraft();
    expect(await refusedWith(start(engineer, id, { fileName: "note.pdf", contentType: "application/pdf", body: "%PDF-1.7" }))).toEqual({
      status: 422,
      body: { error: "content_type_not_allowed" },
    });
  });

  it("are at most 10 to an item", async () => {
    const id = await createDraft();
    for (let i = 0; i < 10; i++) await uploaded(engineer, id, { itemKey: "formwork" });
    expect(await refusedWith(start(engineer, id, { itemKey: "formwork" }))).toEqual({ status: 409, body: { error: "too_many_files" } });
    await uploaded(engineer, id, { itemKey: "rebar_cover" });
  });
});

describe("leaving Draft", () => {
  it("is refused for a Fail without the comment and photo its item requires, item by item", async () => {
    const id = await createDraft({ pour_check: { rebar_cover: { answer: "fail" }, formwork: { answer: "fail" } } });
    expect((await tryTake(engineer, id, "send_for_review")).json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "pour_check", code: "comment_required", item: "rebar_cover" },
        { key: "pour_check", code: "photo_required", item: "rebar_cover" },
        { key: "pour_check", code: "photo_required", item: "formwork" },
      ],
    });
  });

  it("is still refused for an item whose photo is another item's", async () => {
    const id = await createDraft({ pour_check: { rebar_cover: { answer: "fail", comment: "Cover 15 mm" }, formwork: { answer: "fail" } } });
    await uploaded(engineer, id, { itemKey: "rebar_cover" });
    expect((await tryTake(engineer, id, "send_for_review")).json().fields).toEqual([{ key: "pour_check", code: "photo_required", item: "formwork" }]);
  });

  it("succeeds once every Fail has its evidence", async () => {
    const id = await createDraft({ pour_check: { rebar_cover: { answer: "fail", comment: "Cover 15 mm" }, formwork: { answer: "fail" } } });
    await uploaded(engineer, id, { itemKey: "rebar_cover" });
    await uploaded(engineer, id, { itemKey: "formwork" });
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("is not held up by a Pass or N/A, which needs no evidence", async () => {
    const id = await createDraft({ pour_check: answers });
    expect((await tryTake(engineer, id, "send_for_review")).json().fields).toEqual([{ key: "pour_check", code: "photo_required", item: "formwork" }]);
    await uploaded(engineer, id, { itemKey: "formwork" });
    await ok(tryTake(engineer, id, "send_for_review"));
  });
});

describe("once Submitted", () => {
  let id = "";
  let photo = "";

  beforeAll(async () => {
    id = await createDraft({ pour_check: { rebar_cover: { answer: "fail", comment: "Cover 15 mm" }, formwork: { answer: "pass" } } });
    photo = await uploaded(engineer, id, { itemKey: "rebar_cover" });
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm, id, "submit"));
  });

  it("the Consultant reads the checklist's answers and sees the evidence, and can download it", async () => {
    expect(await checklistOf(consultant, id)).toEqual({ rebar_cover: { answer: "fail", comment: "Cover 15 mm" }, formwork: { answer: "pass" } });
    expect(await list(consultant, id)).toMatchObject({
      documents: [{ id: photo, fieldKey: "pour_check", itemKey: "rebar_cover", frozen: true }],
    });
    await ok(consultant.get(`${documentUrl(id, photo)}/download`), 200);
  });

  it("anyone who can't see the item gets a 404 for its photos and their download URLs", async () => {
    await expectHidden(c2Engineer.get(documentsUrl(id)));
    await expectHidden(c2Engineer.get(`${documentUrl(id, photo)}/download`));
    await expectHidden(start(c2Engineer, id));
  });

  it("no more photos can be added, or removed: the evidence is frozen", async () => {
    expect((await start(engineer, id, { itemKey: "rebar_cover" })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await engineer.request("DELETE", documentUrl(id, photo))).statusCode).toBeGreaterThanOrEqual(400);
  });
});
