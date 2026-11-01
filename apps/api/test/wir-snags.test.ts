// Seam 1 for Snags from a WIR's failed check items (RP-577, INSP-5; spec RP-649; ADR 0025;
// form-engine.md §3.3, workflow-engine.md §6; visibility.md V3, V19, scenario RP-577-1).
//
// A check item copied from a Checklist Template with `on_negative: create_snag` shows "Raise a
// Snag" once the Consultant Engineer answers it Fail or No, ticked by default; the tick is saved
// with the answers, the Consultant's alone until the code (V19). When the Consultant Manager
// issues any code, A to D, each failed item still ticked becomes a Snag, as Code B's rows become
// Comments: raised by the Consultant, Open with the WIR's raiser (never another Contractor, V3),
// with the WIR's Trade, Location and Scopes, the item's text as its Subject, its comment as the
// description and its photos as the "before" photos, numbered, `raised_from`-linked to the WIR
// with the check item's key, and seen by every Participant the WIR has.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ChecklistTemplates, DocumentList, StartedDocumentUpload, WorkItemDetail, WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, readById, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const FIELD = "inspection_checklist";
const VERIFIED = { sample_checked: true, matches_specification: true };
/** Three checks: the first two raise a Snag when they fail (the default), the third never does. */
const items = [
  { key: "formwork", text: { en: "Formwork tight", ar: "القوالب محكمة" }, comment: "required_on_negative", photo: "required_on_negative" },
  { key: "cover", text: bilingual("Rebar cover"), photo: "optional" },
  { key: "clean", text: bilingual("Clean of debris"), answers: "yes_no_na", comment: "off", on_negative: "none" },
];
/** Formwork and cover fail, cover unticked; clean answered No, which raises nothing. */
const TWO_FAILS = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "fail", snag: false }, clean: { answer: "no" } };
/** The Engineer's annotated copy of a photo (RP-656, a reply photo's since RP-981): the canvas's PNG. */
const DRAWN = Buffer.from("PNG annotated: arrow at the gap");
const SECOND_PHOTO = jpegWithExif({ takenAt: "2026:10:03 14:25:00", offset: "+03:00", latitude: 24.7136, longitude: 46.6753 });
const ONE_FAIL = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "pass" }, clean: { answer: "yes" } };

let projectId = "";
let electrical = "";
let buildingA = "";
let template = "";
let k1ParticipantId = "";
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: raises the WIR.
let ali: { id: string; caller: Caller }; // C1's only Project Manager: holds C1's Step Pool.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager: issues the code.
let faisal: { id: string; caller: Caller }; // O1, Owner Representative: oversight.
let yousef: { id: string; caller: Caller }; // C2, another Contractor covering all of Electrical.

const answer = (by: Caller, id: string, answers: object) => by.request("PUT", `/v1/work-items/${id}/reply-checklists/${FIELD}`, { answers });
const documentsOf = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const snagList = async (by: Caller, query = ""): Promise<WorkItemList["items"]> =>
  (await ok(by.get(`/v1/projects/${projectId}/modules/snag_list/work-items${query}`), 200)).json().items;
const bytesOf = async (by: Caller, itemId: string, documentId: string) => {
  const { url } = (await ok(by.get(`/v1/work-items/${itemId}/documents/${documentId}/download`), 200)).json() as { url: string };
  return Buffer.from(await (await fetch(url)).arrayBuffer());
};

/** The items of `type` `by` sees in the Snag List, raised from WIR `wir`. */
async function raisedFrom(by: Caller, wir: string, type: string): Promise<WorkItemList["items"]> {
  const number = (await detail(mohammed.caller, wir)).documentNumber!;
  return (await snagList(by, `?raisedFrom=${encodeURIComponent(number)}`)).filter((i) => i.type.code === type);
}
const snagCount = async (by: Caller, wir: string) => {
  const line = (await detail(by, wir)).raisedItems.find((r) => r.type.code === "SNG");
  return line ? { open: line.open, closed: line.closed } : null;
};

/** Uploads `body` as photo `fileName` of check item `item` of WIR `id`, as Ahmed; returns the Document's id. */
async function addPhoto(id: string, item: string, body: Buffer, fileName = `${item}.jpg`): Promise<string> {
  const started = await ahmed.caller.post(`/v1/work-items/${id}/documents`, {
    fieldKey: FIELD,
    itemKey: item,
    reply: true,
    fileName,
    contentType: "image/jpeg",
    sizeBytes: body.byteLength,
  });
  expect(started.statusCode, started.body).toBe(201);
  const { id: documentId, upload } = started.json() as StartedDocumentUpload;
  const stored = await fetch(upload.url, { method: upload.method, headers: upload.headers, body });
  expect(stored.status).toBe(200);
  const confirmed = await ahmed.caller.post(`/v1/work-items/${id}/documents/${documentId}/confirm`);
  expect(confirmed.statusCode, confirmed.body).toBe(204);
  return documentId;
}

/** A WIR raised by Hafiz and Submitted by Ali to K1, where Ahmed answered `answers` (with a photo of a failed formwork) and Sent it to Mohammed. */
async function atManager(title: string, answers: object) {
  const id = (
    await ok(
      hafiz.caller.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title,
        answers: { description: "Slab, Level 2", requested_for: "2026-11-02T05:30:00.000Z", trade: electrical, location: buildingA, checklist_template: template },
      }),
      201,
    )
  ).json().id as string;
  await take(hafiz.caller, id, "send_for_review");
  await take(ali.caller, id, "submit", { answers: { cover_note: "Ready on site from 09:00" } });
  expect((await answer(ahmed.caller, id, answers)).statusCode).toBe(204);
  if ((answers as typeof ONE_FAIL).formwork.answer === "fail") await addPhoto(id, "formwork", jpegWithExif());
  return id;
}
const sendToManager = (id: string, code: string) => take(ahmed.caller, id, "send_to_manager", { recommendedCode: code });

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WSN" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const created = await post("checklist-templates", { name: bilingual("Slab pour"), tradeId: electrical, items });
  const list: ChecklistTemplates = (await ok(c1.caller.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  template = list.templates.find((t) => t.id === created)!.versionId;
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "owner_representative" | "contractor") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  k1ParticipantId = await participant(k1, "consultant");
  const o1ParticipantId = await participant(o1, "owner_representative");
  const c2ParticipantId = await participant(c2, "contractor");
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = await memberOnProject(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" });
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("the \"Raise a Snag\" tick (seam 1)", () => {
  it("is saved with the answers, kept only when unticked, and only on an item that raises a Snag", async () => {
    const id = await atManager("Tick", TWO_FAILS);
    expect((await detail(ahmed.caller, id)).replyChecklists[0]!.answers).toEqual(TWO_FAILS);
    const refused = await answer(ahmed.caller, id, { ...TWO_FAILS, clean: { answer: "no", snag: false } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: FIELD, code: "wrong_type", item: "clean" }] });
  });
});

describe("the code raises a Snag from each ticked failed item (seam 1)", () => {
  let wir = "";
  let snag: WorkItemDetail;
  let photos: string[] = [];

  beforeAll(async () => {
    wir = await atManager("Two fails", TWO_FAILS);
    const original = (await documentsOf(ahmed.caller, wir)).documents.find((d) => d.itemKey === "formwork")!.id;
    photos = [original, await addPhoto(wir, "formwork", SECOND_PHOTO, "formwork-joint.jpg")];
    await uploadDocument(ahmed.caller, wir, { annotatedFromId: original, fileName: "formwork-annotated.png", contentType: "image/png", body: DRAWN });
    await sendToManager(wir, "C");
    await take(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
    const raised = await raisedFrom(hafiz.caller, wir, "SNG");
    expect(raised).toHaveLength(1); // not hidden-from: how many Snags the code raised, read by C1, who sees them
    snag = await detail(hafiz.caller, raised[0]!.id);
  });

  it("Code C, two Fails, one unticked: one Snag, Open with C1, the item's text, comment and photos, raised from the WIR", async () => {
    const source = await detail(hafiz.caller, wir);
    expect(snag.type.code).toBe("SNG");
    expect(snag.title).toBe("Formwork tight"); // A bilingual Project's record language: English first.
    expect(snag.step?.key).toBe("open");
    // C1's Step Pool, which C1 reads by name; nobody of C1 picked it up yet.
    expect(snag.heldBy?.memberName).toBeNull();
    expect(snag.heldBy?.pool?.names).toEqual(expect.arrayContaining([bilingual("Ali Sonour")]));
    expect(snag.documentNumber).not.toBeNull();
    expect(snag.answers).toMatchObject({ description: "Gap at the joint", trade: electrical, location: buildingA });
    expect(snag.raisedFrom).toMatchObject({ documentNumber: source.documentNumber, subject: "Two fails", workItemId: wir, outcome: { code: "C" } });
    expect(await snagCount(hafiz.caller, wir)).toEqual({ open: 1, closed: 0 });
  });

  it("copies the item's two photos as the Snag's \"before\" photos, the annotated copy beside its original's copy (RP-656): new Documents, the same bytes", async () => {
    const copied = (await documentsOf(hafiz.caller, snag.id)).documents;
    expect(copied.map((d) => [d.fieldKey, d.itemKey, d.fileName]).sort()).toEqual([
      ["photos", null, "formwork-annotated.png"],
      ["photos", null, "formwork-joint.jpg"],
      ["photos", null, "formwork.jpg"],
    ]);
    const named = (fileName: string) => copied.find((d) => d.fileName === fileName)!;
    expect(copied.map((d) => d.id)).not.toContain(photos[0]); // not hidden-from: the Snag's photos are new Documents, not the WIR's
    expect(named("formwork-annotated.png").annotatedFromId).toBe(named("formwork.jpg").id);
    expect(named("formwork.jpg").annotatedFromId).toBeNull();
    expect(await bytesOf(hafiz.caller, snag.id, named("formwork.jpg").id)).toEqual(await bytesOf(hafiz.caller, wir, photos[0]!));
    expect(await bytesOf(hafiz.caller, snag.id, named("formwork-joint.jpg").id)).toEqual(SECOND_PHOTO);
    expect(await bytesOf(hafiz.caller, snag.id, named("formwork-annotated.png").id)).toEqual(DRAWN);
  });

  it("its Raised from read carries the check item's key, text and photos: the WIR's own, in upload order, the annotated copy too (RP-1081)", async () => {
    const wirPhotos = (await documentsOf(hafiz.caller, wir)).documents.filter((d) => d.itemKey === "formwork");
    expect(wirPhotos).toHaveLength(3); // not hidden-from: the check item's three photos, read by C1, who sees them
    const ofWir = (fileName: string) => wirPhotos.find((d) => d.fileName === fileName)!;
    expect(snag.raisedFrom?.checkItem).toEqual({
      key: "formwork",
      text: { en: "Formwork tight", ar: "القوالب محكمة" },
      photos: ["formwork.jpg", "formwork-joint.jpg", "formwork-annotated.png"].map((fileName) => {
        const d = ofWir(fileName);
        return { id: d.id, fileName: d.fileName, contentType: d.contentType };
      }),
    });
    // Each one downloads from the WIR, where the reader sees it.
    expect(await bytesOf(hafiz.caller, wir, ofWir("formwork-joint.jpg").id)).toEqual(SECOND_PHOTO);
  });

  it("its history starts with the Raise, shared, by the Consultant", async () => {
    // K1 reads its own Member's name: the Manager who issued the code raised it.
    expect((await history(ahmed.caller, snag.id))[0]).toMatchObject({ type: "transition", audience: "shared", by: { memberName: bilingual("Mohammed Al Shamsi") } });
    // C1 reads the same Raise, by K1's name only (V14).
    expect((await history(hafiz.caller, snag.id))[0]).toMatchObject({ type: "transition", audience: "shared", by: { memberName: null } });
  });
});

describe("every code raises them (seam 1)", () => {
  it("Code B with one ticked Fail and two rows: one Snag and two Comments", async () => {
    const wir = await atManager("Code B", ONE_FAIL);
    await sendToManager(wir, "B");
    await take(mohammed.caller, wir, "approve_b", {
      answers: { ...VERIFIED, remarks: "Approved with comments", items_to_create: [{ comment: "Label the joints" }, { comment: "Clean the edges" }] },
    });
    expect((await raisedFrom(hafiz.caller, wir, "SNG")).map((s) => s.title)).toEqual(["Formwork tight"]);
    expect((await raisedFrom(hafiz.caller, wir, "CMT")).map((c) => c.title).sort()).toEqual(["Clean the edges", "Label the joints"]);
  });

  it("Code A with one ticked Fail still raises the Snag", async () => {
    const wir = await atManager("Code A", ONE_FAIL);
    await sendToManager(wir, "A");
    await take(mohammed.caller, wir, "approve_a", { answers: { ...VERIFIED, remarks: "Approved" } });
    expect((await raisedFrom(hafiz.caller, wir, "SNG")).map((s) => s.title)).toEqual(["Formwork tight"]);
  });

  it("Code D with one ticked Fail raises the Snag too", async () => {
    const wir = await atManager("Code D", ONE_FAIL);
    await sendToManager(wir, "D");
    await take(mohammed.caller, wir, "reject_d", { answers: { ...VERIFIED, remarks: "Rejected" } });
    expect((await raisedFrom(hafiz.caller, wir, "SNG")).map((s) => s.title)).toEqual(["Formwork tight"]);
  });

  it("the same code again (its key replayed) raises no second Snag, and the Snag's photo still opens", async () => {
    const wir = await atManager("Replayed", ONE_FAIL);
    await sendToManager(wir, "C");
    const code = { transition: "revise_c", answers: { ...VERIFIED, remarks: "Seal the formwork" }, confirmed: true, idempotencyKey: randomUUID() };
    await ok(mohammed.caller.post(`/v1/work-items/${wir}/transitions`, code), 204);
    await ok(mohammed.caller.post(`/v1/work-items/${wir}/transitions`, code), 204);
    const raised = await raisedFrom(hafiz.caller, wir, "SNG");
    expect(raised).toHaveLength(1); // not hidden-from: the replayed code raised no second Snag
    const [copied] = (await documentsOf(hafiz.caller, raised[0]!.id)).documents;
    expect(await bytesOf(hafiz.caller, raised[0]!.id, copied!.id)).toEqual(jpegWithExif());
  });

  it("an item answered Pass or N/A, or unticked, raises none", async () => {
    const wir = await atManager("No snag", { formwork: { answer: "fail", comment: "Gap", snag: false }, cover: { answer: "na" }, clean: { answer: "yes" } });
    await sendToManager(wir, "C");
    await take(mohammed.caller, wir, "reject_d", { answers: { ...VERIFIED, remarks: "Rejected" } });
    expect(await raisedFrom(hafiz.caller, wir, "SNG")).toEqual([]); // not hidden-from: the code raised none
    expect(await snagCount(hafiz.caller, wir)).toBeNull();
  });
});

// Scenario RP-577-1 (visibility.md): the Snag is seen where its WIR is: C2, another Contractor of
// the same Trade, sees neither the Snag nor its count (V3); the Owner Representative sees it as
// it sees the WIR. Seam 2: `packages/db/test/reply-checklist-rls.test.ts`.
describe("RP-577-1: who sees the Snags raised at the code", () => {
  let wir = "";
  let snag = "";

  beforeAll(async () => {
    wir = await atManager("Visibility", ONE_FAIL);
    await sendToManager(wir, "C");
    await take(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
    snag = (await raisedFrom(hafiz.caller, wir, "SNG"))[0]!.id;
  });

  it("C2 sees neither the Snag, its photos, nor its count; the WIR is hidden from it too", async () => {
    type Member = { id: string; caller: Caller };
    const seenBy = [hafiz, mohammed, faisal];
    const known = new Map<Member, string>([[hafiz, "Hafiz (C1)"], [mohammed, "Mohammed (K1)"], [faisal, "Faisal (O1)"], [yousef, "Yousef (C2)"]]);
    const hidden = (read: (m: Member) => Promise<readonly { id: string }[]>, target: string, label: string) =>
      expectHiddenFrom({ read, target, seenBy, hiddenFrom: yousef, name: (m) => known.get(m) ?? m.id, label });
    await hidden((m) => snagList(m.caller), snag, "the Snag List");
    await hidden((m) => readById(`/v1/work-items/${snag}`)(m.caller), snag, "the Snag");
    const photo = (await documentsOf(hafiz.caller, snag)).documents[0]!.id;
    await hidden(async (m) => (await readById<DocumentList>(`/v1/work-items/${snag}/documents`)(m.caller)).flatMap((l) => l.documents), photo, "the Snag's photo");
    await hidden((m) => readById(`/v1/work-items/${wir}`)(m.caller), wir, "the WIR");
  });

  it("C1, K1 and the Owner Representative see it, its photo and its source, and count it", async () => {
    const number = (await detail(mohammed.caller, wir)).documentNumber!;
    for (const reader of [hafiz, ali, ahmed, mohammed, faisal]) {
      const list = await snagList(reader.caller);
      expect(list.map((i) => i.id), reader.id).toContain(snag);
      // Its source too, not only to C1 holding it (RP-1031): in the row and through the filter.
      expect(list.find((i) => i.id === snag)!.raisedFrom, reader.id).toMatchObject({ documentNumber: number, workItemId: wir });
      expect((await raisedFrom(reader.caller, wir, "SNG")).map((i) => i.id), reader.id).toEqual([snag]);
      expect((await documentsOf(reader.caller, snag)).documents.map((d) => d.fileName), reader.id).toEqual(["formwork.jpg"]);
      // The card's check item photo is the WIR's, which they see too (RP-1081-1).
      expect((await detail(reader.caller, snag)).raisedFrom?.checkItem?.photos.map((p) => p.fileName), reader.id).toEqual(["formwork.jpg"]);
      expect(await snagCount(reader.caller, wir), reader.id).toEqual({ open: 1, closed: 0 });
    }
  });
});

// Scenario RP-1081-1 (visibility.md): the Snag's "Raised from" card shows the failed check item's
// photos, the WIR's own Documents, the annotated copy too, never a passed item's; only to a reader
// who sees both the Snag and the WIR, through a Link not removed (V19). Seam 2:
// `packages/db/test/reply-checklist-rls.test.ts`.
describe("RP-1081-1: the Raised from card's check item photos are the WIR's, read where the WIR is", () => {
  let wir = "";
  let snag = "";
  let item: string[] = [];
  let other: Caller;
  /** The check item photo ids the Snag's Raised from card shows `m`, none when the Snag is hidden from them. */
  const cardPhotos = async (m: { caller: Caller }) =>
    (await readById<WorkItemDetail>(`/v1/work-items/${snag}`)(m.caller)).flatMap((d) => d.raisedFrom?.checkItem?.photos ?? []);

  beforeAll(async () => {
    wir = await atManager("Card photos", ONE_FAIL);
    const original = (await documentsOf(ahmed.caller, wir)).documents.find((d) => d.itemKey === "formwork")!.id;
    const copy = await uploadDocument(ahmed.caller, wir, { annotatedFromId: original, fileName: "formwork-annotated.png", contentType: "image/png", body: DRAWN });
    // A photo of the passed item: no Snag of its own, never on this Snag's card.
    await addPhoto(wir, "cover", SECOND_PHOTO, "cover.jpg");
    await sendToManager(wir, "C");
    await take(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
    snag = (await raisedFrom(hafiz.caller, wir, "SNG"))[0]!.id;
    item = [original, copy];
    const outsider = await api.projectCreator();
    await api.createProject(outsider.caller, { code: "WSO" });
    other = outsider.caller;
  });

  it("C1, K1 and the Owner read the failed item's photos, its annotated copy too, never the passed item's", async () => {
    for (const reader of [hafiz, ali, ahmed, mohammed, faisal]) {
      expect((await cardPhotos(reader)).map((p) => p.id), reader.id).toEqual(item);
    }
  });

  it("C2 and another Project's Member are shown none: the Snag is a 404 to them", async () => {
    const outsider = { id: "another Project's Member", caller: other };
    for (const target of item) {
      await expectHiddenFrom({ read: cardPhotos, target, seenBy: hafiz, hiddenFrom: [yousef, outsider], name: (m) => m.id, label: "the card's check item photos" });
    }
  });

  it("shows none to the Owner once it sees the Snag but not the WIR, and none to anyone once the Link is removed", async () => {
    const o1 = await sql<{ participant_id: string }>`
      select a.participant_id from work_item_access a join participant p on p.id = a.participant_id join project_role r on r.id = p.project_role_id
      where a.work_item_id = ${wir}::uuid and r.base_role = 'owner_representative'
    `.execute(migrator);
    expect(o1.rows).toHaveLength(1); // not hidden-from: the Owner's one access row to the WIR, which this test takes off
    await sql`delete from work_item_access where work_item_id = ${wir}::uuid and participant_id = ${o1.rows[0]!.participant_id}::uuid`.execute(migrator);
    // The Owner still reads the Snag; its card names no photo of the WIR it no longer sees.
    expect((await readById(`/v1/work-items/${snag}`)(faisal.caller)).map((d) => d.id)).toEqual([snag]);
    for (const target of item) await expectHiddenFrom({ read: cardPhotos, target, seenBy: [hafiz, mohammed], hiddenFrom: faisal, name: (m) => m.id, label: "no WIR" });
    await sql`update work_item_link set removed_at = now() where from_id = ${snag}::uuid and kind = 'raised_from'`.execute(migrator);
    for (const reader of [hafiz, mohammed]) {
      expect(await cardPhotos(reader), reader.id).toEqual([]); // not hidden-from: both read them just above; the removed Link names them to nobody
    }
  });
});

// Last in the file: it binds the Snag Type, for K1 on this Project, to a Workflow K1 can't raise
// on, and nothing after it raises a Snag.
describe("a Snag Type that can't take them refuses the code (seam 1)", () => {
  it("nothing is written: no code, no Snag, the WIR still with the Manager", async () => {
    const wir = await atManager("Refused", ONE_FAIL);
    await sendToManager(wir, "C");
    // K1's Snags start on the Question to Consultant Workflow, whose Draft is the Contractor's.
    await sql`
      insert into workflow_binding (project_id, work_item_type_id, raising_participant_id, workflow_definition_id)
      select ${projectId}::uuid, snag.id, ${k1ParticipantId}::uuid, question.workflow_definition_id
      from work_item_type snag, work_item_type question
      where snag.owner_kind = 'rabaed' and snag.code = 'SNG' and question.owner_kind = 'rabaed' and question.code = 'QSN'
    `.execute(migrator);
    const refused = await tryTake(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
    expect(refused.statusCode).toBe(500);
    const after = await detail(mohammed.caller, wir);
    expect(after.outcome).toBeNull();
    expect(after.step?.key).toBe("consultant_manager");
    expect((await history(mohammed.caller, wir)).map((e) => e.type)).not.toContain("issue_code"); // not hidden-from: the refused code wrote no event, for its Manager either
    expect(await raisedFrom(mohammed.caller, wir, "SNG")).toEqual([]); // not hidden-from: and raised no Snag
  });
});
