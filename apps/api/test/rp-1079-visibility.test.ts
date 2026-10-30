// Seam 1 for a Recommendation's own reply files under the Owner's review (RP-1079, RP-1125; ADR 0022,
// ADR 0024; visibility.md V5, V19 and the Documental Record row; scenarios RP-1079-1 and RP-1079-2).
// Seam 2 is packages/db/test/owner-review-reply-files-rls.test.ts; this file reads the same world
// through every api read that can return a Document: the item's Documents and their download, the
// Work Item page, its history, the item as shared, the List, its search and the Kanban, the Activity
// Feed, the bell, the annotate start, the Working Copy and the Documental Record.
//
// K1's PM adds a site photo to the "Recommend C" Screen and Recommends C to the Owner. The Transition
// takes the photo, but its events are internal to K1 and the Owner, so C1, the Contractor, reads it by
// no channel: not while the Owner reviews, nor after an Owner Send Back, nor after the Confirm, and
// the Documental Record holds it not. C1's own Datasheet, Submitted with the item, is the positive
// control of the channels C1 reads; K1 and the Owner reading the photo is the control of the rest.
//
// The Working Copy and the Documental Record print only the Form's attachment files, so their PDFs
// would hold no reply photo even if their content let one through: that content rule
// (app.reply_event_shared) is seam 2's to prove. Here they guard what the files print.
import { createDb, type OutboxHandler } from "@rabaed/db";
import { addOwnerReviewWorkflow, addTestScreen, drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { publishFormVersion } from "@rabaed/admin/services";
import type { SignedUrl, StartedDocumentUpload, WorkingCopyAnswer } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  s3RecordFiles,
  workingCopyHandler,
  type PdfAValidator,
} from "@rabaed/worker/record";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { attachDatasheet, createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "CNORA";
/** A Consultant Position that may also attach files in Submittals: no Rabaed Default one does. */
const RECOMMENDER = "rp1079_api_recommender";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet") },
      ],
    },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let at: Tower;
let k1Pm: Caller; // Recommends, with a Position that may attach.
let owPm: Caller; // Holds the Owner's review.
const named = new Map<Caller, string>();
const who = (by: Caller) => named.get(by) ?? "someone";

/** The record job and the Working Copy job as the worker runs them, with the local adapters. */
let handlers: Record<string, OutboxHandler> = {};
/** The record checks' veraPDF run is the record tests' to judge; here only what the record holds is. */
const unvalidated: PdfAValidator = { validate: async () => ({ compliant: true, problems: [] }) };
const runWorker = () => drainOutbox(worker, handlers);

/** `by` adds a site photo to the "Recommend C" Screen of item `id` (start, PUT to the signed URL, confirm); its Document's id. */
async function addSitePhoto(by: Caller, id: string, fileName: string): Promise<string> {
  const photo = jpegWithExif();
  const started = await by.post(`/v1/work-items/${id}/documents`, {
    fieldKey: "site_photos",
    reply: true,
    fileName,
    contentType: "image/jpeg",
    sizeBytes: photo.byteLength,
  });
  expect(started.statusCode, started.body).toBe(201);
  const { id: documentId, upload } = started.json() as StartedDocumentUpload;
  const stored = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: photo });
  expect(stored.status).toBe(200);
  const confirmed = await by.post(`/v1/work-items/${id}/documents/${documentId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(204);
  return documentId;
}

/** A Submitted item with C1's Datasheet (a Form file, the positive control), picked up by K1's PM. */
async function atConsultant(title: string): Promise<{ id: string; datasheet: string }> {
  const created = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: title, trade: at.electrical, location: at.buildingA } }),
    201,
  );
  const id = created.json().id as string;
  const datasheet = await attachDatasheet(at.c1Engineer, id);
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  return { id, datasheet };
}

/** The ids among `ids` that the JSON `json` names anywhere. */
const mentioned = (json: unknown, ids: string[]) => {
  const text = JSON.stringify(json);
  return ids.filter((id) => text.includes(id));
};

/** Which of `ids` `by`'s GET of `path` names (the read must answer 200). */
const namedBy = async (by: Caller, path: string, ids: string[]) => mentioned((await ok(by.get(path), 200)).json(), ids);

/** `[{ id: file }]` when `by` GETs `path` and its body names `file`; `[]` for the plain 404 or a body without it. */
const naming = (path: string, file: string) => async (by: Caller) =>
  (await readById<unknown>(path)(by)).flatMap((body) => mentioned(body, [file]).map((id) => ({ id })));

/** The api reads of item `id` that return Document `file` to K1 and the Owner, each as a read for expectHiddenFrom (by id). */
const fileReads = (id: string, file: string) => ({
  documents: async (by: Caller) => (await readById<{ documents: { id: string }[] }>(`/v1/work-items/${id}/documents`)(by)).flatMap((l) => l.documents),
  download: async (by: Caller) => (await readById<{ url: string }>(`/v1/work-items/${id}/documents/${file}/download`)(by)).map(() => ({ id: file })),
  // The Transition that took it lists it (ADR 0024); C1 reads no such event.
  history: naming(`/v1/work-items/${id}/history`, file),
});

/** The reads of item `id` that show no reply file to anyone: the Work Item page, the List, its search, the Kanban, the Activity Feed. */
const itemReads = (id: string, title: string) => {
  const list = `/v1/projects/${at.projectId}/modules/submittals/work-items`;
  return [`/v1/work-items/${id}`, list, `${list}?q=${encodeURIComponent(title)}`, `${list}/kanban`, `/v1/projects/${at.projectId}/activity`];
};

/** How the start of an annotated copy of `file` (RP-656) answers `by`. */
async function annotateAnswer(by: Caller, id: string, file: string) {
  const res = await by.post(`/v1/work-items/${id}/documents`, { annotatedFromId: file, fileName: "marked.jpg", contentType: "image/jpeg", sizeBytes: 10 });
  return { status: res.statusCode, error: (res.json() as { error?: string }).error };
}

/** Everything a PDF prints, as one string without whitespace, and the files inside it (the Record Data). */
async function pdfAt(url: string): Promise<{ text: string; xml: string }> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  await task.destroy();
  const attached = await attachedFiles(bytes);
  return { text: text.replace(/\s+/g, ""), xml: attached.map((f) => new TextDecoder().decode(f.bytes)).join("") };
}

/** How a printed file names Document `id`: its id, its file name or its storage key. */
async function marksOf(id: string): Promise<string[]> {
  const { rows } = await sql<{ file_name: string; storage_key: string }>`select file_name, storage_key from document where id = ${id}::uuid`.execute(migrator);
  return [id, rows[0]!.file_name, rows[0]!.storage_key];
}

/** Which of `files` the PDF at `url` names, in its pages or its Record Data. */
async function inPdf(url: string, files: string[]): Promise<string[]> {
  const { text, xml } = await pdfAt(url);
  const out: string[] = [];
  for (const file of files) if ((await marksOf(file)).some((mark) => text.includes(mark.replace(/\s+/g, "")) || xml.includes(mark))) out.push(file);
  return out;
}

/** The Working Copy of item `id` as `by` downloads it once printed. */
async function workingCopyUrl(by: Caller, id: string): Promise<string> {
  await ok(by.post(`/v1/work-items/${id}/working-copy`), 200);
  await runWorker();
  const answer = (await ok(by.post(`/v1/work-items/${id}/working-copy`), 200)).json() as WorkingCopyAnswer;
  if (answer.status !== "ready") throw new Error(`Working Copy not ready: ${answer.status}`);
  return answer.url;
}

beforeAll(async () => {
  const run = (text: string) => sql.raw(text).execute(migrator) as Promise<{ rows: unknown[] }>;
  // "Recommend C" shows a Screen with a reply photos field: the Consultant's own site photos.
  const screen = await addTestScreen(
    run,
    `recommend_c_photos_${randomUUID().slice(0, 8)}`,
    {
      sections: [
        {
          key: "recommendation",
          title: { en: "Recommendation", ar: "التوصية" },
          fields: [{ key: "site_photos", type: "photos", maxFiles: 5, label: { en: "Site photos", ar: "صور الموقع" } }],
        },
      ],
    },
    [],
  );
  const workflowId = await addOwnerReviewWorkflow(run, { screens: { recommend_c: screen } });
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Owner review files (api)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  await migrator
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code: TYPE,
      name: JSON.stringify(bilingual("Owner review files (api)")),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  const published = await publishFormVersion(migrator, formId, schema);
  expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
  await run(`
    with p as (
      insert into position (owner_kind, base_role, key, name, sort)
      values ('rabaed', 'consultant', '${RECOMMENDER}', '{"en": "Recommending manager", "ar": "مدير التوصية"}', 99)
      on conflict (base_role, key) do update set sort = excluded.sort
      returning id
    )
    insert into position_permission (position_id, module_key, permission)
    select p.id, 'submittals', x from p, unnest(array['view', 'review', 'approve', 'attach']) x
    on conflict do nothing
  `);

  const c1: Company = await api.projectCreator();
  const k1: Company = await api.authorizedPerson();
  const ow: Company = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RPA");
  k1Pm = await projectMember(api, k1, at.k1ParticipantId!, [RECOMMENDER]);
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  owPm = await projectMember(api, ow, owParticipant, ["project_manager"]);
  for (const [by, name] of [[at.c1Pm, "C1 PM"], [at.c1Engineer, "C1 engineer"], [k1Pm, "K1 PM"], [owPm, "Owner PM"]] as const) named.set(by, name);

  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  const files = s3RecordFiles(projectFilesFromEnv());
  handlers = {
    working_copy: workingCopyHandler({ files, renderer, fonts: async () => fallbackFonts() }),
    documental_record: documentalRecordHandler({
      files,
      renderer,
      signer: async () => signer,
      timestamps: async () => timestamps,
      fonts: async () => fallbackFonts(),
      webUrl: "https://rabaed.test",
      validator: unvalidated,
    }),
  };
  // Anything earlier tests left in the outbox is not ours to judge.
  await runWorker();
}, 120_000);

const c1 = () => [at.c1Pm, at.c1Engineer];

/**
 * C1 reads none of `photos` by any api read of item `id`, and `readers` read each of them: in the
 * item's Documents, by download and in its history (expectHiddenFrom, by id). The item as shared
 * names C1's Datasheet and no photo, and the reads that show no file name the item and no photo.
 */
async function c1ReadsNone(id: string, title: string, photos: string[], datasheet: string, readers: Caller[], label: string) {
  for (const photo of photos) {
    for (const [channel, read] of Object.entries(fileReads(id, photo))) {
      await expectHiddenFrom({ read, target: photo, seenBy: readers, hiddenFrom: c1(), name: who, label: `${label}, ${channel}` });
    }
  }
  for (const by of c1()) {
    // Positive control: C1 downloads its own Datasheet, and the item as shared lists it.
    expect((await ok(by.get(`/v1/work-items/${id}/documents/${datasheet}/download`), 200)).json().url, `${label}, ${who(by)}`).toBeTruthy();
    expect(await namedBy(by, `/v1/work-items/${id}/shared`, [...photos, datasheet]), `${label}, ${who(by)}, shared`).toEqual([datasheet]);
    for (const path of itemReads(id, title)) expect(await namedBy(by, path, [...photos, id]), `${label}, ${who(by)}, ${path}`).toEqual([id]);
  }
}

/** Which of `files` the Working Copy of item `id` names, as C1's PM downloads it. */
const inWorkingCopy = async (id: string, files: string[]) => inPdf(await workingCopyUrl(at.c1Pm, id), files);

/** Which of `files` the Documental Record of item `id` names, as `by` downloads it. */
async function inRecord(by: Caller, id: string, files: string[]): Promise<string[]> {
  await runWorker();
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  return inPdf(link.url, files);
}

describe("scenario RP-1079-1: the photos K1's Recommendation takes are read by K1 and the Owner only, during the Owner's review", () => {
  it("C1 reads none by any api read, and the Working Copy names none; K1 and the Owner read it, the Owner holding the review too", async () => {
    const title = "Pump skid";
    const { id, datasheet } = await atConsultant(title);
    const photo = await addSitePhoto(k1Pm, id, "rp1079-api-site-1.jpg");
    await take(k1Pm, id, "recommend_c");
    // The Recommendation took it: frozen, a taken reply file in K1's Documents.
    const k1Reads = (await ok(k1Pm.get(`/v1/work-items/${id}/documents`), 200)).json().documents as { id: string; reply?: unknown; frozen: boolean }[];
    expect(k1Reads.find((d) => d.id === photo)).toMatchObject({ reply: { taken: true }, frozen: true });

    await c1ReadsNone(id, title, [photo], datasheet, [k1Pm, owPm], "with the Owner");
    expect(await inWorkingCopy(id, [photo, datasheet])).toEqual([datasheet]);
    // Nor does an annotate start tell C1 the photo is there: as for a made-up id, unlike its own Datasheet.
    expect(await annotateAnswer(at.c1Pm, id, photo)).toEqual(await annotateAnswer(at.c1Pm, id, randomUUID()));
    expect(await annotateAnswer(at.c1Pm, id, photo)).toEqual({ status: 404, error: "not_found" });
    expect(await annotateAnswer(at.c1Pm, id, datasheet)).toMatchObject({ status: 409 });

    // The Owner holding the review reads it too; C1 still reads none.
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    await c1ReadsNone(id, title, [photo], datasheet, [owPm, k1Pm], "held by the Owner");
  });
});

describe("scenario RP-1079-2: neither an Owner Send Back nor the Confirm shares them, and the record holds none", () => {
  it("C1 reads neither photo after the Send Back nor after the Confirm; the Working Copy and the Documental Record name neither", async () => {
    const title = "Chiller";
    const { id, datasheet } = await atConsultant(title);
    const photo = await addSitePhoto(k1Pm, id, "rp1079-api-site-2.jpg");
    await take(k1Pm, id, "recommend_c");
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    await take(owPm, id, "owner_send_back");

    // Back with K1, which reads its photo, as does the Owner; C1 reads it nowhere.
    await c1ReadsNone(id, title, [photo], datasheet, [k1Pm, owPm], "after the Send Back");
    expect(await inWorkingCopy(id, [photo, datasheet])).toEqual([datasheet]);

    const second = await addSitePhoto(k1Pm, id, "rp1079-api-site-3.jpg");
    await take(k1Pm, id, "recommend_c");
    await ok(owPm.post(`/v1/work-items/${id}/pick-up`));
    await take(owPm, id, "confirm_c");
    expect((await detail(at.c1Pm, id)).outcome).toBe("C");

    await c1ReadsNone(id, title, [photo, second], datasheet, [k1Pm, owPm], "after the Confirm");
    // The Documental Record, one file for every viewer, holds C1's Datasheet and neither photo.
    for (const by of [at.c1Pm, k1Pm]) expect(await inRecord(by, id, [photo, second, datasheet]), who(by)).toEqual([datasheet]);
  }, 120_000);
});
