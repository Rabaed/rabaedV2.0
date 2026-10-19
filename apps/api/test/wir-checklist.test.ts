// Seam 1 for the WIR's checklist in the Consultant Manager's code Screens (RP-86, INSP-4; spec
// RP-649; ADR 0024 amended 2026-10-19, ADR 0025; form-engine.md §3.3, workflow-engine.md §5.7;
// visibility.md V19, scenario RP-86-1).
//
// The WIR Workflow's codes show Screens holding the checklist the WIR copied from its Checklist
// Template. The Consultant Engineer answers it on site, item by item, with comments and photos,
// saved as they go; Send to Manager checks it like a required section; the Manager reads it in
// the code pop-up, with the summary, the Engineer's Recommended Code and the proposed code (C when
// any item failed, else A); Return to Engineer keeps it; the code freezes and shares it and
// covers it in its content hash. Until the code only the Consultant reads it.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import { createHash } from "node:crypto";
import { createDb, withMember } from "@rabaed/db";
import { expectedContentSha256, testDatabaseUrls, type HashedDocument } from "@rabaed/db/test-support";
import type { ChecklistTemplates, DocumentList, StartedDocumentUpload, WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
const appDb = createDb(testDatabaseUrls().app, { max: 2 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
  await appDb.destroy();
});

const FIELD = "inspection_checklist";
const photo = jpegWithExif();
const VERIFIED = { sample_checked: true, matches_specification: true };
/** Three checks: one asks a comment and a photo when it fails. */
const items = [
  { key: "formwork", text: bilingual("Formwork tight"), comment: "required_on_negative", photo: "required_on_negative" },
  { key: "cover", text: bilingual("Rebar cover"), photo: "optional" },
  { key: "clean", text: bilingual("Clean of debris"), answers: "yes_no_na", comment: "off" },
];
const FAILED = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "pass" }, clean: { answer: "na" } };

let projectId = "";
let electrical = "";
let buildingA = "";
let template = ""; // The Checklist Template Version a WIR picks.
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: the author.
let ali: { id: string; caller: Caller }; // C1's only Project Manager.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager.
let faisal: { id: string; caller: Caller }; // O1, Owner Representative: oversight.
let yousef: { id: string; caller: Caller }; // C2, a second Contractor covering Mechanical only.

const answer = (by: Caller, id: string, answers: object) => by.request("PUT", `/v1/work-items/${id}/reply-checklists/${FIELD}`, { answers });
const documentsOf = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
const codeOf = (events: WorkItemHistory["events"]) => events.find((e) => e.type === "issue_code");

/** Uploads a photo of check item `item` of WIR `id` as `by` (start, PUT to the signed URL, confirm); returns the Document's id. */
async function addPhoto(by: Caller, id: string, item: string): Promise<string> {
  const started = await by.post(`/v1/work-items/${id}/documents`, {
    fieldKey: FIELD,
    itemKey: item,
    reply: true,
    fileName: `${item}.jpg`,
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

/** A WIR raised by Hafiz, Submitted by Ali to K1: Ahmed, K1's only Engineer, holds the Consultant Engineer Step at once. */
async function submitted(title: string) {
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
  return id;
}

/** Ahmed answered the checklist (`answers`, with the formwork photo when it failed) and Sent it to Mohammed recommending `code`. */
async function atManager(title: string, answers: object = FAILED, code = "C") {
  const id = await submitted(title);
  expect((await answer(ahmed.caller, id, answers)).statusCode).toBe(204);
  const formworkPhoto = (answers as typeof FAILED).formwork?.answer === "fail" ? await addPhoto(ahmed.caller, id, "formwork") : null;
  await take(ahmed.caller, id, "send_to_manager", { recommendedCode: code });
  return { id, formworkPhoto };
}

/** The content hash the code of item `id` carries, hex. */
async function codeHash(id: string): Promise<string> {
  const { rows } = await sql<{ hash: string }>`
    select encode(content_sha256, 'hex') as hash from work_item_event where work_item_id = ${id}::uuid and type = 'issue_code'
  `.execute(migrator);
  return rows[0]!.hash;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WCK" })).id;
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
  const k1ParticipantId = await participant(k1, "consultant");
  const o1ParticipantId = await participant(o1, "owner_representative");
  const c2ParticipantId = await participant(c2, "contractor");
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: { isAll: false, valueIds: [mechanical] }, location: all }));
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = await memberOnProject(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" });
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("the Consultant Engineer fills the checklist on site (seam 1)", () => {
  it("the item page holds the copied checklist to fill for K1's Members while the Engineer's Step holds it; nobody else's does", async () => {
    const id = await submitted("Fill");
    expect((await detail(ahmed.caller, id)).replyChecklists).toEqual([
      {
        fieldKey: FIELD,
        label: { en: "Checklist", ar: "قائمة التحقق" },
        name: bilingual("Slab pour"),
        items: expect.arrayContaining([expect.objectContaining({ key: "formwork", photo: "required_on_negative" })]),
        answers: {},
        canChange: true,
      },
    ]);
    // Any Member of the Participant holding it may add to it (ADR 0024), the Manager too.
    expect((await detail(mohammed.caller, id)).replyChecklists.map((c) => c.fieldKey)).toEqual([FIELD]);
    for (const other of [hafiz, ali, faisal]) expect((await detail(other.caller, id)).replyChecklists, other.id).toEqual([]);
  });

  it("saves the answers as they go, checked item by item", async () => {
    const id = await submitted("Saves");
    expect((await answer(ahmed.caller, id, { formwork: { answer: "fail" } })).statusCode).toBe(204);
    expect((await detail(ahmed.caller, id)).replyChecklists[0]!.answers).toEqual({ formwork: { answer: "fail" } });
    const wrong = await answer(ahmed.caller, id, { clean: { answer: "pass" } });
    expect(wrong.statusCode, wrong.body).toBe(422);
    expect(wrong.json()).toMatchObject({ error: "invalid_answers", fields: [{ key: FIELD, code: "unknown_option", item: "clean" }] });
    // Nobody outside K1 writes them; C2 doesn't even see the WIR.
    for (const other of [hafiz, ali, faisal]) expect((await answer(other.caller, id, FAILED)).statusCode, other.id).toBe(409);
    await expectHidden(answer(yousef.caller, id, FAILED));
  });

  it("Send to Manager wants every item answered and a Fail's comment and photo, naming the item; the Manager then sees the summary, the Recommended Code and C proposed", async () => {
    const id = await submitted("Send to Manager");
    const unanswered = await tryTake(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
    expect(unanswered.statusCode, unanswered.body).toBe(422);
    expect(unanswered.json()).toMatchObject({
      error: "form_incomplete",
      fields: [
        { key: FIELD, code: "required", item: "formwork" },
        { key: FIELD, code: "required", item: "cover" },
        { key: FIELD, code: "required", item: "clean" },
      ],
    });
    expect((await answer(ahmed.caller, id, FAILED)).statusCode).toBe(204);
    const noPhoto = await tryTake(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
    expect(noPhoto.statusCode, noPhoto.body).toBe(422);
    expect(noPhoto.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: FIELD, code: "photo_required", item: "formwork" }] });
    await addPhoto(ahmed.caller, id, "formwork");
    await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "B" });

    const { actions } = await detail(mohammed.caller, id);
    expect(actions.recommendedCode?.code).toBe("B");
    const codes = actions.transitions.filter((t) => t.key !== "return_to_engineer");
    expect(codes.map((t) => [t.key, t.proposed ?? false])).toEqual([
      ["approve_a", false],
      ["approve_b", false],
      ["revise_c", true],
      ["reject_d", false],
    ]);
    for (const code of codes) {
      expect(code.checklists, code.key).toEqual([expect.objectContaining({ fieldKey: FIELD, answers: FAILED, canChange: false })]);
    }
    // The Manager reads it; only the Engineer's Step writes it.
    expect((await answer(mohammed.caller, id, FAILED)).statusCode).toBe(422);
  });

  it("proposes A when no item failed", async () => {
    const { id } = await atManager("All pass", { formwork: { answer: "pass" }, cover: { answer: "na" }, clean: { answer: "yes" } }, "A");
    const { actions } = await detail(mohammed.caller, id);
    expect(actions.transitions.filter((t) => t.proposed).map((t) => t.key)).toEqual(["approve_a"]);
  });

  it("Return to Engineer keeps the answers; the Engineer changes one and sends again; the Manager issues C, whose content hash covers them", async () => {
    const { id, formworkPhoto } = await atManager("Returned");
    await take(mohammed.caller, id, "return_to_engineer", { reason: "Check the cover again" });
    expect((await detail(ahmed.caller, id)).replyChecklists[0]!.answers).toEqual(FAILED);
    const changed = { ...FAILED, cover: { answer: "fail", comment: "Cover 30 mm" } };
    expect((await answer(ahmed.caller, id, changed)).statusCode).toBe(204);
    await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
    await take(mohammed.caller, id, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork, raise the cover" } });

    const { rows: item } = await sql<{ title: string; data: object }>`select title, data from work_item where id = ${id}::uuid`.execute(migrator);
    const { rows: documents } = await sql<HashedDocument>`
      select id, field_key, item_key, file_name, content_type, size_bytes::int as size_bytes, storage_key from document where work_item_id = ${id}::uuid
    `.execute(migrator);
    const fingerprint = createHash("sha256").update(photo).digest("hex");
    expect(documents.map((d) => d.id)).toEqual([formworkPhoto]);
    expect(await codeHash(id)).toBe(
      expectedContentSha256({
        title: item[0]!.title,
        data: item[0]!.data,
        outcome: "C",
        documents: documents.map((d) => ({ ...d, file_sha256: fingerprint }) as HashedDocument),
        checklists: [{ field_key: FIELD, answers: changed }],
      }),
    );
    // Shared with the code: the Contractor reads the checklist with the code, and its photo.
    expect(codeOf(await history(hafiz.caller, id))?.answers).toMatchObject({ [FIELD]: changed, remarks: "Seal the formwork, raise the cover" });
    expect((await documentsOf(hafiz.caller, id)).documents.map((d) => [d.id, d.fieldKey, d.itemKey])).toEqual([[formworkPhoto, FIELD, "formwork"]]);
  });
});

// Scenario RP-86-1 (visibility.md): until the code, the Engineer's answers and photos are the
// Consultant's alone (V19), read through the api and as the app role (row-level security).
describe("RP-86-1: who reads the Consultant Engineer's checklist", () => {
  let id = "";
  let formworkPhoto = "";
  const answersAs = (as: string) =>
    withMember(appDb, as, (trx) => sql<{ answers: unknown }>`select answers from reply_checklist where work_item_id = ${id}::uuid`.execute(trx).then((r) => r.rows));

  beforeAll(async () => {
    const made = await atManager("Visibility");
    id = made.id;
    formworkPhoto = made.formworkPhoto!;
  });

  it("before the code, C1 and the Owner read none of the answers or photos: item, lists, history, Document id; K1 does", async () => {
    for (const outsider of [hafiz, ali, faisal]) {
      expect((await detail(outsider.caller, id)).replyChecklists, outsider.id).toEqual([]);
      expect(JSON.stringify(await history(outsider.caller, id)), outsider.id).not.toContain("Gap at the joint");
      expect((await documentsOf(outsider.caller, id)).documents.map((d) => d.id), outsider.id).not.toContain(formworkPhoto);
      await expectHidden(outsider.caller.get(`/v1/work-items/${id}/documents/${formworkPhoto}/download`));
      expect(await answersAs(outsider.id), outsider.id).toEqual([]);
      const list = (await ok(outsider.caller.get(`/v1/projects/${projectId}/work-items`), 200)).body;
      expect(list, outsider.id).not.toContain("Gap at the joint");
    }
    expect(await answersAs(mohammed.id)).toEqual([{ answers: FAILED }]);
    expect((await documentsOf(mohammed.caller, id)).documents.map((d) => d.id)).toContain(formworkPhoto);
  });

  it("after the code, C1 and the Owner read them with it; C2 never reads the WIR", async () => {
    await take(mohammed.caller, id, "revise_c", { answers: { ...VERIFIED, remarks: "Seal the formwork" } });
    for (const reader of [hafiz, ali, faisal]) {
      expect(codeOf(await history(reader.caller, id))?.answers?.[FIELD], reader.id).toEqual(FAILED);
      expect((await documentsOf(reader.caller, id)).documents.map((d) => d.id), reader.id).toContain(formworkPhoto);
    }
    await expectHidden(yousef.caller.get(`/v1/work-items/${id}`));
    await expectHidden(yousef.caller.get(`/v1/work-items/${id}/history`));
    await expectHidden(yousef.caller.get(`/v1/work-items/${id}/documents`));
    expect(await answersAs(yousef.id)).toEqual([]);
  });
});
