// Seam 1: the Documental Record's pages after page 1 (RP-650, spec RP-632; ADR 0017, ADR 0022,
// ADR 0023; form-engine.md §6, elements 10 to 14; visibility.md V7, the Documental Record row,
// scenarios RP-23-1 and RP-23-2). Every item is closed once, in beforeAll, and the record job runs
// once over all of them; the tests then read what each PDF prints, page by page, and the Record
// Data inside it, as a Member downloads it. Arabic is shaped on the page, so it is checked in the
// Record Data and Latin text on the pages.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb, type Db, type OutboxHandler } from "@rabaed/db";
import { addTestWorkflow, drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  pdfImages,
  projectFilesFromEnv,
  s3RecordFiles,
  verifySeal,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../src/demo/demo-signature.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
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

const TYPE = "RECSG";
const OWNER_TYPE = "RECSO";
const K1_NAME = "Signature Card Consultants";
const OWNER_NAME = "Signature Card Owner Authority";
const DISCLAIMER = {
  en: "This record was issued electronically through Rabaed. Its approval does not relieve the Contractor of its obligations.",
  ar: "صدر هذا السجل إلكترونيًا عبر رابد، ولا يعفي اعتماده المقاول من التزاماته.",
};
const INTERNAL_NOTE = "Internal note never on the record";
const RETURN_REASON = "Return reason never on the record";
const CANCEL_REASON = "The supplier withdrew the product";
const DRAFT_CANCEL_REASON = "Raised against the wrong Trade";
const RECOMMENDATION_REMARKS = "Recommendation remarks for the Owner only";
const CONFIRMED_COMMENT = "Fire-stop every penetration";
const REMARKS = ["Approved with the Comments listed.", "Fix the trays at 1.5 m centres.", "Earth every section.", "Seal the penetrations.", "Label both ends.", "Photograph the fixing.", "The seventh line is on the card only."];
const COMMENTS = [{ comment: "Fix the trays at 1.5 m centres", reference: "Spec 26 05 36" }, { comment: "Earth every tray section" }];
const SENT_BACK_REMARKS = "Code B remarks the Owner sent back";
const SENT_BACK_COMMENT = "A Comment of the Code the Owner sent back";

const schema = {
  sections: [
    { key: "material", title: bilingual("Material details"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
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
  pdf: { disclaimer: DISCLAIMER, show_review_duration: true },
};

/** A Rabaed Type on the test Workflow (Code B, Cancel, a Consultant engineer who Recommends a Code), whose Cancel and Returns ask a reason. */
async function addSignatureType(db: Db): Promise<void> {
  const { id: formId } = await db
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify({ en: "Signature cards (test)", ar: "بطاقات التوقيع (اختبار)" }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const workflowId = await addTestWorkflow((text) => sql.raw(text).execute(db), { withApproveB: true, withCancel: true, recommendCode: true, publish: false });
  const cancelForm = { sections: [{ key: "cancel", title: bilingual("Cancel"), fields: [{ key: "reason", type: "textarea", label: { en: "Reason", ar: "السبب" } }] }] };
  await sql`
    update workflow_transition tr set action_form = ${JSON.stringify(cancelForm)}::jsonb
    from workflow_version v
    where v.id = tr.workflow_version_id and v.workflow_definition_id = ${workflowId}::uuid and tr.kind in ('cancel', 'return')
  `.execute(db);
  const codeForm = { sections: [{ key: "code", title: bilingual("Code"), fields: [{ key: "remarks", type: "textarea", label: { en: "Remarks", ar: "الملاحظات" } }] }] };
  await sql`
    update workflow_transition tr set action_form = ${JSON.stringify(codeForm)}::jsonb
    from workflow_version v
    where v.id = tr.workflow_version_id and v.workflow_definition_id = ${workflowId}::uuid and tr.key in ('approve_a', 'revise_c')
  `.execute(db);
  await sql`update workflow_version set status = 'published', published_at = now() where workflow_definition_id = ${workflowId}::uuid`.execute(db);
  await db
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code: TYPE,
      name: JSON.stringify({ en: "Signature cards", ar: "بطاقات التوقيع" }),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  const published = await publishFormVersion(db, formId, schema);
  expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
}

/** A solid, opaque PNG of one colour: the PDF's image of it reads back as that colour. */
const solid = ([r, g, b]: readonly [number, number, number], width = 24, height = 8) => {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([r, g, b, 0xff], i * 4);
  return encodePng(width, height, pixels);
};
const INK = {
  omar: [200, 10, 10],
  sara: [10, 160, 20],
  saraLater: [10, 20, 200],
  faisal: [150, 60, 0],
  huda: [120, 0, 120],
  nora: [0, 120, 120],
  stampC1: [30, 30, 90],
  stampK1: [90, 30, 30],
  stampOwner: [30, 90, 30],
  logoK1: [210, 180, 20],
  stampC1Later: [70, 140, 210],
  logoK1Later: [20, 210, 180],
} as const satisfies Record<string, readonly [number, number, number]>;

const sign = (by: Caller, ink: readonly [number, number, number]) =>
  ok(by.request("PUT", "/v1/me/signature", { method: "uploaded", contentType: "image/png", data: solid(ink).toString("base64") }), 200);
const brand = (company: Company, kind: "stamp" | "logo", ink: readonly [number, number, number]) =>
  ok(company.caller.request("PUT", `/v1/companies/${company.company.companyId}/${kind}`, { contentType: "image/png", data: solid(ink, 32, 32).toString("base64") }), 200);

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

/** Text to compare: no spaces, and no direction marks or isolates (the header and footer carry them). */
const squeeze = (s: string) => s.replace(/[\s\u200E\u200F\u2066-\u2069]+/g, "");

interface Made {
  readonly id: string;
  readonly bytes: Uint8Array;
  /** Each page's text, spaces squeezed out. */
  readonly pages: string[];
  readonly text: string;
  readonly xml: string;
  /** The first pixel of each image the PDF holds, as "r,g,b". */
  readonly inks: Set<string>;
}

async function download(by: Caller, id: string): Promise<Made> {
  const link = (await ok(by.get(`/v1/work-items/${id}/documental-record`), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(squeeze(content.items.map((item) => ("str" in item ? item.str : "")).join("")));
  }
  // RECORD_PNG_DIR=<folder>: keep each page as a PNG, to look at (never set in CI; pdfjs draws with its optional canvas).
  if (process.env.RECORD_PNG_DIR) {
    const title = (await sql<{ title: string }>`select title from work_item where id = ${id}::uuid`.execute(migrator)).rows[0]!.title.replace(/\W+/g, "-");
    mkdirSync(process.env.RECORD_PNG_DIR, { recursive: true });
    writeFileSync(join(process.env.RECORD_PNG_DIR, `${title}.pdf`), bytes);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1.5 });
      const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(type: string): Buffer }; context: unknown } } }).canvasFactory;
      const target = factory.create(viewport.width, viewport.height);
      await page.render({ canvasContext: target.context as never, viewport, canvas: target.canvas as never }).promise;
      writeFileSync(join(process.env.RECORD_PNG_DIR, `${title}-page-${n}.png`), target.canvas.toBuffer("image/png"));
    }
  }
  await task.destroy();
  const xml = new TextDecoder().decode((await attachedFiles(bytes))[0]!.bytes);
  const inks = new Set((await pdfImages(bytes)).flatMap((i) => (i.firstPixel && i.firstPixel.length === 3 ? [i.firstPixel.join(",")] : [])));
  return { id, bytes, pages, text: pages.join(""), xml, inks };
}

const inkOf = (rgb: readonly number[]) => rgb.join(",");

let at: Tower;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Engineer: Caller;
let k1Pm: Caller;
let ownerPm: Caller;
let outsider: Caller;
let c1Name = "";
let handler: OutboxHandler;
const made: Record<"a" | "b" | "c" | "owner" | "cancelled" | "draftCancelled" | "ownerB", Made> = {} as never;

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

const draft = async (title: string, type = TYPE) =>
  (await ok(c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type, title, answers: { model: "CT-300", trade: at.electrical, location: at.buildingA } }), 201)).json()
    .id as string;

/** Sent for review, Returned once with a reason, sent again and Submitted with an Internal Note: at the Consultant's engineer. */
async function submitted(title: string, type = TYPE): Promise<string> {
  const id = await draft(title, type);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  if (type === TYPE) {
    await take(c1Pm, id, "return", { reason: RETURN_REASON });
    await take(c1Engineer, id, "send_for_review");
    await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  }
  await take(c1Pm, id, "submit", { internalNote: INTERNAL_NOTE });
  return id;
}

/** At the Consultant's manager: its engineer Recommended `recommended` with an Internal Note. */
async function atManager(title: string, recommended: "A" | "C"): Promise<string> {
  const id = await submitted(title);
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_to_manager", { recommendedCode: recommended, internalNote: "Recommend it" });
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

beforeAll(async () => {
  await addSignatureType(migrator);
  await addOwnerReviewType(migrator, OWNER_TYPE, schema);
  const c1 = await api.projectCreator();
  const k1 = await onboard(K1_NAME);
  at = await buildTower(api, { c1, k1 }, "SGC");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
    id: string;
    isOwnCompany: boolean;
    company: { legalName: { en: string } };
  }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Name = participants.find((p) => p.isOwnCompany)!.company.legalName.en;
  const owner = await onboard(OWNER_NAME);
  const ownerParticipant = await api.addParticipant(at.admin!, at.projectId, owner.company, "owner");
  await ok(at.admin!.request("PUT", `/v1/participants/${ownerParticipant}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  ownerPm = (await memberOnProject(api, owner, ownerParticipant, ["project_manager"], { name: "Nora Owner" })).caller;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller;
  k1Engineer = (await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" })).caller;
  k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" })).caller;
  outsider = (await onboard("Signature Card Outsiders")).caller;
  await Promise.all([sign(c1Engineer, INK.omar), sign(c1Pm, INK.sara), sign(k1Engineer, INK.faisal), sign(k1Pm, INK.huda), sign(ownerPm, INK.nora)]);
  await brand(c1, "stamp", INK.stampC1);
  await brand(k1, "stamp", INK.stampK1);
  await brand(k1, "logo", INK.logoK1);
  await brand(owner, "stamp", INK.stampOwner);
  handler = await recordHandler();
  await drainOutbox(worker, { documental_record: handler });

  // Code A: K1's engineer Recommended C (scenario RP-23-2); C1's PM changes her Signature after acting.
  const a = await atManager("Signature trays A", "C");
  await take(k1Pm, a, "approve_a", { remarks: "Approved as submitted." });
  await sign(c1Pm, INK.saraLater);
  // Code B with Comments, two days after it was Submitted.
  const b = await atManager("Signature trays B", "A");
  // Its Submission Date two days back, as the owner (the api's clock can't move: the file store refuses links signed ahead).
  await sql`update work_item set submitted_at = submitted_at - interval '2 days' where id = ${b}::uuid`.execute(migrator);
  await take(k1Pm, b, "approve_b", { answers: { remarks: REMARKS.join("\n"), items_to_create: COMMENTS } });
  // Code C.
  const c = await atManager("Signature trays C", "A");
  await take(k1Pm, c, "revise_c", { remarks: "Revise the tray sizes." });
  // The Owner's review: a Code B the Owner sent back, then a Code D the Owner confirmed.
  const o = await submitted("Signature trays owner", OWNER_TYPE);
  await ok(k1Pm.post(`/v1/work-items/${o}/pick-up`));
  await take(k1Pm, o, "recommend_b", { answers: { remarks: SENT_BACK_REMARKS, items_to_create: [{ comment: SENT_BACK_COMMENT }] } });
  await ok(ownerPm.post(`/v1/work-items/${o}/pick-up`));
  await take(ownerPm, o, "owner_send_back");
  await take(k1Pm, o, "recommend_d");
  await ok(ownerPm.post(`/v1/work-items/${o}/pick-up`));
  await take(ownerPm, o, "confirm_d");
  // Cancelled, from Internal Review, with a reason.
  const x = await draft("Signature trays cancelled");
  await take(c1Engineer, x, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${x}/pick-up`));
  await take(c1Pm, x, "cancel_review", { reason: CANCEL_REASON });
  // Cancelled straight from the Draft, with a reason.
  const dx = await draft("Signature trays cancelled in Draft");
  await take(c1Engineer, dx, "cancel", { reason: DRAFT_CANCEL_REASON });
  // The Owner's review: a Code B whose Recommendation carries Remarks, confirmed.
  const ob = await submitted("Signature trays owner B", OWNER_TYPE);
  await ok(k1Pm.post(`/v1/work-items/${ob}/pick-up`));
  await take(k1Pm, ob, "recommend_b", { answers: { remarks: RECOMMENDATION_REMARKS, items_to_create: [{ comment: CONFIRMED_COMMENT }] } });
  await ok(ownerPm.post(`/v1/work-items/${ob}/pick-up`));
  await take(ownerPm, ob, "confirm_b");

  // After every close, before the records are made: C1 replaces its Stamp and K1 its logo.
  await brand(c1, "stamp", INK.stampC1Later);
  await brand(k1, "logo", INK.logoK1Later);

  await drainOutbox(worker, { documental_record: handler });
  made.a = await download(c1Pm, a);
  made.b = await download(c1Pm, b);
  made.c = await download(c1Pm, c);
  made.owner = await download(c1Pm, o);
  made.cancelled = await download(c1Pm, x);
  made.draftCancelled = await download(c1Pm, dx);
  made.ownerB = await download(c1Pm, ob);
}, 180_000);

const cards = (m: Made) => /<cards>([\s\S]*?)<\/cards>/.exec(m.xml)![1]!.split("<card ").slice(1);
const en = (part: string, tag: string) => new RegExp(`<${tag} lang="en">([^<]+)</${tag}>`).exec(part)?.[1];
/** A card's Member, by their English name. */
const memberOf = (card: string) => /<member>[\s\S]*?<name lang="en">([^<]+)</.exec(card)![1];

describe("every page after the first", () => {
  it("runs a header: the Type, the Subject, the Document Number and Revision, the outcome", async () => {
    const number = (await detail(c1Pm, made.b.id)).documentNumber!;
    // In a bilingual (right-to-left) record the parts read from the right: pdfjs gives them back in visual order.
    const parts = [TYPE, "Signature trays B", number, "B"].map(squeeze);
    const header = (page: string) => page.includes(parts.join("·")) || page.includes([...parts].reverse().join("·"));
    expect(made.b.pages.length).toBeGreaterThanOrEqual(3);
    expect(header(made.b.pages[0]!)).toBe(false);
    for (const page of made.b.pages.slice(1)) expect(header(page), page.slice(0, 80)).toBe(true);
    // A Cancelled record's badge is its name; its Document Number is the one it got leaving the Draft.
    const cancelledNumber = (await detail(c1Pm, made.cancelled.id)).documentNumber!;
    expect(made.cancelled.pages.length).toBeGreaterThanOrEqual(2);
    const cancelledParts = [TYPE, "Signature trays cancelled", cancelledNumber].map(squeeze);
    for (const page of made.cancelled.pages.slice(1)) {
      expect(page.includes(cancelledParts.join("·")) || page.includes([...cancelledParts].reverse().join("·")), page.slice(0, 80)).toBe(true);
    }
    expect(made.cancelled.pages.slice(1).every((p) => p.includes("Cancelled"))).toBe(true);
  });
});

describe("the Review Comments", () => {
  it("are the issued Code's Comments, numbered, under their author's card, starting on the page page 1 names", async () => {
    const { xml, pages } = made.b;
    const page = Number(/<comments page="(\d+)">/.exec(xml)![1]);
    expect(page).toBeGreaterThan(1);
    // The second Comment's words are nowhere before (the Remarks on page 1 differ from them).
    expect(pages[page - 1]).toContain(squeeze(COMMENTS[1]!.comment));
    expect(pages.slice(0, page - 1).join("")).not.toContain(squeeze(COMMENTS[1]!.comment));
    const author = /<author at="[^"]+">([\s\S]*?)<\/author>/.exec(xml)![1]!;
    expect(author).toContain('<initials lang="en">HH</initials>');
    expect(author).toContain('<name lang="en">Huda Harbi</name>');
    expect(author).toContain(K1_NAME);
    expect(author).toMatch(/<comment n="1">[\s\S]*Fix the trays at 1\.5 m centres[\s\S]*<reference>Spec 26 05 36<\/reference>/);
    expect(author).toMatch(/<comment n="2">[\s\S]*Earth every tray section/);
    // (In this right-to-left record pdfjs gives "1." back as ".1", and a label after its value.)
    for (const value of ["ReviewComments", "HH", "HudaHarbi", "Manager", "Reference", "Spec260536", ".1Fixthetrays", ".2Earth"]) expect(pages[page - 1], value).toContain(value);
    // Page 1 names that page beside the count.
    // (pdfjs gives the right-to-left box in visual order: the number may come before its word.)
    expect(pages[0]!.includes(`·page${page}`) || pages[0]!.includes(`${page}page`)).toBe(true);
  });

  it("are none on a record whose Code raised none", () => {
    expect(made.a.xml).not.toContain("<comments");
  });
});

describe("the Signature cards", () => {
  it("are one per Transition on the path, numbered, with the verb, label, Member, Position, Company and time", () => {
    const b = cards(made.b);
    expect(b.map((c) => [en(c, "verb"), en(c, "label"), memberOf(c)])).toEqual([
      ["Prepared", "Prepared", "Omar Haddad"],
      ["Submitted", "Submit", "Sara Qahtani"],
      ["Reviewed", "Send to Manager", "Faisal Otaibi"],
      ["Approved", "Approve with Comments · B", "Huda Harbi"],
    ]);
    expect(b[3]).toContain(K1_NAME);
    expect(b[0]).toContain(c1Name);
    for (const value of ["Signatures", "Prepared", "Submitted", "Reviewed", "Approved", "OmarHaddad", "FaisalOtaibi", "Engineer"]) expect(made.b.text, value).toContain(value);
  });

  it("show each Member's Signature as the Transition recorded it, never one they saved afterwards", () => {
    for (const ink of [INK.omar, INK.sara, INK.faisal, INK.huda]) expect(made.a.inks, inkOf(ink)).toContain(inkOf(ink));
    expect(made.a.inks).not.toContain(inkOf(INK.saraLater));
    expect(cards(made.a).every((c) => c.includes("<signature/>"))).toBe(true);
  });

  it("print what was written in the shared Action Form: the full Remarks and Code B's Comments as a numbered list", () => {
    const issuer = cards(made.b)[3]!;
    expect(issuer).toContain(`<value lang="en">${REMARKS.join("\n")}</value>`);
    expect(issuer).toMatch(/<item n="1" lang="en">Fix the trays at 1\.5 m centres — Spec 26 05 36<\/item>/);
    expect(issuer).toMatch(/<item n="2" lang="en">Earth every tray section<\/item>/);
    const page = Number(/<replyFullText page="(\d+)"\/>/.exec(made.b.xml)![1]);
    // The full text starts on that page, in the issuing card's answers, and runs on from there.
    expect(made.b.pages[page - 1]).toContain(`Remarks${squeeze(REMARKS[0]!)}`);
    expect(made.b.pages.slice(page - 1).join("")).toContain(squeeze(REMARKS[6]!));
    expect(made.b.pages.slice(1, page - 1).join("")).not.toContain(squeeze(REMARKS[6]!));
    // Page 1's reply stops at its sixth line and points to the card (the reply box may run onto page 2).
    const replyBox = made.b.text.slice(made.b.text.indexOf(squeeze(REMARKS[0]!)), made.b.text.indexOf("Approvalflow"));
    expect(replyBox).not.toContain(squeeze(REMARKS[6]!));
    expect(replyBox.includes(`Fulltext:page${page}`) || replyBox.includes(`${page}Fulltext:page`), replyBox.slice(-120)).toBe(true);
  });

  it("scenario RP-23-2: the internal reviewer's card reads Reviewed with no Code; his Recommended C is nowhere in the pages or the Record Data", () => {
    const engineer = cards(made.a)[2]!;
    expect(en(engineer, "verb")).toBe("Reviewed");
    expect(en(engineer, "label")).toBe("Send to Manager");
    expect(engineer).not.toContain("<answer>");
    // C is printed only as one of the chips of the Final decision box, never issued. (The Verification
    // Code and its link are random letters and digits: left aside.)
    const withoutChips = made.a.xml.replace(/<chip code="[A-D]"( issued="true")?\/>/g, "").replace(/<verification [^>]*\/>/, "");
    expect(withoutChips).not.toMatch(/(^|[^A-Za-z])C([^A-Za-z]|$)/m);
    expect(made.a.xml).not.toMatch(/<chip code="C" issued/);
    expect(made.a.text).not.toMatch(/Recommend|·C(?![a-zA-Z0-9-])/);
  });

  it("scenario RP-23-2: leave out Returns, Internal Notes, Recommended Codes and the Draft's start, in the pages and the Record Data", async () => {
    for (const record of [made.a, made.b, made.c]) {
      for (const hidden of [RETURN_REASON, INTERNAL_NOTE, "Recommend it", "Return"]) {
        expect(record.xml, hidden).not.toContain(hidden);
        expect(record.text, hidden).not.toContain(squeeze(hidden));
      }
      expect(record.xml.toLowerCase()).not.toContain("recommend");
      const started = (await sql<{ at: string }>`select app.iso_utc(created_at) as at from work_item where id = ${record.id}::uuid`.execute(migrator)).rows[0]!.at;
      expect(record.xml).not.toContain(started);
    }
  });
});

describe("the Owner's review", () => {
  it("names the Consultant PM as the issuer and gives the Owner's confirmation its own card", () => {
    const owner = cards(made.owner);
    expect(owner.map((c) => [en(c, "verb"), memberOf(c)])).toEqual([
      ["Prepared", "Omar Haddad"],
      ["Submitted", "Sara Qahtani"],
      ["Reviewed", "Huda Harbi"],
      ["Confirmed", "Nora Owner"],
    ]);
    expect(/<issuedBy>([\s\S]*?)<\/issuedBy>/.exec(made.owner.xml)![1]).toContain("Huda Harbi");
    expect(owner[3]).toContain(OWNER_NAME);
    expect(made.owner.inks).toContain(inkOf(INK.nora));
  });

  it("scenario RP-23-2: never prints the Code the Owner sent back, with its Remarks, Comments or Recommendation", () => {
    for (const hidden of [SENT_BACK_REMARKS, SENT_BACK_COMMENT, "Recommend B", "Send Back"]) {
      expect(made.owner.xml, hidden).not.toContain(hidden);
      expect(made.owner.text, hidden).not.toContain(squeeze(hidden));
    }
    expect(made.owner.xml).not.toContain("<comments");
  });

  it("prints the Recommendation as the Code it issued, never as a Recommendation, on the card and in the approval flow", () => {
    const flowLabels = (m: Made) => /<transitions>([\s\S]*?)<\/transitions>/.exec(m.xml)![1]!.split("<transition ").slice(1).map((t) => en(t, "label"));
    expect(flowLabels(made.owner)).toEqual(["Prepared", "Submit", "Code D", "Confirm"]);
    expect(flowLabels(made.ownerB)).toEqual(["Prepared", "Submit", "Code B", "Confirm"]);
    expect(en(cards(made.owner)[2]!, "label")).toBe("Code D");
    expect(made.owner.xml).toContain('<label lang="ar">الرمز D</label>');
    for (const record of [made.owner, made.ownerB]) {
      expect(record.xml.toLowerCase(), "xml").not.toContain("recommend");
      expect(record.text.toLowerCase(), "pages").not.toContain("recommend");
    }
  });

  it("scenario RP-650-1: never prints the Remarks of the Recommendation it confirmed, on the card or as page 1's reply; its Comments still print", () => {
    expect(made.ownerB.xml).not.toContain(RECOMMENDATION_REMARKS);
    expect(made.ownerB.text).not.toContain(squeeze(RECOMMENDATION_REMARKS));
    // The Owner's Confirm asks no Remarks: no reply on page 1, so no pointer to its full text.
    expect(made.ownerB.xml).not.toContain("<reply>");
    expect(made.ownerB.xml).not.toContain("<replyFullText");
    expect(cards(made.ownerB)[2]).not.toContain("<answer>");
    expect(made.ownerB.xml).toMatch(/<comment n="1">[\s\S]*Fire-stop every penetration/);
    expect(made.ownerB.text).toContain(squeeze(CONFIRMED_COMMENT));
  });
});

describe("the endings", () => {
  it("Code C: Next step, Revision 1 by the raiser's Company", () => {
    expect(made.c.xml).toMatch(new RegExp(`<nextStep revision="1">[\\s\\S]*${c1Name}[\\s\\S]*</nextStep>`));
    expect(made.c.text).toContain(squeeze(`Revision 1, by ${c1Name}`));
    expect(made.c.text).toContain("Nextstep");
  });

  it("Code D: a new submittal replaces this one", () => {
    expect(made.owner.text).toContain("Anewsubmittalreplacesthisone");
  });

  it("A and B: no Next step", () => {
    for (const record of [made.a, made.b]) {
      expect(record.xml).not.toContain("<nextStep");
      expect(record.text).not.toContain("Nextstep");
    }
  });

  it("Cancelled: who cancelled it and the reason, with their card", () => {
    const cancelled = /<cancelled>([\s\S]*?)<\/cancelled>/.exec(made.cancelled.xml)![1]!;
    expect(cancelled).toContain("Sara Qahtani");
    expect(cancelled).toContain(`<reason>${CANCEL_REASON}</reason>`);
    for (const value of ["Cancelledby", "SaraQahtani", "Reason", squeeze(CANCEL_REASON)]) expect(made.cancelled.text, value).toContain(value);
    expect(cards(made.cancelled).map((c) => en(c, "verb"))).toEqual(["Prepared", "Cancelled"]);
    expect(made.cancelled.xml).not.toContain("<reviewDays>");
    expect(made.cancelled.xml).not.toContain("<issuedBy>");
  });

  it("Cancelled straight from the Draft: one Cancelled card with who and why, never Prepared", () => {
    expect(cards(made.draftCancelled).map((c) => [en(c, "verb"), memberOf(c)])).toEqual([["Cancelled", "Omar Haddad"]]);
    const cancelled = /<cancelled>([\s\S]*?)<\/cancelled>/.exec(made.draftCancelled.xml)![1]!;
    expect(cancelled).toContain("Omar Haddad");
    expect(cancelled).toContain(`<reason>${DRAFT_CANCEL_REASON}</reason>`);
    expect(made.draftCancelled.xml).not.toContain("Prepared");
    expect(made.draftCancelled.text).not.toContain("Prepared");
    for (const value of ["Cancelledby", "OmarHaddad", squeeze(DRAFT_CANCEL_REASON)]) expect(made.draftCancelled.text, value).toContain(value);
  });
});

describe("the Stamps", () => {
  it("scenario RP-23-1: C1, K1 and the Owner Representative read the same record, with both acting Companies' Stamps labelled by role", async () => {
    const stamps = /<stamps>([\s\S]*?)<\/stamps>/.exec(made.b.xml)![1]!;
    expect(stamps).toMatch(new RegExp(`${c1Name}[\\s\\S]*<role lang="en">Contractor</role>[\\s\\S]*<image/>`));
    expect(stamps).toMatch(new RegExp(`${K1_NAME}[\\s\\S]*<role lang="en">Consultant</role>[\\s\\S]*<image/>`));
    expect(stamps).not.toContain(OWNER_NAME);
    for (const ink of [INK.stampC1, INK.stampK1]) expect(made.b.inks).toContain(inkOf(ink));
    expect(made.b.inks).not.toContain(inkOf(INK.stampOwner));
    expect(made.b.text).toContain("Stamps");
    // The Owner acted on the Owner's review: its Stamp prints there.
    expect(made.owner.inks).toContain(inkOf(INK.stampOwner));
    for (const by of [k1Pm, ownerPm]) expect((await download(by, made.b.id)).xml).toBe(made.b.xml);
    await expectHidden(outsider.get(`/v1/work-items/${made.b.id}/documental-record`), "another Company");
  });

  it("put each Company's logo beside its name, and only its name when it has none", () => {
    expect(made.b.inks).toContain(inkOf(INK.logoK1));
    const strip = /<companies>([\s\S]*?)<\/companies>/.exec(made.b.xml)![1]!;
    expect(strip).toMatch(new RegExp(`${K1_NAME}[^]*?<logo/>`));
    expect(strip.split("<company>").filter((c) => c.includes("<logo/>"))).toHaveLength(1);
  });

  it("are those in force at the close: a Stamp or logo replaced afterwards never reaches a record made from that close", () => {
    for (const record of [made.a, made.b, made.c]) {
      expect(record.inks).toContain(inkOf(INK.stampC1));
      expect(record.inks).not.toContain(inkOf(INK.stampC1Later));
      expect(record.inks).toContain(inkOf(INK.logoK1));
      expect(record.inks).not.toContain(inkOf(INK.logoK1Later));
    }
  });
});

describe("the Disclaimer and the review duration", () => {
  it("end every record with the Form Version's Disclaimer, in both languages", () => {
    for (const record of [made.a, made.b, made.c, made.owner, made.cancelled]) {
      expect(record.xml).toContain(`<text lang="en">${DISCLAIMER.en}</text>`);
      expect(record.xml).toContain(`<text lang="ar">${DISCLAIMER.ar}</text>`);
      expect(record.pages.at(-1)).toContain(squeeze(DISCLAIMER.en));
    }
  });

  it("print the calendar days from the Submission Date to the reply, as information, never a deadline", () => {
    expect(made.b.xml).toContain("<reviewDays>2</reviewDays>");
    expect(made.b.pages[0]).toContain("Reviewduration(days)");
    expect(made.a.xml).toContain("<reviewDays>0</reviewDays>");
    for (const record of [made.a, made.b]) expect(record.text.toLowerCase()).not.toMatch(/overdue|deadline|duedate|sla/);
  });
});

describe("the record as a whole", () => {
  it("holds nothing the pages don't print, and is still sealed", async () => {
    const structural = new Set(["xmlns", "lang", "n", "layoutVersion", "language", "at", "selected", "issued", "mark", "hijri"]);
    for (const record of Object.values(made)) {
      const body = record.xml.replace(/^<\?xml[^>]*\?>/, "");
      const values = [
        ...[...body.matchAll(/>([^<>]+)</g)].map((m) => m[1]!),
        ...[...body.matchAll(/\s([A-Za-z0-9]+)="([^"]*)"/g)].filter((m) => !structural.has(m[1]!)).map((m) => m[2]!),
      ]
        .flatMap((v) => v.trim().replace(/&amp;/g, "&").split("\n"))
        .map((v) => v.trim())
        .filter((v) => v !== "" && !/[؀-ۿ\u200E\u200F]/.test(v));
      for (const value of values) expect(record.text, value).toContain(squeeze(value));
      expect((await verifySeal(record.bytes)).valid).toBe(true);
    }
  });
});
