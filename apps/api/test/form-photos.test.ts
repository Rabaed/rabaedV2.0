// Seam 1 for the `photos` field (RP-284, spec RP-278; form-engine.md §2): site
// staff take photos straight into the Form. The field takes images only; each
// photo's EXIF time and GPS are read by the api from the stored file when the
// upload is confirmed (never taken from the browser) and come back with the
// Document, for everyone who sees the item (V13); and anyone who can't see the
// item gets a 404 for its photos and their download URLs.
//
// The MAR Form Version 1 has no photos field, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has one.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, StartedDocumentUpload } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "./support/exif-jpeg.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARPH";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "photos",
      title: { en: "Photos", ar: "الصور" },
      fields: [{ key: "sample_photos", type: "photos", label: { en: "Sample photos", ar: "صور العينة" }, required: true, maxFiles: 4 }],
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
async function addPhotosType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Photos (test)", "ar": "صور (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Photos submittal", "ar": "اعتماد صور"}',
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
const take = (by: Caller, id: string, transition: string) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID() });

const documentsUrl = (itemId: string) => `/v1/work-items/${itemId}/documents`;
const documentUrl = (itemId: string, documentId: string) => `${documentsUrl(itemId)}/${documentId}`;

type File = { fileName?: string; contentType?: string; body?: Buffer | string; extra?: Record<string, unknown> };
const start = (by: Caller, itemId: string, { body = jpegWithExif(), extra = {}, ...file }: File) =>
  by.post(documentsUrl(itemId), {
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    fieldKey: "sample_photos",
    sizeBytes: Buffer.byteLength(body),
    ...file,
    ...extra,
  });

/** Starts, uploads and confirms a photo; returns the Document's id. `extra` goes with the start and the confirm. */
async function uploaded(by: Caller, itemId: string, file: File = {}): Promise<string> {
  const body = file.body ?? jpegWithExif();
  const started: StartedDocumentUpload = (await ok(start(by, itemId, { ...file, body }), 201)).json();
  const stored = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  expect(stored.status).toBe(200);
  await ok(by.post(`${documentUrl(itemId, started.id)}/confirm`, file.extra));
  return started.id;
}

const list = async (by: Caller, itemId: string): Promise<DocumentList> => (await ok(by.get(documentsUrl(itemId)), 200)).json();
const refusedWith = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  await addPhotosType();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const projectMember = async (owner: typeof c1, participantId: string, positions: string[]) => {
    const { member, caller } = await api.member(owner.caller);
    await api.addProjectMember(owner.caller, participantId, member.id);
    await ok(owner.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, { trade: all, location: all }));
    await ok(owner.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
    return caller;
  };
  engineer = await projectMember(c1, own, ["engineer"]);
  pm = await projectMember(c1, own, ["project_manager"]);
  const other = async (role: "consultant" | "contractor", positions: string[]) => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return projectMember(company, participantId, positions);
  };
  consultant = await other("consultant", ["manager"]);
  c2Engineer = await other("contractor", ["engineer"]);
});

const inRiyadh = { takenAt: "2026:10:03 14:22:05", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 };
const documentOf = async (by: Caller, itemId: string, documentId: string) => (await list(by, itemId)).documents.find((d) => d.id === documentId);

describe("a photos field", () => {
  it("refuses a file that isn't an image, even one the Project takes", async () => {
    const id = await draft();
    expect(await refusedWith(start(engineer, id, { fileName: "datasheet.pdf", contentType: "application/pdf", body: "%PDF-1.7" }))).toEqual({
      status: 422,
      body: { error: "content_type_not_allowed" },
    });
    expect((await list(engineer, id)).documents).toEqual([]);
  });

  it("takes several photos, up to its maximum", async () => {
    const id = await draft();
    for (let i = 0; i < 4; i++) await uploaded(engineer, id);
    expect(await refusedWith(start(engineer, id, {}))).toEqual({ status: 409, body: { error: "too_many_files" } });
  });
});

describe("a photo's time and place", () => {
  it("come back with its Document, read from the stored file's EXIF", async () => {
    const id = await draft();
    const photo = await uploaded(engineer, id, { body: jpegWithExif(inRiyadh) });
    expect(await documentOf(engineer, id, photo)).toMatchObject({
      fieldKey: "sample_photos",
      takenAt: "2026-10-03T11:22:05.000Z",
      takenWhere: { latitude: 24.7136, longitude: 46.6753 },
    });
  });

  it("are none for a photo without EXIF", async () => {
    const id = await draft();
    const photo = await uploaded(engineer, id);
    expect(await documentOf(engineer, id, photo)).toMatchObject({ takenAt: null, takenWhere: null });
  });

  it("are never taken from the browser", async () => {
    const id = await draft();
    const claimed = { takenAt: "2020-01-01T00:00:00.000Z", takenWhere: { latitude: 1, longitude: 2 }, latitude: 1, longitude: 2 };
    const withExif = await uploaded(engineer, id, { body: jpegWithExif(inRiyadh), extra: claimed });
    const without = await uploaded(engineer, id, { extra: claimed });
    expect(await documentOf(engineer, id, withExif)).toMatchObject({
      takenAt: "2026-10-03T11:22:05.000Z",
      takenWhere: { latitude: 24.7136, longitude: 46.6753 },
    });
    expect(await documentOf(engineer, id, without)).toMatchObject({ takenAt: null, takenWhere: null });
  });
});

describe("leaving Draft", () => {
  it("is refused without a photo in the required field", async () => {
    const id = await draft();
    expect((await take(engineer, id, "send_for_review")).json()).toEqual({
      error: "form_incomplete",
      fields: [{ key: "sample_photos", code: "required" }],
    });
    await uploaded(engineer, id);
    await ok(take(engineer, id, "send_for_review"));
  });
});

describe("once Submitted", () => {
  let id = "";
  let photo = "";

  beforeAll(async () => {
    id = await draft();
    photo = await uploaded(engineer, id, { body: jpegWithExif(inRiyadh) });
    await ok(take(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(take(pm, id, "submit"));
  });

  it("the Consultant sees the photo with its time and place, and can download it", async () => {
    expect(await documentOf(consultant, id, photo)).toMatchObject({
      takenAt: "2026-10-03T11:22:05.000Z",
      takenWhere: { latitude: 24.7136, longitude: 46.6753 },
      frozen: true,
    });
    await ok(consultant.get(`${documentUrl(id, photo)}/download`), 200);
  });

  it("anyone who can't see the item gets a 404 for its photos and their download URLs", async () => {
    await expectHidden(c2Engineer.get(documentsUrl(id)));
    await expectHidden(c2Engineer.get(`${documentUrl(id, photo)}/download`));
    await expectHidden(start(c2Engineer, id, {}));
  });
});
