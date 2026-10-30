// Seam 1: the Documental Record of a WIR prints its checklist as the code froze it (RP-982, INSP-13;
// spec RP-649; ADR 0023, ADR 0024 amended 2026-10-19, ADR 0025; form-engine.md §3.3 and §6;
// visibility.md V7, V19, scenario RP-982-1). The Consultant Engineer answers the copied checklist in
// the code Screens (RP-86); the Manager's code takes the answers into its shared event and freezes
// the photos. The record prints that checklist like any Form section: each item's text, answer,
// comment, "Raise a Snag" line and photos, with the summary; its Record Data holds the same, each
// photo with its fingerprint. Never what the Consultant kept to itself: no Recommended Code, no
// Internal Note, no answer or photo from before the code. One WIR is closed at Code C in beforeAll,
// the record job runs once, and the tests read what each Member downloads.
//
// The seam suites' global setup runs the migrations, then the demo seed, which publishes the
// Rabaed Defaults (the WIR Form Version 3 and Workflow Version 4).
import { createHash } from "node:crypto";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ChecklistTemplates, DocumentList, SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  reproduceHandler,
  s3RecordFiles,
  type RecordJobDeps,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAdmin } from "../../admin/test/support/harness.ts";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const admin = await createTestAdmin();
const recordFiles = s3RecordFiles(projectFilesFromEnv());
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await admin.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const FIELD = "inspection_checklist";
const VERIFIED = { sample_checked: true, matches_specification: true };
/** Three checks: formwork raises a Snag when it fails (the default), cover too, clean never does. */
const items = [
  { key: "formwork", text: bilingual("Formwork tight"), comment: "required_on_negative", photo: "required_on_negative" },
  { key: "cover", text: bilingual("Rebar cover"), photo: "optional" },
  { key: "clean", text: bilingual("Clean of debris"), answers: "yes_no_na", comment: "off", on_negative: "none" },
];
/** What the Engineer answered first: changed before the code, so never on the record. */
const FIRST = { formwork: { answer: "fail", comment: "Wedges loose before the pour" }, cover: { answer: "pass" }, clean: { answer: "yes" } };
/** What the code took: formwork and cover Fail (cover unticked), clean No. */
const FINAL = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "fail", comment: "Cover 15 mm", snag: false }, clean: { answer: "no" } };
const INTERNAL_NOTE = "Between us: the formwork crew was rushed";
const RETURN_REASON = "Look at the cover again";
const REMARKS = "Seal the formwork and raise the cover";

const photos = {
  formwork: jpegWithExif({ takenAt: "2026:10:03 09:10:00", offset: "+03:00" }),
  // Removed before the code: nobody else ever saw it.
  dropped: jpegWithExif({ takenAt: "2026:10:03 09:12:00", offset: "+03:00", latitude: 24.7, longitude: 46.6 }),
  cover: jpegWithExif({ takenAt: "2026:10:04 10:00:00", offset: "+03:00" }),
  // The Engineer's annotated copy of the formwork photo (RP-656, RP-981): the canvas's PNG.
  annotated: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0dUAAAAGElEQVR4nGP4z8DAwMDAxMDAwMDAgCQAAJUdAhm9SxCZAAAAAElFTkSuQmCC",
    "base64",
  ),
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const squeeze = (s: string) => s.replace(/\s+/g, "");

let projectId = "";
let hafiz: { id: string; caller: Caller }; // C1 Contractor Engineer: raises the WIR.
let ali: { id: string; caller: Caller }; // C1's Project Manager: Submits it.
let ahmed: { id: string; caller: Caller }; // K1 Consultant Engineer: answers the checklist.
let mohammed: { id: string; caller: Caller }; // K1 Manager: issues the code.
let faisal: { id: string; caller: Caller }; // O1, Owner Representative: oversight.
let yousef: { id: string; caller: Caller }; // C2, another Contractor of the same Trade.
let wir = "";

interface Made {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly xml: string;
}
let made: Made;

async function recordDeps(): Promise<RecordJobDeps> {
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  return {
    files: recordFiles,
    renderer,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
    // PDF/A validity is the record checks' own suites' (documental-record.test.ts, documental-record-appendix.test.ts).
    validator: { validate: async () => ({ compliant: true, problems: [] }) },
  };
}

const downloadLink = (by: Caller, id: string) => by.get(`/v1/work-items/${id}/documental-record`);

/** The record as `by` downloads it: its text without whitespace, and its Record Data. */
async function download(by: Caller, id: string): Promise<Made> {
  const link = (await ok(downloadLink(by, id), 200)).json() as SignedUrl;
  const bytes = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(squeeze(content.items.map((item) => ("str" in item ? item.str : "")).join("")));
  }
  await task.destroy();
  const attached = await attachedFiles(bytes);
  return { bytes, text: pages.join(""), xml: new TextDecoder().decode(attached[0]!.bytes) };
}

/** Uploads `body` as photo `fileName` of check item `item`, as Ahmed; returns the Document's id. */
const addPhoto = (item: string, body: Buffer, fileName: string) =>
  uploadDocument(ahmed.caller, wir, { fieldKey: FIELD, itemKey: item, reply: true, fileName, contentType: "image/jpeg", body } as Parameters<typeof uploadDocument>[2]);
const answer = (answers: object) => ok(ahmed.caller.request("PUT", `/v1/work-items/${wir}/reply-checklists/${FIELD}`, { answers }), 204);

/** The `<section>` of the Record Data's `<form>` titled `title` (English). */
const sectionOf = (xml: string, title: string) =>
  [...(/<form>([\s\S]*?)<\/form>/.exec(xml)?.[1] ?? "").matchAll(/<section>([\s\S]*?)<\/section>/g)].map((m) => m[1]!).find((s) => s.includes(`<title lang="en">${title}</title>`));

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "WRC" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const created = await post("checklist-templates", { name: bilingual("Slab pour"), tradeId: electrical, items });
  const list: ChecklistTemplates = (await ok(c1.caller.get(`/v1/projects/${projectId}/checklist-templates`), 200)).json();
  const template = list.templates.find((t) => t.id === created)!.versionId;
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
  hafiz = await memberOnProject(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await memberOnProject(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = await memberOnProject(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" });
  yousef = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
  const handler: OutboxHandler = documentalRecordHandler(await recordDeps());
  await drainOutbox(worker, { documental_record: handler });

  wir = (
    await ok(
      hafiz.caller.post(`/v1/projects/${projectId}/work-items`, {
        type: "WIR",
        title: "Level 2 slab pour",
        answers: { description: "Slab, Level 2", requested_for: "2026-11-02T05:30:00.000Z", trade: electrical, location: buildingA, checklist_template: template },
      }),
      201,
    )
  ).json().id as string;
  await take(hafiz.caller, wir, "send_for_review");
  await take(ali.caller, wir, "submit", { answers: { cover_note: "Ready on site from 09:00" } });

  // The Engineer's first answers and a photo he takes back, then the Recommended Code with an Internal Note.
  await answer(FIRST);
  const formworkPhoto = await addPhoto("formwork", photos.formwork, "formwork.jpg");
  const dropped = await addPhoto("cover", photos.dropped, "dropped.jpg");
  await ok(ahmed.caller.delete(`/v1/work-items/${wir}/documents/${dropped}`));
  await take(ahmed.caller, wir, "send_to_manager", { recommendedCode: "B", internalNote: INTERNAL_NOTE });
  // The Manager sends it back to him; he changes the answers and adds the cover's photo and an annotated copy.
  await take(mohammed.caller, wir, "return_to_engineer", { reason: RETURN_REASON });
  await answer(FINAL);
  await addPhoto("cover", photos.cover, "cover.jpg");
  await uploadDocument(ahmed.caller, wir, { annotatedFromId: formworkPhoto, fileName: "formwork-annotated.png", contentType: "image/png", body: photos.annotated } as Parameters<typeof uploadDocument>[2]);
  await take(ahmed.caller, wir, "send_to_manager", { recommendedCode: "C", internalNote: INTERNAL_NOTE });
  await take(mohammed.caller, wir, "revise_c", { answers: { ...VERIFIED, remarks: REMARKS } });

  await drainOutbox(worker, { documental_record: handler });
  made = await download(hafiz.caller, wir);
}, 600_000);

describe("RP-982: the record prints the checklist as the code froze it", () => {
  it("prints each item's text, answer, comment and Snag line, and the summary", () => {
    for (const words of ["Checklist", "Formworktight", "Rebarcover", "Cleanofdebris", "Gapatthejoint", "Cover15mm", "2Fail/1No"]) expect(made.text, words).toContain(words);
    // Formwork, ticked, raised a Snag with the code; cover was unticked; clean raises none.
    expect(made.text).toContain("ASnagisraisedwiththecode");
    expect(made.text).toContain("NoSnagisraised");
  });

  it("holds the same checklist in its Record Data, as a Form section", () => {
    const section = sectionOf(made.xml, "Checklist");
    expect(section, made.xml).toBeDefined();
    const checklist = /<checklist>([\s\S]*?)<\/checklist>/.exec(section!)![1]!;
    expect(checklist).toContain('<summary lang="en">2 Fail / 1 No</summary>');
    const itemsXml = [...checklist.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
    expect(itemsXml.map((i) => /<text lang="en">([^<]*)<\/text>/.exec(i)![1])).toEqual(["Formwork tight", "Rebar cover", "Clean of debris"]);
    expect(itemsXml.map((i) => /<answer lang="en">([^<]*)<\/answer>/.exec(i)![1])).toEqual(["Fail", "Fail", "No"]);
    expect(itemsXml.map((i) => /<comment>([^<]*)<\/comment>/.exec(i)?.[1] ?? null)).toEqual(["Gap at the joint", "Cover 15 mm", null]);
    expect(itemsXml.map((i) => /<snag lang="en">([^<]*)<\/snag>/.exec(i)?.[1] ?? null)).toEqual(["A Snag is raised with the code", "No Snag is raised", null]);
  });

  it("prints each photo the code froze under its item, its annotated copy beside it, each with its fingerprint", () => {
    const section = sectionOf(made.xml, "Checklist")!;
    const itemsXml = [...section.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
    const photosOf = (i: string) => [...i.matchAll(/<photo[^>]*sha256="([0-9a-f]{64})"[^>]*>([^<]*)<\/photo>/g)].map((m) => [m[2], m[1]]);
    expect(photosOf(itemsXml[0]!)).toEqual([
      ["formwork.jpg", sha256(photos.formwork)],
      ["formwork-annotated.png", sha256(photos.annotated)],
    ]);
    expect(photosOf(itemsXml[1]!)).toEqual([["cover.jpg", sha256(photos.cover)]]);
    for (const name of ["formwork.jpg", "formwork-annotated.png", "cover.jpg"]) expect(made.text, name).toContain(name);
  });

  it("names the Checklist Template the WIR copied", () => {
    expect(made.text).toContain("Slabpour");
  });
});

// Scenario RP-982-1 (visibility.md): the record carries only what the code shared with the
// Participants (V19). Seam 2: `packages/db/test/documental-record-checklist-rls.test.ts`.
describe("RP-982-1: never the Consultant's own work", () => {
  it("carries no Recommended Code, Internal Note, Return reason, answer or photo from before the code", () => {
    for (const hidden of [INTERNAL_NOTE, FIRST.formwork.comment, RETURN_REASON, "dropped.jpg"]) {
      expect(made.text, hidden).not.toContain(squeeze(hidden));
      expect(made.xml, hidden).not.toContain(hidden);
    }
    for (const record of [made.text, made.xml]) expect(record).not.toMatch(/Recommend/i);
    expect(made.xml).not.toContain(sha256(photos.dropped));
  });

  it("is the same record for C1, K1 and the Owner Representative", async () => {
    for (const reader of [ali, ahmed, mohammed, faisal]) expect(sha256((await download(reader.caller, wir)).bytes), reader.id).toBe(sha256(made.bytes));
  });

  it("is the plain 404 for C2, with the WIR and its photos", async () => {
    await expectHidden(downloadLink(yousef.caller, wir), "C2");
    await expectHidden(yousef.caller.get(`/v1/work-items/${wir}/documents`), "C2");
  });

  it("lists none of the checklist's photos with the shared Documents, and makes no appendix page of them", async () => {
    const shared = (await ok(hafiz.caller.get(`/v1/work-items/${wir}/documents`), 200)).json() as DocumentList;
    expect(shared.documents.map((d) => d.fileName).sort()).toEqual(["cover.jpg", "formwork-annotated.png", "formwork.jpg"]);
    expect(/<documents>([\s\S]*?)<\/documents>/.exec(made.xml)![1]).not.toMatch(/formwork|cover\.jpg/);
    expect(made.xml).not.toMatch(/<appendix>[\s\S]*formwork/);
  });
});

describe("Re-produce of the WIR's record", () => {
  it("gives the same facts, the checklist and its photos found again by their fingerprints", { timeout: 300_000 }, async () => {
    const engineer = await admin.signedInEngineer();
    expect((await engineer.browser.post(`/v1/work-items/${wir}/documental-record/reproduce`, { reason: "The PDF maker had a layout bug" })).statusCode).toBe(202);
    await drainOutbox(worker, { documental_record_reproduce: reproduceHandler(await recordDeps()) });
    const { rows } = await sql<{ run_kind: string; passed: boolean; problems: string[] }>`
      select c.run_kind, c.passed, c.problems from documental_record_check c join documental_record r on r.id = c.documental_record_id
      where r.work_item_id = ${wir}::uuid order by c.ran_at, c.id
    `.execute(migrator);
    expect(rows.at(-1)).toMatchObject({ run_kind: "reproduce", passed: true });
    const after = await download(hafiz.caller, wir);
    const facts = (xml: string) => xml.replace(/(<comments) page="\d+"/g, "$1").replace(/\n *<replyFullText page="\d+"\/>/g, "").replace(/<pages first="\d+" last="\d+"\/>/g, "<pages/>");
    expect(facts(after.xml)).toBe(facts(made.xml));
    expect(sectionOf(after.xml, "Checklist")).toBe(sectionOf(made.xml, "Checklist"));
  });
});
