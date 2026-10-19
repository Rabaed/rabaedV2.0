// Seam 1: page 1 of the Documental Record and the Form's content (RP-151, spec RP-632; ADR 0023;
// form-engine.md §6, elements 1 to 9; visibility.md V7 and the Documental Record row). The record job
// runs in-process, as documental-record.test.ts runs it; each test then reads what the PDF prints and
// the Record Data inside it, for record language bilingual, ar and en, and with Hijri dates on.
// Arabic text is shaped on the page (its glyphs are not the letters typed), so Arabic is checked in the
// Record Data and Latin text and digits on the pages.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { formatDate, formatHijriDate, type SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  projectFilesFromEnv,
  s3RecordFiles,
  verifySeal,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });
const renderer = chromiumRenderer();
afterAll(async () => {
  await renderer.close();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const TYPE = "RECPG";
const TYPE_NAME = { en: "Record page one", ar: "صفحة السجل الأولى" };
const K1_NAME = "Page One Consultants";
const OWNER_NAME = "Page One Owner Authority";
const INTERNAL_NOTE = "Internal note on page one";
const REMARKS = ["Approved as submitted.", "Install to drawing E-12.", "Keep the labels facing out.", "Test before covering.", "Report any change.", "Photograph the fixing.", "Seventh line never on page one.", "Eighth line never on page one."];

/** Every kind of field the Form places on the record, and the Classification box's own section. */
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material details"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "length", type: "number", unit: "m", decimals: 1, label: bilingual("Length") },
        { key: "certified", type: "yes_no", label: bilingual("Certified") },
        { key: "finish", type: "select", label: bilingual("Finish"), options: [{ value: "zinc", label: { en: "Zinc plated", ar: "مجلفن" } }] },
        { key: "delivery", type: "date", label: bilingual("Delivery date") },
        { key: "notes", type: "textarea", label: bilingual("Notes") },
        { key: "spec_sheets", type: "attachments", label: bilingual("Specification sheets") },
      ],
    },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
        { key: "hard_copy", type: "yes_no", label: bilingual("Hard copy sent") },
      ],
    },
    {
      key: "quantities",
      title: bilingual("Quantities"),
      fields: [
        {
          key: "lines",
          type: "table",
          label: bilingual("Bill of quantities"),
          columns: [
            { key: "item", type: "text", label: bilingual("Item") },
            { key: "count", type: "number", total: true, label: bilingual("Count") },
          ],
        },
      ],
    },
    {
      key: "checks",
      title: bilingual("Site checks"),
      fields: [
        {
          key: "site_checks",
          type: "checklist",
          label: bilingual("Installation checklist"),
          items: [
            { key: "fixed", text: bilingual("Tray fixed to the slab"), answers: "pass_fail_na", photo: "optional" },
            { key: "labelled", text: bilingual("Labels in place"), answers: "pass_fail_na" },
          ],
        },
        { key: "site_photos", type: "photos", label: bilingual("Site photos") },
      ],
    },
  ],
};

/** A Type on the Owner's review Workflow. */
const OWNER_TYPE = "RECOW";
let ownerPm: Caller;

let at: Tower;
let k1: Company;
let k1ParticipantId = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let projectName = "";
let c1Name = "";
let handler: OutboxHandler;

async function recordHandler(): Promise<OutboxHandler> {
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  return documentalRecordHandler({
    files: s3RecordFiles(projectFilesFromEnv()),
    renderer,
    signer: async () => signer,
    timestamps: async () => timestamps,
    fonts: async () => fallbackFonts(),
    webUrl: "https://rabaed.test",
  });
}

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

const squeeze = (s: string) => s.replace(/\s+/g, "");

/** Text as pdfjs gives it back to be compared: Arabic presentation forms folded to letters, no spaces or direction marks. */
const folded = (s: string) => s.normalize("NFKC").replace(/[\s\u200E\u200F\u061C\u2066-\u2069]/g, "");

/**
 * Whether the page prints `value`, as the Record Data holds it. pdfjs returns what Chromium drew in visual order:
 * an Arabic run comes back reversed, glyph by glyph (a lam-alef ligature is one glyph, so it stays "لا"), and an
 * Arabic-locale date "05/11/2026" as "2026/11/05". So an Arabic value is looked for as it reads reversed in
 * ligature units, and a digit-and-slash date reversed by number. Anything else is looked for as it is.
 */
function isPrinted(pageText: string, value: string): boolean {
  const page = folded(pageText);
  const plain = folded(value);
  if (page.includes(plain)) return true;
  const units = [...plain.matchAll(/ل[اأإآ]|[\s\S]/g)].map((m) => m[0]);
  if (page.includes(units.reverse().join(""))) return true;
  // pdfjs also orders glyphs whose boxes overlap (a reh against the jeem after it) by position, not by reading
  // order, so "برج" can come back as "رجب". The last resort is a run of the page with exactly the value's letters,
  // in any order: it can't tell a swapped pair from a wrong word, but it does need every letter, once, together.
  const count = (s: string) => [...s].sort().join("");
  const wanted = count(plain);
  for (let i = 0; i + plain.length <= page.length; i++) if (count(page.slice(i, i + plain.length)) === wanted) return true;
  return false;
}

interface Made {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  /** Page 1's text alone (RP-650: the issuing card later in the record prints the Remarks in full). */
  readonly firstPage: string;
  readonly pages: number;
  readonly xml: string;
}

/** The record as C1's PM downloads it (the worker has made it): its text, page count and the Record Data inside. */
async function fetchRecord(id: string): Promise<Made> {
  const link = (await ok(c1Pm.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  let text = "";
  let firstPage = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join("");
    if (n === 1) firstPage = pageText;
    text += pageText;
  }
  const pages = pdf.numPages;
  await task.destroy();
  // RECORD_PDF_DIR=<folder>: keep each record, to look at its pages (never set in CI).
  if (process.env.RECORD_PDF_DIR) {
    const { rows } = await sql<{ title: string }>`select title from work_item where id = ${id}::uuid`.execute(migrator);
    mkdirSync(process.env.RECORD_PDF_DIR, { recursive: true });
    writeFileSync(join(process.env.RECORD_PDF_DIR, `${rows[0]!.title.replace(/\W+/g, "-")}.pdf`), bytes);
  }
  const xml = new TextDecoder().decode((await attachedFiles(bytes))[0]!.bytes);
  return { id, bytes, text: squeeze(text), firstPage: squeeze(firstPage), pages, xml };
}

/** A hand-written PDF of `n` pages (a Document whose page count the record lists). */
function pdfOf(n: number): string {
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(" ");
  const pages = Array.from({ length: n }, (_, i) => `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n`).join("");
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n${pages}trailer\n<< /Root 1 0 R /Size ${3 + n} >>\n%%EOF\n`;
}

async function draftRecord(title: string, extra: Record<string, unknown> = {}, type = TYPE): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type,
      title,
      answers: {
        model: "CT-300",
        length: 3.5,
        certified: true,
        finish: "zinc",
        delivery: "2026-11-05",
        notes: "Delivered in two lots",
        hard_copy: true,
        lines: [
          { item: "Tray 300 mm", count: 40 },
          { item: "Bracket", count: 120 },
        ],
        site_checks: { fixed: { answer: "pass" }, labelled: { answer: "fail", comment: "Labels missing on level 2" } },
        trade: at.electrical,
        location: at.buildingA,
        ...extra,
      },
    }),
    201,
  );
  return res.json().id as string;
}

/** The Draft's Documents: a three-page and a one-page PDF, a JPEG taken at a known time, and one checklist photo. */
async function attachDocuments(id: string): Promise<void> {
  await uploadDocument(c1Engineer, id, { fieldKey: "spec_sheets", fileName: "spec-three-pages.pdf", contentType: "application/pdf", body: pdfOf(3) });
  await uploadDocument(c1Engineer, id, { fieldKey: "spec_sheets", fileName: "spec-one-page.pdf", contentType: "application/pdf", body: pdfOf(1) });
  await uploadDocument(c1Engineer, id, {
    fieldKey: "site_photos",
    fileName: "tray-level-1.jpg",
    contentType: "image/jpeg",
    body: jpegWithExif({ takenAt: "2026:10:03 14:22:05", offset: "+03:00" }),
  });
  await uploadDocument(c1Engineer, id, {
    fieldKey: "site_checks",
    itemKey: "fixed",
    fileName: "fixing-closeup.jpg",
    contentType: "image/jpeg",
    body: jpegWithExif({ takenAt: "2026:10:03 15:10:00", offset: "+03:00" }),
  });
}

/** C1 raises the item, its PM Returns it once and Submits it with an Internal Note; K1's PM issues `code`. */
async function closed(title: string, code: "approve_a" | "approve_b" | "revise_c", { documents = true }: { documents?: boolean } = {}): Promise<string> {
  const id = await draftRecord(title);
  if (documents) await attachDocuments(id);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit", { internalNote: INTERNAL_NOTE });
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, "send_to_manager");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  const comments = [{ comment: "Label the trays" }, { comment: "Seal the penetrations" }];
  await take(k1Pm, id, code, code === "approve_b" ? { answers: { remarks: REMARKS.join("\n"), items_to_create: comments } } : {});
  return id;
}

const setRecordSettings = (language: string, hijriDates: boolean) =>
  at.admin!.request("PUT", `/v1/projects/${at.projectId}/settings/record`, { language, hijriDates });

let recordB: Made;
/** The records the tests read, all made in beforeAll (see there), with the ids of the items a Revision revises. */
let shared: {
  ar: Made;
  en: Made;
  hijri: Made;
  hijriRevision: Made;
  hijriFirst: string;
  revision: Made;
  revisedFirst: string;
  codeC: Made;
  rejected: Made;
  sentBack: Made;
};

/** The Revision of `first` (closed at Code C), taken to Code A: its id. */
async function reviseAfterC(first: string): Promise<string> {
  const created = await ok(c1Engineer.post(`/v1/work-items/${first}/revisions`, { idempotencyKey: crypto.randomUUID() }), 201);
  const revision = created.json().id as string;
  await take(c1Engineer, revision, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${revision}/pick-up`));
  await take(c1Pm, revision, "submit");
  await ok(k1Pm.post(`/v1/work-items/${revision}/pick-up`));
  await take(k1Pm, revision, "send_to_manager");
  await ok(k1Pm.post(`/v1/work-items/${revision}/pick-up`));
  await take(k1Pm, revision, "approve_a");
  return revision;
}

/** A Submitted item held by K1's PM at the Consultant PM's Step. */
async function atConsultantPm(type: string, title: string): Promise<string> {
  const id = await draftRecord(title, {}, type);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}
const ownerTakes = async (id: string, transition: string) => {
  await ok(ownerPm.post(`/v1/work-items/${id}/pick-up`));
  await take(ownerPm, id, transition);
};
const REMARKS_B = "Secret Code B remarks sent back by the Owner";
const sentBackComments = { items_to_create: [{ comment: "Seal the penetrations after the Owner's return" }] };

/** A Code D item the Owner confirmed. */
async function rejectedByOwner(): Promise<string> {
  const id = await atConsultantPm(OWNER_TYPE, "Rejected trays");
  await take(k1Pm, id, "recommend_d");
  await ownerTakes(id, "confirm_d");
  return id;
}

/** An item whose Code B the Owner sent back, then Code D confirmed. */
async function sentBackByOwner(): Promise<string> {
  const id = await atConsultantPm(OWNER_TYPE, "Sent back trays");
  await take(k1Pm, id, "recommend_b", { answers: { remarks: REMARKS_B, ...sentBackComments } });
  await ownerTakes(id, "owner_send_back");
  await take(k1Pm, id, "recommend_d");
  await ownerTakes(id, "confirm_d");
  return id;
}

beforeAll(async () => {
  // The steps that don't wait on each other run together (the password hashing of each Member is slow when the machine is busy).
  const [c1, onboardedK1, owner] = await Promise.all([
    api.projectCreator(),
    onboard(K1_NAME),
    onboard(OWNER_NAME),
    addSendBackType(migrator, TYPE, TYPE_NAME, schema, { withApproveB: true }),
    addOwnerReviewType(migrator, OWNER_TYPE, schema),
  ]);
  k1 = onboardedK1;
  at = await buildTower(api, { c1, k1 }, "PGO");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
    id: string;
    isOwnCompany: boolean;
    company: { legalName: { en: string } };
  }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Name = participants.find((p) => p.isOwnCompany)!.company.legalName.en;
  const [ownerMember, c1EngineerMember, c1PmMember, k1PmMember] = await Promise.all([
    api
      .addParticipant(at.admin!, at.projectId, owner.company, "owner")
      .then(async (ownerParticipant) => {
        await ok(at.admin!.request("PUT", `/v1/participants/${ownerParticipant}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
        return memberOnProject(api, owner, ownerParticipant, ["project_manager"], { name: "Nora Owner" });
      }),
    memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" }),
    memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" }),
    memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" }),
  ]);
  ownerPm = ownerMember.caller;
  c1Engineer = c1EngineerMember.caller;
  c1Pm = c1PmMember.caller;
  k1Pm = k1PmMember.caller;
  projectName = ((await sql<{ name: { en: string } }>`select name from project where id = ${at.projectId}::uuid`.execute(migrator)).rows[0]!.name).en;
  handler = await recordHandler();
  await drainOutbox(worker, { documental_record: handler });

  // Every record the tests read is made here, so a loaded machine pays for the setup once and the tests only read. The worker
  // makes a record with the Project's settings as they stand when it runs, so the items are closed together per setting and the
  // worker runs once for each: bilingual (the default), Arabic only, English only, then Hijri dates on.
  const [b, codeC, rejected, sentBack, revisedFirst, hijriFirst] = await Promise.all([
    closed("Cable trays for Level 1", "approve_b"),
    closed("Code C trays", "revise_c", { documents: false }),
    rejectedByOwner(),
    sentBackByOwner(),
    closed("Revised trays", "revise_c", { documents: false }),
    closed("Hijri revised trays", "revise_c", { documents: false }),
  ]);
  const revision = await reviseAfterC(revisedFirst);
  await drainOutbox(worker, { documental_record: handler });
  await ok(setRecordSettings("ar", false));
  const ar = await closed("Arabic only trays", "approve_a", { documents: false });
  await drainOutbox(worker, { documental_record: handler });
  await ok(setRecordSettings("en", false));
  const en = await closed("English only trays", "approve_a", { documents: false });
  await drainOutbox(worker, { documental_record: handler });
  await ok(setRecordSettings("bilingual", true));
  const [hijri, hijriRevision] = await Promise.all([closed("Hijri trays", "approve_a", { documents: false }), reviseAfterC(hijriFirst)]);
  await drainOutbox(worker, { documental_record: handler });
  await ok(setRecordSettings("bilingual", false));

  const made = await Promise.all([b, codeC, rejected, sentBack, revision, ar, en, hijri, hijriRevision].map(fetchRecord));
  recordB = made[0]!;
  shared = {
    codeC: made[1]!,
    rejected: made[2]!,
    sentBack: made[3]!,
    revision: made[4]!,
    revisedFirst,
    ar: made[5]!,
    en: made[6]!,
    hijri: made[7]!,
    hijriRevision: made[8]!,
    hijriFirst,
  };
}, 180_000);

describe("page 1 of a Code B record with Comments, in both languages", () => {
  it("opens with the Owner and every Company whose Member acted, by name", () => {
    for (const name of [c1Name, K1_NAME, OWNER_NAME]) expect(recordB.text, name).toContain(squeeze(name));
    // The Companies strip holds the Owner (who never acted) and the two who did.
    const strip = /<companies>([\s\S]*?)<\/companies>/.exec(recordB.xml)![1]!;
    for (const name of [c1Name, K1_NAME, OWNER_NAME]) expect(strip, name).toContain(name);
  });

  it("has a title block with the Type's code and names, the Subject and the Document Number", async () => {
    const number = (await detail(c1Pm, recordB.id)).documentNumber!;
    for (const value of [TYPE, TYPE_NAME.en, "Cable trays for Level 1", number]) expect(recordB.text, value).toContain(squeeze(value));
    expect(recordB.xml).toContain(`<name lang="ar">${TYPE_NAME.ar}</name>`);
    expect(recordB.xml).toContain(`<type code="${TYPE}">`);
    // An original has no Revision line.
    expect(recordB.text).not.toContain("Revisionof");
    expect(recordB.xml).not.toContain("<revisionOf");
  });

  it("has a Parties box: the Project, then the Companies by role", () => {
    const parties = /<parties>([\s\S]*?)<\/parties>/.exec(recordB.xml)![1]!;
    for (const name of [c1Name, K1_NAME, OWNER_NAME]) expect(parties, name).toContain(name);
    expect(recordB.text).toContain(squeeze(projectName));
    // In role order: the Owner, the Consultant, the Contractor.
    const order = [OWNER_NAME, K1_NAME, c1Name].map((n) => parties.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const role of ["Consultant", "Contractor"]) expect(recordB.text, role).toContain(role);
  });

  it("has a Classification box: the item's Trade among the Project's, its Location, then the Form's own fields", () => {
    expect(recordB.text).toContain("Classification");
    const trades = /<trades>([\s\S]*?)<\/trades>/.exec(recordB.xml)![1]!;
    expect(trades).toMatch(/<trade selected="true" lang="en">Electrical<\/trade>/);
    expect(trades).toMatch(/<trade lang="en">Mechanical<\/trade>/);
    expect(trades).not.toMatch(/<trade selected="true" lang="en">Mechanical/);
    for (const value of ["Electrical", "Mechanical", "BuildingA", "Hardcopysent"]) expect(recordB.text, value).toContain(value);
    // The Form's own field in the Classification section is in the box, not repeated in the body.
    const classification = /<classification>([\s\S]*?)<\/classification>/.exec(recordB.xml)![1]!;
    expect(classification).toContain("Hard copy sent");
    expect(/<form>([\s\S]*?)<\/form>/.exec(recordB.xml)![1]).not.toContain("Hard copy sent");
  });

  it("has a Final decision box: the outcome large, its chips, who issued it, the dates and the Review Comments", async () => {
    const dates = (
      await sql<{ submitted: Date; closed: Date }>`select submitted_at as submitted, closed_at as closed from work_item where id = ${recordB.id}::uuid`.execute(migrator)
    ).rows[0]!;
    expect(recordB.xml).toMatch(/<outcome code="B" at="[^"]+">/);
    expect(recordB.text).toContain("ABCD");
    expect(recordB.xml).toMatch(/<chip code="B" issued="true"\/>/);
    expect(recordB.xml).not.toMatch(/<chip code="A" issued/);
    const issuedBy = /<issuedBy>([\s\S]*?)<\/issuedBy>/.exec(recordB.xml)![1]!;
    expect(issuedBy).toContain("Huda Harbi");
    expect(issuedBy).toContain(K1_NAME);
    for (const value of ["Issuedby", "HudaHarbi", "Manager", "SubmissionDate", "Replydate", "ReviewComments"]) expect(recordB.text, value).toContain(value);
    for (const day of [dates.submitted, dates.closed]) expect(recordB.text).toContain(squeeze(formatDate(day, "en", { dateStyle: "medium" })));
    expect(recordB.xml).toMatch(/<reviewComments>2<\/reviewComments>/);
  });

  it("prints each date of the Final decision box once, beside its label: one Gregorian date, no second language's copy", async () => {
    const dates = (
      await sql<{ submitted: Date; closed: Date }>`select submitted_at as submitted, closed_at as closed from work_item where id = ${recordB.id}::uuid`.execute(migrator)
    ).rows[0]!;
    const box = recordB.text.slice(recordB.text.indexOf("SubmissionDate"), recordB.text.indexOf("ReviewComments"));
    for (const day of [dates.submitted, dates.closed]) expect(box).toContain(squeeze(formatDate(day, "en", { dateStyle: "medium" })));
    expect(box.match(/[A-Z][a-z]{2}\d{1,2},\d{4}/g)).toHaveLength(2);
    expect(box).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
    expect(box).not.toContain("AH");
  });

  it("shows the QR beside the Verification Code", async () => {
    const code = /<verification code="([^"]+)"/.exec(recordB.xml)![1]!;
    expect(recordB.text).toContain(code);
    // The QR is an image of the verification link; the link is printed small beside it.
    const link = /<verification code="[^"]+" link="([^"]+)"/.exec(recordB.xml)![1]!;
    expect(link).toMatch(/^https:\/\/rabaed\.test\/verify\/[A-Za-z0-9_-]{43}$/);
    expect(recordB.text).toContain(link);
  });

  it("shows the first lines of the issued Code's Remarks", () => {
    for (const line of REMARKS.slice(0, 6)) expect(recordB.firstPage, line).toContain(squeeze(line));
    // Page 1's excerpt stops at six lines; the issuing card prints the rest further on (RP-650).
    for (const line of REMARKS.slice(6)) expect(recordB.firstPage, line).not.toContain(squeeze(line));
    expect(recordB.xml).toContain("<reply>");
  });

  it("has an approval flow: each Transition on the path with its label, the Member, their Company's role, the time and a mark", () => {
    const flow = /<transitions>([\s\S]*?)<\/transitions>/.exec(recordB.xml)![1]!;
    const entries = flow.split("<transition ").slice(1);
    // Prepared (the send out of the Draft), Submit, Send to Manager, Code B.
    expect(entries).toHaveLength(4);
    expect(entries[0]).toContain('<label lang="en">Prepared</label>');
    expect(entries.map((e) => /<label lang="en">([^<]+)<\/label>/.exec(e)![1])).toEqual(["Prepared", "Submit", "Send to Manager", "Approve with Comments · B"]);
    expect(entries.every((e) => /mark="done"/.test(e))).toBe(true);
    const names = entries.map((e) => /<member>[\s\S]*?<name lang="en">([^<]+)</.exec(e)![1]);
    expect(names).toEqual(["Omar Haddad", "Sara Qahtani", "Huda Harbi", "Huda Harbi"]);
    expect(entries[0]).toMatch(/<\/company>[\s\S]*<role lang="en">Contractor<\/role>/);
    expect(entries[3]).toMatch(/<role lang="en">Consultant<\/role>/);
    for (const label of ["Prepared", "Submit", "SendtoManager", "Approvalflow"]) expect(recordB.text, label).toContain(label);
  });

  it("dates Prepared at the raiser's first Transition on the path, never when the Draft was started", async () => {
    const { rows } = await sql<{ at: string }>`
      select app.iso_utc(e.created_at) as at
      from work_item_event e join workflow_transition tr on tr.id = e.transition_id
      where e.work_item_id = ${recordB.id}::uuid and tr.key = 'send_for_review' order by e.seq
    `.execute(migrator);
    expect(rows).toHaveLength(1);
    expect(/<transition n="1" at="([^"]+)"/.exec(recordB.xml)![1]).toBe(rows[0]!.at);
    const draftStarted = (await sql<{ at: string }>`select app.iso_utc(created_at) as at from work_item where id = ${recordB.id}::uuid`.execute(migrator)).rows[0]!.at;
    expect(recordB.xml).not.toContain(draftStarted);
  });

  it("prints the Form's sections in order: fields as label and value, tables with totals, checklists with their summary, photos with when they were taken", () => {
    for (const value of [
      "Materialdetails",
      "Model",
      "CT-300",
      "Length",
      "3.5m",
      "Certified",
      "Yes",
      "Zincplated",
      "Deliverydate",
      "Nov5,2026",
      "Deliveredintwolots",
    ]) {
      expect(recordB.text, value).toContain(value);
    }
    // Tables: the rows and the column's total.
    for (const value of ["Billofquantities", "Tray300mm", "Bracket", "40", "120", "160"]) expect(recordB.text, value).toContain(value);
    expect(recordB.xml).toMatch(/<totals>[\s\S]*160/);
    // Checklists: the summary, each item's answer and comment.
    for (const value of ["Installationchecklist", "1Pass/1Fail", "Trayfixedtotheslab", "Labelsmissingonlevel2"]) expect(recordB.text, value).toContain(value);
    // Photos: the file and when it was taken (Riyadh time).
    for (const value of ["Sitephotos", "tray-level-1.jpg", "fixing-closeup.jpg", "Oct3,2026,2:22", "Oct3,2026,3:10"]) expect(recordB.text, value).toContain(value);
    // In Form Version order.
    const order = ["Materialdetails", "Quantities", "Sitechecks"].map((s) => recordB.text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("lists the shared Documents with their page counts", () => {
    const documents = /<documents>([\s\S]*?)<\/documents>/.exec(recordB.xml)![1]!;
    expect(documents).toContain('<document pages="3">spec-three-pages.pdf</document>');
    expect(documents).toContain('<document pages="1">spec-one-page.pdf</document>');
    // The photos are in the Form's grid, not in this list.
    expect(documents).not.toContain("tray-level-1.jpg");
    expect(recordB.text).toContain("spec-three-pages.pdf");
  });

  it("has one footer line on every page: Issued electronically through Rabaed, the Verification Code, page X of Y, the code once", () => {
    const code = /<verification code="([^"]+)"/.exec(recordB.xml)![1]!;
    expect(recordB.pages).toBeGreaterThanOrEqual(2);
    for (let n = 1; n <= recordB.pages; n++) expect(recordB.text, `page ${n}`).toContain(`page${n}of${recordB.pages}`);
    const footer = `IssuedelectronicallythroughRabaed·${code}·page`;
    expect(recordB.text.split(footer).length - 1).toBe(recordB.pages);
    // The Arabic pair of it sits beside it, with no second code: the code is on each page's footer once, and on page 1's box.
    expect(recordB.text.split(code).length - 1).toBe(recordB.pages + 1);
  });

  it("holds nothing the pages don't print: no Return, Internal Note or reason", () => {
    for (const hidden of [INTERNAL_NOTE, "recommend"]) {
      expect(recordB.xml.toLowerCase()).not.toContain(hidden.toLowerCase());
      expect(recordB.text.toLowerCase()).not.toContain(squeeze(hidden).toLowerCase());
    }
    // The Record Data: every value is printed, Arabic and Arabic-locale dates included (isPrinted).
    const structural = new Set(["xmlns", "lang", "n", "layoutVersion", "language", "at", "selected", "issued", "mark", "hijri"]);
    const body = recordB.xml.replace(/^<\?xml[^>]*\?>/, "");
    const values = [
      ...[...body.matchAll(/>([^<>]+)</g)].map((m) => m[1]!),
      ...[...body.matchAll(/\s([A-Za-z0-9]+)="([^"]*)"/g)].filter((m) => !structural.has(m[1]!)).map((m) => m[2]!),
    ]
      .flatMap((v) => v.trim().replace(/&amp;/g, "&").split("\n"))
      .map((v) => v.trim())
      .filter((v) => v !== "");
    expect(values.length).toBeGreaterThan(40);
    expect(values.filter((v) => /[\u0600-\u06FF]/.test(v)).length).toBeGreaterThan(20);
    for (const value of values) expect(isPrinted(recordB.text, value), value).toBe(true);
  });

  it("is still a sealed PDF with the Record Data inside", async () => {
    expect((await verifySeal(recordB.bytes)).valid).toBe(true);
    expect(createHash("sha256").update(recordB.bytes).digest("hex")).toHaveLength(64);
  });
});

describe("the Project's record language and Hijri dates", () => {
  it("are set by a Project Admin and read by everyone on the Project; anyone else gets the plain 404", async () => {
    const summary = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}`), 200)).json();
    expect(await summary(c1Pm)).toMatchObject({ recordLanguage: "bilingual", recordHijriDates: false });
    await ok(setRecordSettings("ar", true));
    expect(await summary(c1Pm)).toMatchObject({ recordLanguage: "ar", recordHijriDates: true });
    await ok(setRecordSettings("bilingual", false));
    await expectHidden(c1Pm.request("PUT", `/v1/projects/${at.projectId}/settings/record`, { language: "en", hijriDates: false }), "a Member who is no Project Admin");
    await expectHidden(k1Pm.request("PUT", `/v1/projects/${at.projectId}/settings/record`, { language: "en", hijriDates: false }), "another Company's Member");
    expect(await summary(c1Pm)).toMatchObject({ recordLanguage: "bilingual" });
    const refused = await setRecordSettings("fr", false);
    expect(refused.statusCode).toBe(400);
  });

  it("print an Arabic-only record when the Project says so: no English at all, in the pages or the Record Data", () => {
    const record = shared.ar;
    expect(record.xml).toContain('language="ar"');
    expect(record.xml).not.toContain('lang="en"');
    expect(record.xml).toContain(`<name lang="ar">${TYPE_NAME.ar}</name>`);
    expect(record.text).not.toContain("Finaldecision");
    expect(record.text).not.toContain("Approvalflow");
    expect(record.text).not.toContain(squeeze(TYPE_NAME.en));
    // The Subject and codes are typed values, kept as typed; the footer is Arabic too.
    expect(record.text).toContain("Arabiconlytrays");
    expect(record.text).not.toContain("Issuedelectronically");
  });

  it("print an English-only record when the Project says so: no Arabic letters on any page", () => {
    const record = shared.en;
    expect(record.xml).toContain('language="en"');
    expect(record.xml).not.toContain('lang="ar"');
    expect(record.text).not.toMatch(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/);
    for (const value of ["Finaldecision", "Approvalflow", "IssuedelectronicallythroughRabaed", squeeze(TYPE_NAME.en)]) expect(record.text, value).toContain(value);
  });

  it("put the Hijri date beside every Gregorian one when turned on, and only for records made afterwards", async () => {
    const record = shared.hijri;
    const closedAt = (await sql<{ closed: Date }>`select closed_at as closed from work_item where id = ${record.id}::uuid`.execute(migrator)).rows[0]!.closed;
    expect(record.xml).toContain('hijri="true"');
    expect(record.text).toContain(squeeze(formatHijriDate(closedAt, "en")));
    // The record made before the setting keeps what it was made with.
    expect(recordB.xml).toContain('hijri="false"');
    expect(recordB.text).not.toMatch(/14ddAH/);
  });
});

describe("a Revision and the other outcomes", () => {
  it("puts the Hijri date in the Revision line when the Project has them on", async () => {
    const record = shared.hijriRevision;
    const firstClosed = (await sql<{ closed: Date }>`select closed_at as closed from work_item where id = ${shared.hijriFirst}::uuid`.execute(migrator)).rows[0]!.closed;
    const line = record.text.slice(record.text.indexOf("closedatCodeC"), record.text.indexOf("closedatCodeC") + 140);
    expect(line).toContain(squeeze(formatDate(firstClosed, "en")));
    expect(line).toContain(squeeze(formatHijriDate(firstClosed, "en")));
  });

  it("says which item a Revision revises and when that one closed at Code C", async () => {
    const first = shared.revisedFirst;
    const record = shared.revision;
    const firstNumber = (await detail(c1Pm, first)).documentNumber!;
    const firstClosed = (await sql<{ closed: Date }>`select closed_at as closed from work_item where id = ${first}::uuid`.execute(migrator)).rows[0]!.closed;
    expect(record.text).toContain(squeeze(`${firstNumber}Rev1`));
    expect(record.text).toContain("closedatCodeC");
    expect(record.text).toContain(squeeze(formatDate(firstClosed, "en")));
    expect(record.xml).toMatch(new RegExp(`<revisionOf outcome="C" at="[^"]+">${firstNumber}</revisionOf>`));
  });

  it("marks a Code C record's last step as returned for revision", () => {
    const record = shared.codeC;
    const entries = record.xml.split("<transition ").slice(1);
    expect(entries.map((e) => /mark="([a-z]+)"/.exec(e)![1])).toEqual(["done", "done", "done", "revise"]);
    expect(record.xml).toMatch(/<outcome code="C" at="[^"]+">/);
    expect(record.xml).toMatch(/<chip code="C" issued="true"\/>/);
  });
});

describe("the Owner's review: Code D, and a Code the Owner sent back", () => {
  it("marks a Code D record's last step as rejected, with the Consultant PM who recommended it and the Owner who confirmed it", () => {
    const record = shared.rejected;
    const entries = record.xml.split("<transition ").slice(1);
    expect(entries.map((e) => /<label lang="en">([^<]+)<\/label>/.exec(e)![1])).toEqual(["Prepared", "Submit", "Code D", "Confirm"]);
    expect(entries.map((e) => /mark="([a-z]+)"/.exec(e)![1])).toEqual(["done", "done", "done", "rejected"]);
    expect(record.xml).toMatch(/<outcome code="D" at="[^"]+">/);
    expect(record.xml).toMatch(/<chip code="D" issued="true"\/>/);
    expect(/<issuedBy>([\s\S]*?)<\/issuedBy>/.exec(record.xml)![1]).toContain("Huda Harbi");
    expect(/<confirmedBy>([\s\S]*?)<\/confirmedBy>/.exec(record.xml)![1]).toContain("Nora Owner");
    for (const value of ["Confirmedby", "Rejected"]) expect(record.text, value).toContain(value);
  });

  it("never prints a Code the Owner sent back: not its Remarks, its Comments or its Recommendation", () => {
    const record = shared.sentBack;
    for (const hidden of [REMARKS_B, "Seal the penetrations after the Owner's return", "Recommend B", "Send Back"]) {
      expect(record.xml, hidden).not.toContain(hidden);
      expect(record.text, hidden).not.toContain(squeeze(hidden));
    }
    expect(record.xml).not.toMatch(/<chip code="B" issued/);
    expect(record.xml.split("<transition ").slice(1)).toHaveLength(4);
  });

});
