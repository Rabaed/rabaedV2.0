// Seam 1 for annotated photos (RP-656, spec RP-649; visibility.md RP-656-1).
// Annotating a photo never changes it: the drawn image is saved as a Document of
// its own, linked to the untouched original, in the same field and checklist
// item, and read exactly where the original is. A Member who sees the item lists
// and downloads both; anyone else gets a 404 for either, by the API and by the
// file link. One annotated copy an original: a new one replaces it, and removing
// the original removes it. A Revision's copy of it is linked to the Revision's
// copy of the original.
//
// The MAR Form Version 1 has no photos field, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has one, of at most 2.
import { createHash, randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, DocumentSummary, StartedDocumentUpload } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { attachDatasheet, createTestApi, expectHidden, readById, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, take } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARAP";

const schema = {
  sections: [
    {
      key: "photos",
      title: { en: "Photos", ar: "الصور" },
      fields: [
        { key: "site_photos", type: "photos", label: { en: "Site photos", ar: "صور الموقع" }, maxFiles: 2 },
        // Takes PNG screenshots only: a photo's annotated copy, drawn as a JPEG, still goes beside it.
        { key: "screenshots", type: "attachments", label: { en: "Screenshots", ar: "لقطات الشاشة" }, contentTypes: ["image/png"] },
        {
          key: "ceiling_check",
          type: "checklist",
          label: { en: "Ceiling check", ar: "فحص السقف" },
          items: [{ key: "void", text: bilingual("Ceiling void"), answers: "pass_fail_na", comment: "optional", photo: "optional" }],
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
        values ('rabaed', '{"en": "Annotated photos (test)", "ar": "صور مشروحة (اختبار)"}')
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

let engineer: Caller; // C1: raises the items and annotates their photos; holds Attach.
let pm: Caller; // C1: Submits.
let viewer: Caller; // C1, no Position: sees the Draft, may not change its Documents.
let consultant: Caller; // K1: sees the item once Submitted.
let k1Manager: Caller; // K1: issues Code C.
let c2Engineer: Caller; // Another Contractor: never sees the item.
let projectId = "";
let electrical = "";
let buildingA = "";

const documentsUrl = (itemId: string) => `/v1/work-items/${itemId}/documents`;
const documentUrl = (itemId: string, documentId: string) => `${documentsUrl(itemId)}/${documentId}`;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const draft = async (type = TYPE, answers: Record<string, unknown> = {}) =>
  (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type, title: "Ceiling", answers: { ...answers, trade: electrical, location: buildingA } }), 201)).json()
    .id as string;

const photo = (itemId: string, fieldKey: string | null = "site_photos", body: Buffer = jpegWithExif(inRiyadh)) =>
  uploadDocument(engineer, itemId, { ...(fieldKey ? { fieldKey } : {}), fileName: "ceiling.jpg", contentType: "image/jpeg", body });

/** The drawn image the browser uploads: a canvas's PNG (any bytes do for the store). */
const drawn = (marks: string) => Buffer.from(`\x89PNG annotated: ${marks}`);

const startCopy = (by: Caller, itemId: string, originalId: string, body: Buffer = drawn("arrow"), extra: Record<string, unknown> = {}) =>
  by.post(documentsUrl(itemId), {
    fileName: "ceiling-annotated.png",
    contentType: "image/png",
    sizeBytes: body.byteLength,
    annotatedFromId: originalId,
    ...extra,
  });

/** Saves an annotated copy of `originalId` as the browser does; returns its id. */
async function annotate(itemId: string, originalId: string, body: Buffer = drawn("arrow"), extra: Record<string, unknown> = {}): Promise<string> {
  const started: StartedDocumentUpload = (await ok(startCopy(engineer, itemId, originalId, body, extra), 201)).json();
  const stored = await fetch(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body });
  expect(stored.status).toBe(200);
  await ok(engineer.post(`${documentUrl(itemId, started.id)}/confirm`));
  return started.id;
}

const list = async (by: Caller, itemId: string): Promise<DocumentList> => (await ok(by.get(documentsUrl(itemId)), 200)).json();
const ofItem = async (by: Caller, itemId: string, id: string): Promise<DocumentSummary | undefined> =>
  (await list(by, itemId)).documents.find((d) => d.id === id);
const downloadUrl = async (by: Caller, itemId: string, id: string) => (await ok(by.get(`${documentUrl(itemId, id)}/download`), 200)).json().url as string;
const bytesOf = async (by: Caller, itemId: string, id: string) => new Uint8Array(await (await fetch(await downloadUrl(by, itemId, id))).arrayBuffer());
/** Reads for expectHiddenFrom: the item's Documents `by` lists, and [the Document] when `by` gets its download link; [] for the plain 404. */
const documentsOf = (itemId: string) => async (by: Caller) => (await readById<DocumentList>(documentsUrl(itemId))(by)).flatMap((l) => l.documents);
const downloadOf = (itemId: string, id: string) => async (by: Caller) => (await readById<{ url: string }>(`${documentUrl(itemId, id)}/download`)(by)).map(() => ({ id }));
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
/** Each of `documents` listed and downloaded by every one of `seenBy` first, and by none of `hiddenFrom`. */
async function expectDocumentsHidden(itemId: string, documents: string[], seenBy: Caller[], hiddenFrom: Caller[], label: string) {
  for (const target of documents) {
    for (const read of [documentsOf(itemId), downloadOf(itemId, target)]) await expectHiddenFrom({ read, target, seenBy, hiddenFrom, name: named, label });
  }
}
const refusedWith = async (res: Promise<LightMyRequestResponse>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

const inRiyadh = { takenAt: "2026:10:03 14:22:05", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 };

async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
}

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
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  viewer = await projectMember(api, c1, own, []);
  const other = async (role: "consultant" | "contractor") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  const k1 = await other("consultant");
  consultant = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const c2 = await other("contractor");
  c2Engineer = await projectMember(api, c2.company, c2.participantId, ["engineer"]);
  for (const [by, name] of [[engineer, "C1 engineer"], [consultant, "K1 engineer"], [c2Engineer, "C2 engineer"]] as const) names.set(by, name);
});

describe("saving an annotated copy", () => {
  it("keeps the original's bytes as they were, and the copy beside it in the same field", async () => {
    const id = await draft();
    const original = await photo(id);
    const before = sha256(await bytesOf(engineer, id, original));

    const copy = await annotate(id, original, drawn("arrow, text"));

    expect(sha256(await bytesOf(engineer, id, original))).toBe(before);
    expect(Buffer.from(await bytesOf(engineer, id, copy)).toString()).toBe(drawn("arrow, text").toString());
    expect(await ofItem(engineer, id, original)).toMatchObject({ annotatedFromId: null, fieldKey: "site_photos", fileName: "ceiling.jpg" });
    // The drawn image has no EXIF: the copy shows where and when the original was taken.
    expect(await ofItem(engineer, id, copy)).toMatchObject({
      annotatedFromId: original,
      fieldKey: "site_photos",
      itemKey: null,
      contentType: "image/png",
      takenAt: "2026-10-03T11:22:05.000Z",
      takenWhere: { latitude: 24.7136, longitude: 46.6753 },
    });
  });

  it("replaces the original's earlier copy", async () => {
    const id = await draft();
    const original = await photo(id);
    const first = await annotate(id, original, drawn("arrow"));
    const second = await annotate(id, original, drawn("circle"));
    expect((await list(engineer, id)).documents.map((d) => d.id)).toEqual([original, second]);
    await expectHidden(engineer.get(`${documentUrl(id, first)}/download`)); // not hidden-from: the replaced copy is gone, for its uploader too
  });

  it("doesn't count toward the field's maximum of photos", async () => {
    const id = await draft();
    const [a, b] = [await photo(id), await photo(id)];
    await annotate(id, a);
    await annotate(id, b);
    expect(await refusedWith(engineer.post(documentsUrl(id), { fileName: "c.jpg", contentType: "image/jpeg", sizeBytes: 4, fieldKey: "site_photos" }))).toEqual({
      status: 409,
      body: { error: "too_many_files" },
    });
  });

  it("doesn't count toward a checklist item's 10 photos", async () => {
    const id = await draft();
    const item = { fieldKey: "ceiling_check", itemKey: "void", fileName: "void.jpg", contentType: "image/jpeg", body: jpegWithExif() };
    const photos = [];
    for (let i = 0; i < 10; i++) photos.push(await uploadDocument(engineer, id, item));
    for (const original of photos.slice(0, 3)) {
      expect(await ofItem(engineer, id, await annotate(id, original))).toMatchObject({ fieldKey: "ceiling_check", itemKey: "void" });
    }
    expect((await refusedWith(engineer.post(documentsUrl(id), { ...item, body: undefined, sizeBytes: 4 }))).body).toEqual({ error: "too_many_files" });
  });

  it("goes beside its original in a field whose file types don't include the copy's", async () => {
    const id = await draft();
    const screenshot = await uploadDocument(engineer, id, { fieldKey: "screenshots", fileName: "panel.png", contentType: "image/png", body: drawn("panel") });
    const copy = await annotate(id, screenshot, Buffer.from("JPEG drawn"), { fileName: "panel-annotated.jpg", contentType: "image/jpeg" });
    expect(await ofItem(engineer, id, copy)).toMatchObject({ annotatedFromId: screenshot, fieldKey: "screenshots", contentType: "image/jpeg" });
  });

  it("is removed with its original", async () => {
    const id = await draft();
    const original = await photo(id);
    const copy = await annotate(id, original);
    await ok(engineer.request("DELETE", documentUrl(id, original)));
    expect((await list(engineer, id)).documents).toEqual([]); // not hidden-from: both are removed, for their uploader too
    await expectHidden(engineer.get(`${documentUrl(id, copy)}/download`)); // not hidden-from: the removed copy is gone
  });

  it("can be removed alone, leaving the original", async () => {
    const id = await draft();
    const original = await photo(id);
    const copy = await annotate(id, original);
    await ok(engineer.request("DELETE", documentUrl(id, copy)));
    expect((await list(engineer, id)).documents.map((d) => d.id)).toEqual([original]);
  });
});

describe("what may be annotated, and by whom", () => {
  it("is a photo, not a copy and not another file", async () => {
    const id = await draft(LEGACY_MAR);
    const datasheet = await attachDatasheet(engineer, id);
    expect(await refusedWith(startCopy(engineer, id, datasheet))).toEqual({ status: 422, body: { error: "content_type_not_allowed" } });
    const original = await photo(id, null);
    const copy = await annotate(id, original);
    await expectHidden(startCopy(engineer, id, copy)); // not hidden-from: a copy is no photo to annotate, for its own uploader
  });

  it("is drawn as an image", async () => {
    const id = await draft();
    const original = await photo(id);
    expect(await refusedWith(engineer.post(documentsUrl(id), { fileName: "notes.pdf", contentType: "application/pdf", sizeBytes: 9, annotatedFromId: original }))).toEqual({
      status: 422,
      body: { error: "content_type_not_allowed" },
    });
  });

  it("goes where the original is: the request names no field", async () => {
    const id = await draft();
    const original = await photo(id);
    expect((await startCopy(engineer, id, original, drawn("arrow"), { fieldKey: "site_photos" })).statusCode).toBe(400);
  });

  it("is a photo of this item", async () => {
    const [here, there] = [await draft(), await draft()];
    const original = await photo(there);
    await expectHidden(startCopy(engineer, here, original)); // not hidden-from: another item's photo, refused to the Member who sees both
    await expectHidden(startCopy(engineer, here, randomUUID())); // not hidden-from: no such photo
  });

  it("is refused to a Member who may not change the item's Documents", async () => {
    const id = await draft();
    const original = await photo(id);
    expect(await refusedWith(startCopy(viewer, id, original))).toEqual({ status: 409, body: { error: "not_editable" } });
  });
});

// visibility.md RP-656-1: the annotated copy is read exactly where the original is.
describe("once Submitted", () => {
  let id = "";
  let original = "";
  let copy = "";

  beforeAll(async () => {
    id = await draft();
    original = await photo(id);
    copy = await annotate(id, original);
    // While it is C1's Draft, C1's engineer lists and downloads both, and nobody outside C1 does.
    await expectDocumentsHidden(id, [original, copy], [engineer], [consultant, c2Engineer], "C1's Draft");
    await submit(id);
  });

  it("the Consultant lists and downloads both, the original untouched", async () => {
    expect((await list(consultant, id)).documents).toMatchObject([
      { id: original, annotatedFromId: null, frozen: true },
      { id: copy, annotatedFromId: original, frozen: true },
    ]);
    expect(sha256(await bytesOf(consultant, id, original))).toBe(sha256(jpegWithExif(inRiyadh)));
    expect(Buffer.from(await bytesOf(consultant, id, copy)).toString()).toBe(drawn("arrow").toString());
  });

  it("another Contractor reads neither copy, by the API or by the file link", async () => {
    await expectDocumentsHidden(id, [original, copy], [engineer, consultant], [c2Engineer], "Submitted");
    await expectHidden(startCopy(c2Engineer, id, original)); // not hidden-from: a refused write; the reads above prove the photo with expectHiddenFrom
    // The file store answers only a URL the api signed.
    const unsigned = new URL(await downloadUrl(engineer, id, copy));
    unsigned.search = "";
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it("a frozen photo isn't annotated again", async () => {
    expect(await refusedWith(startCopy(engineer, id, original))).toEqual({ status: 409, body: { error: "not_editable" } });
  });
});

describe("a Revision", () => {
  it("copies the annotated copy linked to its copy of the original", async () => {
    const id = await draft(LEGACY_MAR, { manufacturer: "Philips", description: "LED fixtures", items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }] });
    await attachDatasheet(engineer, id);
    const original = await photo(id, null);
    await annotate(id, original);
    await submit(id);
    await ok(k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Manager, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });

    const revision = (await ok(engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    const documents = (await list(engineer, revision)).documents.filter((d) => d.contentType.startsWith("image/"));
    const [newOriginal, newCopy] = [documents.find((d) => d.annotatedFromId === null), documents.find((d) => d.annotatedFromId !== null)];
    expect(newOriginal).toBeDefined();
    expect(newCopy?.annotatedFromId).toBe(newOriginal?.id);
    expect(newOriginal?.id).not.toBe(original);
  });
});
