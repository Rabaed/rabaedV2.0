// Seam 1 for the WIR request and on-site inspection screens (RP-655, INSP-9; spec RP-649; ADR 0024
// amended 2026-10-19, ADR 0025; visibility.md V5, V19).
//
// The screens save as they go and read everything back from the item: a reload mid-inspection
// must find the Consultant Engineer's answers, comments, "Raise a Snag" ticks and photos (the
// annotated copy beside its original) as they were, still the Consultant's alone. The page shows
// exactly the actions the API offers each person at each Step: the Contractor's Send for Review and
// Submit, the Engineer's Send to Manager with its Recommended Codes, the Manager's Return to
// Engineer and the four codes that take the checklist, the one the checklist proposes marked.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults.
import type { ChecklistTemplates, DocumentList, WorkItemDetail } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(async () => {
  await api.close();
});

const FIELD = "inspection_checklist";
const photo = jpegWithExif();
/** Three checks of the Project's template; the first asks a comment and a photo on a Fail. */
const items = [
  { key: "supports", text: bilingual("Supports at the spacing on the drawing"), comment: "required_on_negative", photo: "required_on_negative" },
  { key: "earthing", text: bilingual("Trays bonded to earth") },
  { key: "clearance", text: bilingual("Clearance from other services kept") },
];
/** Half way through on site: one Fail with its comment, one Pass with its "Raise a Snag" tick taken off a Fail before, one unanswered. */
const HALF_WAY = { supports: { answer: "fail", comment: "Spacing 1.8 m at grid 4" }, earthing: { answer: "pass" } };

let projectId = "";
let electrical = "";
let buildingA = "";
let template = "";
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: raises the WIR.
let ali: { id: string; caller: Caller }; // C1's only Project Manager.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer.
let mohammed: { id: string; caller: Caller }; // K1's only Manager.

const answer = (by: Caller, id: string, answers: object) => by.request("PUT", `/v1/work-items/${id}/reply-checklists/${FIELD}`, { answers });
const documentsOf = async (by: Caller, id: string): Promise<DocumentList> => (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
/** The offered Transitions' keys, as the page lists them. */
const offered = (item: WorkItemDetail) => item.actions.transitions.map((t) => t.key);

/** A WIR Hafiz raised (a Draft), with Requested for, Trade, Location and the Checklist Template. */
async function raised(title: string) {
  return (
    await ok(
      hafiz.caller.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title,
        answers: { description: "Cable trays, level 2", requested_for: "2026-11-02T06:00:00.000Z", trade: electrical, location: buildingA, checklist_template: template },
      }),
      201,
    )
  ).json().id as string;
}

/** Sent for review and Submitted by Ali: Ahmed, K1's only Engineer, holds the Consultant Engineer Step at once. */
async function submitted(title: string) {
  const id = await raised(title);
  await take(hafiz.caller, id, "send_for_review");
  await take(ali.caller, id, "submit", { answers: { cover_note: "Ready from 09:00" } });
  return id;
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WSC" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const created = await post("checklist-templates", { name: bilingual("Cable trays"), tradeId: electrical, items });
  const list: ChecklistTemplates = (await ok(c1.caller.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  template = list.templates.find((t) => t.id === created)!.versionId;
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
});

describe("a reload mid-inspection (seam 1)", () => {
  let id = "";
  let original = "";
  let copy = "";

  beforeAll(async () => {
    id = await submitted("Reload");
    expect((await answer(ahmed.caller, id, { ...HALF_WAY, earthing: { answer: "fail", snag: false } })).statusCode).toBe(204);
    expect((await answer(ahmed.caller, id, HALF_WAY)).statusCode).toBe(204);
    original = await uploadDocument(ahmed.caller, id, { fieldKey: FIELD, itemKey: "supports", reply: true, fileName: "supports.jpg", contentType: "image/jpeg", body: photo });
    copy = await uploadDocument(ahmed.caller, id, { annotatedFromId: original, fileName: "supports-annotated.png", contentType: "image/png", body: Buffer.from("\x89PNG an arrow at grid 4") });
  });

  it("the page read again finds the Engineer's answers and comments as saved, still the Engineer's to change", async () => {
    const [checklist] = (await detail(ahmed.caller, id)).replyChecklists;
    expect(checklist).toMatchObject({ fieldKey: FIELD, copyOf: "checklist_template", name: bilingual("Cable trays"), answers: HALF_WAY, canChange: true });
    expect(checklist!.items.map((i) => i.key)).toEqual(["supports", "earthing", "clearance"]);
  });

  it("and the photo with its annotated copy beside it, on its check item, not yet taken", async () => {
    const list = await documentsOf(ahmed.caller, id);
    expect(list.canChangeReplies).toBe(true);
    expect(list.documents.map((d) => [d.id, d.fieldKey, d.itemKey, d.annotatedFromId, d.reply])).toEqual([
      [original, FIELD, "supports", null, { taken: false }],
      [copy, FIELD, "supports", original, { taken: false }],
    ]);
  });

  it("an unticked \"Raise a Snag\" survives the reload too", async () => {
    const unticked = { ...HALF_WAY, supports: { ...HALF_WAY.supports, snag: false } };
    expect((await answer(ahmed.caller, id, unticked)).statusCode).toBe(204);
    expect((await detail(ahmed.caller, id)).replyChecklists[0]!.answers).toEqual(unticked);
    expect((await answer(ahmed.caller, id, HALF_WAY)).statusCode).toBe(204);
  });

  it("the Contractor reloading reads none of it until the code (V19)", async () => {
    for (const outsider of [hafiz, ali]) {
      expect((await detail(outsider.caller, id)).replyChecklists, outsider.id).toEqual([]);
      expect((await documentsOf(outsider.caller, id)).documents, outsider.id).toEqual([]);
      for (const document of [original, copy]) await expectHidden(outsider.caller.get(`/v1/work-items/${id}/documents/${document}/download`));
    }
  });
});

describe("the actions the screens show are the API's offered actions (seam 1)", () => {
  it("the Contractor: Send for Review and Cancel on the Draft; Submit (with its Cover Note Screen), Return and Cancel in review; nothing once Submitted", async () => {
    const id = await raised("Offered: Contractor");
    expect(offered(await detail(hafiz.caller, id)).sort()).toEqual(["cancel", "send_for_review"]);
    await take(hafiz.caller, id, "send_for_review");
    const review = await detail(ali.caller, id);
    expect(offered(review).sort()).toEqual(["cancel_review", "return", "submit"]);
    expect(review.actions.transitions.find((t) => t.key === "submit")!.actionForm).not.toBeNull();
    await take(ali.caller, id, "submit", { answers: { cover_note: "Ready" } });
    for (const contractor of [hafiz, ali]) expect(offered(await detail(contractor.caller, id)), contractor.id).toEqual([]);
  });

  it("the Engineer: only Send to Manager, which Recommends one of Codes A to D and takes no checklist; the Manager nothing yet", async () => {
    const id = await submitted("Offered: Engineer");
    const { actions } = await detail(ahmed.caller, id);
    expect(actions.transitions.map((t) => t.key)).toEqual(["send_to_manager"]);
    const send = actions.transitions[0]!;
    expect(send.recommendCode?.map((c) => c.code)).toEqual(["A", "B", "C", "D"]);
    expect(send.checklists).toBeUndefined();
    expect(offered(await detail(mohammed.caller, id))).toEqual([]);
  });

  it("the Manager: Return to Engineer and the four codes, each taking the checklist, C proposed after a Fail; the Engineer's Recommended Code with them", async () => {
    const id = await submitted("Offered: Manager");
    expect((await answer(ahmed.caller, id, { supports: { answer: "pass" }, earthing: { answer: "fail" }, clearance: { answer: "na" } })).statusCode).toBe(204);
    await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
    const { actions } = await detail(mohammed.caller, id);
    expect(actions.recommendedCode?.code).toBe("C");
    const codes = actions.transitions.filter((t) => t.checklists !== undefined);
    expect(codes.map((t) => [t.key, t.proposed ?? false])).toEqual([
      ["approve_a", false],
      ["approve_b", false],
      ["revise_c", true],
      ["reject_d", false],
    ]);
    expect(actions.transitions.filter((t) => t.checklists === undefined).map((t) => t.key)).toEqual(["return_to_engineer"]);
    expect(offered(await detail(ahmed.caller, id))).toEqual([]);
  });

  it("after Code C: the raiser is offered a Revision and no Transition; the Consultant nothing", async () => {
    const id = await submitted("Offered: after the code");
    expect((await answer(ahmed.caller, id, { supports: { answer: "pass" }, earthing: { answer: "fail" }, clearance: { answer: "pass" } })).statusCode).toBe(204);
    await take(ahmed.caller, id, "send_to_manager", { recommendedCode: "C" });
    await take(mohammed.caller, id, "revise_c", { answers: { sample_checked: true, matches_specification: true, remarks: "Bond the trays" } });
    const raiser = await detail(hafiz.caller, id);
    expect(offered(raiser)).toEqual([]);
    expect(raiser.actions.createRevision).toBe(true);
    for (const consultant of [ahmed, mohammed]) {
      const read = await detail(consultant.caller, id);
      expect(offered(read), consultant.id).toEqual([]);
      expect(read.actions.createRevision, consultant.id).toBe(false);
    }
  });
});
