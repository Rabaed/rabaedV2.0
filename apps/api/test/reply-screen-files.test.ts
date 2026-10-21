// Seam 1 for a reply Screen's files (RP-623, SNAG-4; ADR 0024; spec RP-619; workflow-engine.md
// §5.7, form-engine.md §4; visibility.md V19 and scenarios RP-623-1 to RP-623-3).
//
// The Snag's Resolve Screen (`snag_resolution`) holds After photos. The Contractor holding the
// Snag adds them over time, at Open, In Progress and On Hold; only its Members see them, and a
// move inside it keeps them. The Resolve takes them: they freeze, its content hash covers them
// and everyone who sees the Snag sees them. After a Return to Open the next Resolve starts
// empty, and the first round's photos stay on the first Resolve. Leaving the Contractor any
// other way (here a Send Back, on a Project copy of the Workflow) discards them.
import { createHash } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectedContentSha256, testDatabaseUrls, type HashedDocument } from "@rabaed/db/test-support";
import type { DocumentList, StartedDocumentUpload, WorkflowDefinition, WorkflowRead, WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let at: Tower;
let owner: Caller; // An Owner with oversight of everything (V2).
let c2Engineer: Caller; // Another Contractor of the same Trade, covering Building B only (V3).

const photo = jpegWithExif();
const documentsOf = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
const afterPhotos = async (by: Caller, id: string) => (await documentsOf(by, id)).documents.filter((d) => d.fieldKey === "after_photos");
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;

/** Starts an upload of `fileName` to the reply Screen field `fieldKey` of item `id`, as the browser does. */
const startReplyUpload = (by: Caller, id: string, fileName: string, fieldKey = "after_photos") =>
  by.post(`/v1/work-items/${id}/documents`, { fieldKey, reply: true, fileName, contentType: "image/jpeg", sizeBytes: photo.byteLength });

/** Uploads an After photo to item `id` as `by` (start, PUT to the signed URL, confirm); returns the Document's id. */
async function addAfterPhoto(by: Caller, id: string, fileName: string): Promise<string> {
  const started = await startReplyUpload(by, id, fileName);
  expect(started.statusCode, started.body).toBe(201);
  const { id: documentId, upload } = started.json() as StartedDocumentUpload;
  const stored = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: photo });
  expect(stored.status).toBe(200);
  const confirmed = await by.post(`/v1/work-items/${id}/documents/${documentId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(204);
  return documentId;
}

/** C1's PM takes `transition` on Snag `id` and holds the Step it leads to. */
async function move(id: string, transition: string, options: Parameters<typeof take>[3] = {}) {
  await take(at.c1Pm, id, transition, options);
  if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
}

/** A Snag K1's manager raised on C1 with one "before" photo, Open, held by C1's PM. */
async function raised(title: string): Promise<string> {
  const answers = { description: `${title}: see the photos`, trade: at.electrical, location: at.buildingA };
  const id = (await ok(at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers }), 201)).json().id as string;
  await uploadDocument(at.k1Manager, id, { fieldKey: "photos", fileName: "before.jpg", contentType: "image/jpeg", body: photo });
  await take(at.k1Manager, id, "raise");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** The content hash the Transition `transition` of item `id` carries, hex (its last one). */
async function eventHash(id: string, transition: string): Promise<string> {
  const { rows } = await sql<{ hash: string }>`
    select encode(e.content_sha256, 'hex') as hash from work_item_event e
    join workflow_transition t on t.id = e.transition_id
    where e.work_item_id = ${id}::uuid and t.key = ${transition} and e.type = 'transition'
    order by e.seq desc limit 1
  `.execute(migrator);
  return rows[0]!.hash;
}

/** The hash worked out from the spec: the item's Subject and answers, and the Documents `ids`, each with the fingerprint of the bytes uploaded. */
async function expectedHash(id: string, ids: string[]): Promise<string> {
  const { rows: items } = await sql<{ title: string; data: object }>`select title, data from work_item where id = ${id}::uuid`.execute(migrator);
  const { rows: documents } = await sql<HashedDocument>`
    select id, field_key, item_key, file_name, content_type, size_bytes::int as size_bytes, storage_key from document
    where id = any (${ids}::uuid[])
  `.execute(migrator);
  const fingerprint = createHash("sha256").update(photo).digest("hex");
  return expectedContentSha256({
    title: items[0]!.title,
    data: items[0]!.data,
    outcome: null,
    documents: documents.map((d) => ({ ...d, file_sha256: fingerprint }) as HashedDocument),
  });
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RSF");
  const buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const addOther = async (role: "owner" | "contractor", position: string, location: typeof all | ReturnType<typeof only>) => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, at.projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location }));
    return projectMember(api, company, participantId, [position]);
  };
  owner = await addOther("owner", "representative", all);
  c2Engineer = await addOther("contractor", "engineer", only(buildingB));
});

describe("a Snag's After photos, in the Resolve Screen (seam 1)", () => {
  it("C1 adds two at In Progress, keeps them through On Hold and back, resolves; K1 sees them on Verify, and the Resolve's hash covers them", async () => {
    const id = await raised("Cable tray not bonded");
    const before = (await documentsOf(at.c1Pm, id)).documents.find((d) => d.fieldKey === "photos")!.id;
    await move(id, "start_work");
    const first = await addAfterPhoto(at.c1Pm, id, "after-1.jpg");
    // The other C1 Member adds the second: any Member of the holding Participant may.
    const second = await addAfterPhoto(at.c1Engineer, id, "after-2.jpg");

    const list = await documentsOf(at.c1Pm, id);
    expect(list.canChangeReplies).toBe(true);
    expect(list.documents.filter((d) => d.fieldKey === "after_photos").map((d) => [d.id, d.reply, d.frozen])).toEqual([
      [first, { taken: false }, false],
      [second, { taken: false }, false],
    ]);

    // A move inside C1 keeps them.
    await move(id, "put_on_hold_in_progress");
    await move(id, "resume");
    expect((await detail(at.c1Pm, id)).stage.key).toBe("in_progress");
    expect((await afterPhotos(at.c1Pm, id)).map((d) => d.id)).toEqual([first, second]);

    // Nobody outside C1 reads them before the Resolve (RP-623-1, seam 2 too): K1, the Owner, C2.
    expect(await afterPhotos(at.k1Manager, id)).toEqual([]);
    expect(await afterPhotos(owner, id)).toEqual([]);
    await expectHidden(at.k1Manager.get(`/v1/work-items/${id}/documents/${first}/download`));
    await expectHidden(owner.get(`/v1/work-items/${id}/documents/${first}/download`));
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents`));
    // Nor may they add one: K1 doesn't hold it.
    const k1Adds = await startReplyUpload(at.k1Manager, id, "k1.jpg");
    expect(k1Adds.statusCode, k1Adds.body).toBe(409);
    expect((await documentsOf(at.k1Manager, id)).canChangeReplies).toBe(false);

    await take(at.c1Pm, id, "resolve_in_progress", { answers: { resolution_note: "Bonded and tested" } });

    // Taken: frozen, and K1 and the Owner see them on Verify.
    const k1Sees = await afterPhotos(at.k1Manager, id);
    expect(k1Sees.map((d) => [d.id, d.reply, d.frozen])).toEqual([
      [first, { taken: true }, true],
      [second, { taken: true }, true],
    ]);
    expect((await afterPhotos(owner, id)).map((d) => d.id)).toEqual([first, second]);
    expect((await ok(at.k1Manager.get(`/v1/work-items/${id}/documents/${first}/download`), 200)).json().url).toBeTruthy();
    const resolve = (await history(at.k1Manager, id)).find((e) => e.transition?.en === "Resolve")!;
    expect(resolve.files).toEqual([first, second].sort());
    // Never in the event's payload: its answers are the note only.
    expect(resolve.answers).toEqual({ resolution_note: "Bonded and tested" });

    // The Resolve's content hash covers them, with the "before" photo (ADR 0017).
    expect(await eventHash(id, "resolve_in_progress")).toBe(await expectedHash(id, [before, first, second]));
    // A frozen one is never removed.
    const removed = await at.c1Pm.request("DELETE", `/v1/work-items/${id}/documents/${first}`);
    expect(removed.statusCode, removed.body).toBe(409);
  });

  it("after a Return to Open the next Resolve starts empty; the first round's photos stay on the first Resolve", async () => {
    const id = await raised("Corner to clean");
    const firstRound = await addAfterPhoto(at.c1Pm, id, "round-1.jpg");
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Cleaned" } });
    await take(at.k1Manager, id, "return_to_open", { reason: "Still dusty behind the door" });

    // Back with C1: its field is empty, the first round's photo is still the Snag's.
    expect((await afterPhotos(at.c1Pm, id)).map((d) => [d.id, d.reply])).toEqual([[firstRound, { taken: true }]]);
    const secondRound = await addAfterPhoto(at.c1Pm, id, "round-2.jpg");
    // K1 sees only the first round while C1 works the second.
    expect((await afterPhotos(at.k1Manager, id)).map((d) => d.id)).toEqual([firstRound]);
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Cleaned behind the door" } });

    const resolves = (await history(at.k1Manager, id)).filter((e) => e.transition?.en === "Resolve");
    expect(resolves.map((e) => e.files)).toEqual([[firstRound], [secondRound]]);
    expect((await afterPhotos(at.k1Manager, id)).map((d) => d.id)).toEqual([firstRound, secondRound]);
  });

  it("holds as many files as its limit in one round only, takes only photos, and no answer under the field's key", async () => {
    const id = await raised("Exposed rebar");
    const pdf = await at.c1Pm.post(`/v1/work-items/${id}/documents`, {
      fieldKey: "after_photos",
      reply: true,
      fileName: "note.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
    });
    expect(pdf.statusCode, pdf.body).toBe(422);
    const unknown = await startReplyUpload(at.c1Pm, id, "x.jpg", "no_such_field");
    expect(unknown.statusCode, unknown.body).toBe(422);
    // A Form's field is never a reply one, and the reverse.
    const formField = await startReplyUpload(at.c1Pm, id, "x.jpg", "photos");
    expect(formField.statusCode, formField.body).toBe(422);

    const smuggled = await tryTake(at.c1Pm, id, "resolve", { answers: { resolution_note: "Done", after_photos: ["x"] } });
    expect(smuggled.statusCode, smuggled.body).toBe(422);

    // C1 removes one it added, before the Resolve.
    const added = await addAfterPhoto(at.c1Pm, id, "wrong.jpg");
    const removed = await at.c1Pm.request("DELETE", `/v1/work-items/${id}/documents/${added}`);
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await afterPhotos(at.c1Pm, id)).toEqual([]);
  });
});

describe("who reads and adds a Snag's After photos (scenarios RP-623-1, RP-623-2)", () => {
  it("RP-623-1: K1 and the Owner, who both see the Snag, read none of C1's at In Progress or On Hold; both C1 Members do; K1's upload is refused `not_editable`", async () => {
    const id = await raised("Riser door gap");
    await move(id, "start_work");
    const photo = await addAfterPhoto(at.c1Engineer, id, "after.jpg");
    await move(id, "put_on_hold_in_progress");

    for (const reader of [at.c1Pm, at.c1Engineer]) expect((await afterPhotos(reader, id)).map((d) => d.id)).toEqual([photo]);
    for (const outsider of [at.k1Manager, owner]) {
      expect((await detail(outsider, id)).id).toBe(id);
      expect(await afterPhotos(outsider, id)).toEqual([]);
      await expectHidden(outsider.get(`/v1/work-items/${id}/documents/${photo}/download`));
    }
    const k1Adds = await startReplyUpload(at.k1Manager, id, "k1.jpg");
    expect({ status: k1Adds.statusCode, body: k1Adds.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
  });

  it("RP-623-2: C2 reads them neither before nor after the Resolve, and its upload is `not_found`, as for a made-up id", async () => {
    const id = await raised("Tray lid missing");
    const photo = await addAfterPhoto(at.c1Pm, id, "after.jpg");
    const c2Reads = async (when: string) => {
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents`), when);
      await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents/${photo}/download`), when);
      await expectHidden(startReplyUpload(c2Engineer, id, "c2.jpg"), when);
    };
    await c2Reads("before the Resolve");
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Lid fitted" } });
    // Positive control: K1 now reads it.
    expect((await afterPhotos(at.k1Manager, id)).map((d) => d.id)).toEqual([photo]);
    await c2Reads("after the Resolve");
    await expectHidden(startReplyUpload(c2Engineer, "00000000-0000-4000-8000-000000000000", "c2.jpg"), "a made-up id");
  });
});

// The spec's own Testing Decision (RP-619), scenario RP-1002-1: an informed Consultant reads a Snag's shared
// events only, never the Contractor's in-progress After photos.
describe("an informed Consultant and C1's After photos (scenario RP-1002-1)", () => {
  it("RP-1002-1: C1 raises its own Snag, informing K1, and adds After photos at Open and In Progress: K1 reads none until C1's Resolve, then reads them frozen", async () => {
    const answers = { description: "Exposed cable: see the photos", trade: at.electrical, location: at.buildingA };
    const id = (await ok(at.c1Pm.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title: "Exposed cable", answers }), 201)).json().id as string;
    await move(id, "raise");
    // K1 is informed: it reads the Snag itself.
    expect((await detail(at.k1Manager, id)).stage.key).toBe("open");
    const atOpen = await addAfterPhoto(at.c1Pm, id, "open.jpg");
    await move(id, "start_work");
    const inProgress = await addAfterPhoto(at.c1Engineer, id, "in-progress.jpg");

    for (const outsider of [at.k1Manager, owner]) {
      expect(await afterPhotos(outsider, id)).toEqual([]);
      for (const photo of [atOpen, inProgress]) await expectHidden(outsider.get(`/v1/work-items/${id}/documents/${photo}/download`));
    }
    expect((await history(at.k1Manager, id)).flatMap((e) => e.files ?? [])).toEqual([]);

    await take(at.c1Pm, id, "resolve_in_progress", { answers: { resolution_note: "Clipped and covered" } });
    expect((await afterPhotos(at.k1Manager, id)).map((d) => [d.id, d.frozen])).toEqual([
      [atOpen, true],
      [inProgress, true],
    ]);
    expect((await ok(at.k1Manager.get(`/v1/work-items/${id}/documents/${atOpen}/download`), 200)).json().url).toBeTruthy();
    await expectHidden(c2Engineer.get(`/v1/work-items/${id}/documents`));
  });
});

describe("the Rabaed Default Snag Workflow (seam 1)", () => {
  it("pins the Resolve Screen's Version with After photos on its three Resolve Transitions", async () => {
    const { rows } = await sql<{ key: string; pinned: number; latest: number; fields: string[] }>`
      select t.key, pinned.version_no as pinned,
        (select max(v.version_no) from screen_version v where v.screen_id = pinned.screen_id and v.status = 'published') as latest,
        (select array_agg(f ->> 'key' order by f ->> 'key') from jsonb_array_elements(t.action_form -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f) as fields
      from work_item_type ty
      join workflow_version wv on wv.workflow_definition_id = ty.workflow_definition_id
      join workflow_transition t on t.workflow_version_id = wv.id
      join screen_version pinned on pinned.id = t.screen_version_id
      where ty.owner_kind = 'rabaed' and ty.code = 'SNG' and t.screen_key = 'snag_resolution'
        and wv.version_no = (select max(version_no) from workflow_version where workflow_definition_id = ty.workflow_definition_id and status = 'published')
      order by t.key
    `.execute(migrator);
    expect(rows.map((r) => r.key)).toEqual(["resolve", "resolve_in_progress", "resolve_on_hold"]);
    for (const r of rows) {
      expect(r.pinned).toBe(r.latest);
      expect(r.fields).toEqual(["after_photos", "resolution_note"]);
    }
  });
});

describe("files no Transition took are discarded when the item leaves the Participant another way (seam 1)", () => {
  const readWorkflow = async (id: string): Promise<WorkflowRead> => (await ok(c1.caller.get(`/v1/workflows/${id}`), 200)).json();
  let typeId = "";

  beforeAll(async () => {
    // A Project copy of the Snag Workflow with a Send Back out of Open to the raiser's Draft (a test-only Workflow).
    const type = await sql<{ id: string; workflow_definition_id: string }>`
      select id, workflow_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'SNG'
    `.execute(migrator);
    typeId = type.rows[0]!.id;
    const copied = await c1.caller.post(`/v1/workflows/${type.rows[0]!.workflow_definition_id}/duplicate`, {
      projectId: at.projectId,
      name: bilingual("Snags with Ask the raiser"),
    });
    expect(copied.statusCode, copied.body).toBe(201);
    const workflowId = copied.json().id as string;
    const definition: WorkflowDefinition = (await readWorkflow(workflowId)).draft!.definition;
    const askRaiser = {
      key: "ask_raiser",
      label: bilingual("Ask the raiser"),
      kind: "send_back" as const,
      from: "in_progress",
      to: "draft",
      outcome: null,
      permission: "submit" as const,
      actionForm: null,
    };
    await ok(c1.caller.request("PUT", `/v1/workflows/${workflowId}/draft`, { definition: { ...definition, transitions: [...definition.transitions, askRaiser] } }), 200);
    const published = await c1.caller.post(`/v1/workflows/${workflowId}/publish`);
    expect(published.statusCode, published.body).toBe(200);
    await ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/workflow-bindings`, { workItemTypeId: typeId, raisingParticipantId: null, workflowId }));
  });

  afterAll(async () => {
    await ok(c1.caller.request("DELETE", `/v1/projects/${at.projectId}/workflow-bindings?workItemTypeId=${typeId}`));
  });

  it("C1 adds After photos at In Progress, then Sends it Back to K1: they are gone, for C1 too, and the Send Back's hash leaves them out", async () => {
    const id = await raised("Which riser?");
    const before = (await documentsOf(at.c1Pm, id)).documents.find((d) => d.fieldKey === "photos")!.id;
    await move(id, "start_work");
    const added = await addAfterPhoto(at.c1Pm, id, "half-done.jpg");
    await take(at.c1Pm, id, "ask_raiser");
    expect((await detail(at.k1Manager, id)).step.key).toBe("draft");

    expect(await afterPhotos(at.k1Manager, id)).toEqual([]);
    expect(await afterPhotos(at.c1Pm, id)).toEqual([]);
    await expectHidden(at.k1Manager.get(`/v1/work-items/${id}/documents/${added}/download`));
    await expectHidden(at.c1Pm.get(`/v1/work-items/${id}/documents/${added}/download`));
    expect(await eventHash(id, "ask_raiser")).toBe(await expectedHash(id, [before]));

    // Back with C1, it starts again from nothing.
    await take(at.k1Manager, id, "raise");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    expect(await afterPhotos(at.c1Pm, id)).toEqual([]);
  });
});
