// Seam 1 for named `attachments` fields (RP-281, spec RP-278; form-engine.md §2):
// a Form asks for specific files, such as a required Datasheet (PDF). A field
// takes only its content types and up to its maximum of files; a required one
// with no confirmed file blocks leaving Draft, per field; Submit freezes them,
// as the Attachments System Field's (RP-269); and anyone who can't see the item
// gets a 404 for the field's Documents and their download URLs.
//
// The MAR Form Version 1 has no attachments field, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has two.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { formSchema, type DocumentList, type FormVersion, type StartedDocumentUpload } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARAT";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "documents",
      title: { en: "Documents", ar: "المستندات" },
      fields: [
        {
          key: "datasheet",
          type: "attachments",
          label: { en: "Datasheet (PDF)", ar: "نشرة البيانات (PDF)" },
          required: true,
          contentTypes: ["application/pdf"],
        },
        { key: "test_certificate", type: "attachments", label: { en: "Test certificate", ar: "شهادة الاختبار" }, maxFiles: 1 },
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

/** The test-only Rabaed Default Type, filled with the Form above and following the MAR's Workflow. */
async function addAttachmentsType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Attachments (test)", "ar": "مرفقات (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Attachments submittal", "ar": "اعتماد مرفقات"}',
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

const draft = async () =>
  (
    await ok(
      engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: TYPE,
        title: "Fixtures",
        answers: { trade: electrical, location: buildingA },
      }),
      201,
    )
  ).json().id as string;

const documentsUrl = (itemId: string) => `/v1/work-items/${itemId}/documents`;
const documentUrl = (itemId: string, documentId: string) => `${documentsUrl(itemId)}/${documentId}`;

type File = { fieldKey?: string; fileName?: string; contentType?: string; body?: string };
const start = (by: Caller, itemId: string, { body = "%PDF-1.7 a datasheet", ...file }: File) =>
  by.post(documentsUrl(itemId), { fileName: "datasheet.pdf", contentType: "application/pdf", sizeBytes: body.length, ...file });

/** Starts, uploads and confirms a file for a field; returns the Document's id. */
async function uploaded(by: Caller, itemId: string, file: File): Promise<string> {
  const body = file.body ?? "%PDF-1.7 a datasheet";
  const started: StartedDocumentUpload = (await ok(start(by, itemId, { ...file, body }), 201)).json();
  const stored = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  expect(stored.status).toBe(200);
  await ok(by.post(`${documentUrl(itemId, started.id)}/confirm`));
  return started.id;
}

const list = async (by: Caller, itemId: string): Promise<DocumentList> => (await ok(by.get(documentsUrl(itemId)), 200)).json();
const refusedWith = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  await addAttachmentsType();
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

describe("the Form with attachments fields", () => {
  it("comes with each field's content types and limits", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/${TYPE}/form`), 200)).json();
    expect(form.schema).toEqual(formSchema.parse(schema));
  });
});

describe("a field's files", () => {
  it("are listed with their field, apart from the Attachments System Field's", async () => {
    const id = await draft();
    const datasheet = await uploaded(engineer, id, { fieldKey: "datasheet" });
    const general = await uploaded(engineer, id, { fileName: "general.pdf" });
    const { documents } = await list(engineer, id);
    expect(documents.map((d) => ({ id: d.id, fieldKey: d.fieldKey }))).toEqual(
      expect.arrayContaining([
        { id: datasheet, fieldKey: "datasheet" },
        { id: general, fieldKey: null },
      ]),
    );
  });

  it("refuse a content type the field doesn't take, even one the Project takes", async () => {
    const id = await draft();
    expect(await refusedWith(start(engineer, id, { fieldKey: "datasheet", fileName: "notes.txt", contentType: "text/plain" }))).toEqual({
      status: 422,
      body: { error: "content_type_not_allowed" },
    });
    expect((await list(engineer, id)).documents).toEqual([]);
  });

  it("refuse a field that isn't an attachments field of the Form", async () => {
    const id = await draft();
    for (const fieldKey of ["trade", "no_such_field"]) {
      expect(await refusedWith(start(engineer, id, { fieldKey }))).toEqual({ status: 422, body: { error: "field_not_found" } });
    }
  });

  it("stop at the field's maximum", async () => {
    const id = await draft();
    await uploaded(engineer, id, { fieldKey: "test_certificate" });
    expect(await refusedWith(start(engineer, id, { fieldKey: "test_certificate" }))).toEqual({
      status: 409,
      body: { error: "too_many_files" },
    });
  });

  it("stop at the maximum even for two uploads started together", async () => {
    const id = await draft();
    const body = "%PDF-1.7 a certificate";
    const first: StartedDocumentUpload = (await ok(start(engineer, id, { fieldKey: "test_certificate", body }), 201)).json();
    const second: StartedDocumentUpload = (await ok(start(engineer, id, { fieldKey: "test_certificate", body }), 201)).json();
    for (const { upload } of [first, second]) await fetch(upload.url, { method: upload.method, headers: upload.headers, body });
    await ok(engineer.post(`${documentUrl(id, first.id)}/confirm`));
    expect(await refusedWith(engineer.post(`${documentUrl(id, second.id)}/confirm`))).toEqual({
      status: 409,
      body: { error: "too_many_files" },
    });
  });
});

describe("leaving Draft", () => {
  it("is refused without the required file, per field; a Document elsewhere doesn't count", async () => {
    const id = await draft();
    await uploaded(engineer, id, { fileName: "general.pdf" });
    await uploaded(engineer, id, { fieldKey: "test_certificate" });
    expect(await refusedWith(tryTake(engineer, id, "send_for_review"))).toEqual({
      status: 422,
      body: { error: "form_incomplete", fields: [{ key: "datasheet", code: "required" }] },
    });
    await uploaded(engineer, id, { fieldKey: "datasheet" });
    await ok(tryTake(engineer, id, "send_for_review"));
  });

  it("counts confirmed files only, and none removed", async () => {
    const id = await draft();
    await ok(start(engineer, id, { fieldKey: "datasheet" }), 201);
    const removed = await uploaded(engineer, id, { fieldKey: "datasheet" });
    await ok(engineer.request("DELETE", documentUrl(id, removed)));
    expect((await tryTake(engineer, id, "send_for_review")).json()).toEqual({
      error: "form_incomplete",
      fields: [{ key: "datasheet", code: "required" }],
    });
  });
});

describe("once Submitted", () => {
  let id = "";
  let datasheet = "";

  beforeAll(async () => {
    id = await draft();
    datasheet = await uploaded(engineer, id, { fieldKey: "datasheet" });
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/pick-up`));
    await ok(tryTake(pm, id, "submit"));
  });

  it("a field's file can't be removed, replaced or added to", async () => {
    expect(await refusedWith(engineer.request("DELETE", documentUrl(id, datasheet)))).toEqual({
      status: 409,
      body: { error: "document_frozen" },
    });
    expect((await start(engineer, id, { fieldKey: "datasheet" })).statusCode).toBe(409);
    expect((await list(engineer, id)).documents.map((d) => ({ id: d.id, frozen: d.frozen }))).toEqual([{ id: datasheet, frozen: true }]);
  });

  it("the Consultant sees the field's file and can download it", async () => {
    expect((await list(consultant, id)).documents.map((d) => d.fieldKey)).toEqual(["datasheet"]);
    await ok(consultant.get(`${documentUrl(id, datasheet)}/download`), 200);
  });

  it("anyone who can't see the item gets a 404 for the field's Documents and their download URLs", async () => {
    await expectHidden(c2Engineer.get(documentsUrl(id)));
    await expectHidden(c2Engineer.get(`${documentUrl(id, datasheet)}/download`));
    await expectHidden(start(c2Engineer, id, { fieldKey: "datasheet" }));
  });
});
