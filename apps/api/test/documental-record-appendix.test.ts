// Seam 1: the Documental Record's appendix (RP-147, spec RP-632; ADR 0023; form-engine.md §6,
// element 15; visibility.md V7, V19, the Documental Record row and rule 9.2). After the Disclaimer
// the record lists every shared Document of the appendix with its name and fingerprint (RP-618),
// then gives each shared PDF's pages and each image a page of their own, in Form order; other files
// travel inside the PDF/A-3, and past the size limit they are only listed, as held in Rabaed. Only
// the Documents the other Participants saw are in it: never one removed in the Draft, never one the
// raiser added while it held the item at the close. Every item is closed once, in beforeAll, the
// record job runs once (with a small size limit, so the cut-off is tested without 100 MB files),
// and the tests then read what each Member downloads.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  localSealSigner,
  localTimestampAuthority,
  pdfA3Problems,
  pdfImages,
  projectFilesFromEnv,
  s3RecordFiles,
  verifySeal,
  type AttachedFile,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../src/demo/demo-signature.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

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

const TYPE = "RECAX";
const K1_NAME = "Appendix Consultants";
/** The record job's size limit here: what the appendix carries in all, as 100 MB is in production. */
const LIMIT_BYTES = 24_000;

const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "drawings", type: "attachments", label: bilingual("Drawings") },
      ],
    },
    { key: "site", title: bilingual("Site"), fields: [{ key: "site_photos", type: "photos", label: bilingual("Site photos") }] },
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

/** A hand-written PDF of one page per colour (r g b, 0 to 1), each a filled block and a frame: no fonts, so it can be pages of a PDF/A. */
function drawnPdf(colours: readonly (readonly [number, number, number])[]): Buffer {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (const [r, g, b] of colours) {
    const content = `q ${r} ${g} ${b} rg 30 30 240 140 re f 0 0 0 RG 4 w 10 10 280 180 re S Q`;
    const pageNo = objects.length + 1;
    kids.push(`${pageNo} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${pageNo + 1} 0 R /Resources << >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  return pdfFile(objects);
}

/** A PDF whose text is set in Helvetica, not embedded: PDF/A can't take its pages, so it travels as a file. */
function unembeddedFontPdf(): Buffer {
  const content = "BT /F1 24 Tf 40 100 Td (A letter in Helvetica) Tj ET";
  return pdfFile([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

function pdfFile(objects: readonly string[]): Buffer {
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** A PNG of one colour, `width` by `height`. */
function png(width: number, height: number, [r, g, b]: readonly [number, number, number]): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([r, g, b, 255], i * 4);
  return encodePng(width, height, pixels);
}

/** Bytes that are no particular format, as a DWG or a spreadsheet is to the record. */
const opaque = (size: number, seed: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed) % 251));

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const PLAN_COLOURS = [
  [0.2, 0.6, 0.4],
  [0.6, 0.2, 0.4],
] as const;
const SAMPLE_PIXEL = [200, 30, 120] as const;

/**
 * The files of the item that closes at Code A: each as uploaded, in the order uploaded. The test api
 * takes PDF, JPEG, PNG and plain text only (harness.ts), so plain text stands for the DWG, Excel and
 * ZIP files that travel inside the record or are held in Rabaed: to the record, any file that is
 * neither a PDF nor an image it draws is one.
 */
const files = {
  // The Attachments System Field's first, so Form order (the Form's own fields first) is not upload order.
  schedule: { fileName: "schedule.txt", contentType: "text/plain", body: opaque(900, 1) },
  plan: { fieldKey: "drawings", fileName: "plan.pdf", contentType: "application/pdf", body: drawnPdf(PLAN_COLOURS) },
  sample: { fieldKey: "drawings", fileName: "sample.png", contentType: "image/png", body: png(60, 40, SAMPLE_PIXEL) },
  letter: { fieldKey: "drawings", fileName: "letter.pdf", contentType: "application/pdf", body: unembeddedFontPdf() },
  // Past the limit with the rest: listed only, held in Rabaed.
  model: { fileName: "model-export.txt", contentType: "text/plain", body: opaque(LIMIT_BYTES, 2) },
  // Smaller than what is left under the limit: still carried after the one held.
  notes: { fileName: "notes.txt", contentType: "text/plain", body: Buffer.from("Site notes, carried inside the record.\n") },
  // Removed in the Draft: nobody else ever saw it.
  withdrawn: { fileName: "withdrawn.pdf", contentType: "application/pdf", body: drawnPdf([[0.4, 0.4, 0.4]]) },
  // A Form photo: printed in the Form's grid, never an appendix page.
  photo: { fieldKey: "site_photos", fileName: "site.png", contentType: "image/png", body: png(30, 30, [10, 120, 200]) },
  // Added after K1 Sent it Back to the Draft, then Submitted again: shared, so in the appendix.
  resubmitted: { fieldKey: "drawings", fileName: "after-send-back.pdf", contentType: "application/pdf", body: drawnPdf([[0.4, 0.2, 0.6]]) },
};

/** The files of the item Rabaed closes while C1 holds it after a Send Back. */
const heldFiles = {
  shared: { fieldKey: "drawings", fileName: "shared.pdf", contentType: "application/pdf", body: drawnPdf([[0.6, 0.6, 0.2]]) },
  // Added by C1 while it held the item after the Send Back: only ever C1's (V19).
  late: { fieldKey: "drawings", fileName: "late-draft.pdf", contentType: "application/pdf", body: drawnPdf([[0.2, 0.2, 0.6]]) },
  lateNotes: { fileName: "late-notes.txt", contentType: "text/plain", body: Buffer.from("Written while C1 held it; nobody else saw it.\n") },
};

let at: Tower;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Engineer: Caller;
let k1Pm: Caller;
let c2Engineer: Caller;
let handler: OutboxHandler;

interface Made {
  readonly id: string;
  readonly bytes: Uint8Array;
  /** Each page's text, without whitespace. */
  readonly pages: readonly string[];
  readonly text: string;
  readonly xml: string;
  readonly attached: readonly AttachedFile[];
}

const made: { full?: Made; fullAsK1?: Uint8Array; held?: Made; heldAsK1?: Made } = {};
let fullId = "";
let heldId = "";

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
    appendixLimitBytes: LIMIT_BYTES,
  });
}

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

const squeeze = (s: string) => s.replace(/\s+/g, "");
const downloadLink = (by: Caller, id: string) => by.get(`/v1/work-items/${id}/documental-record`);

async function bytesOf(by: Caller, id: string): Promise<Uint8Array> {
  const link = (await ok(downloadLink(by, id), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

/** The record as `by` downloads it: each page's text, and the files inside it. */
async function download(by: Caller, id: string): Promise<Made> {
  const bytes = await bytesOf(by, id);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(squeeze(content.items.map((item) => ("str" in item ? item.str : "")).join("")));
  }
  await task.destroy();
  // RECORD_PDF_DIR=<folder>: keep each record, to look at its pages (never set in CI).
  if (process.env.RECORD_PDF_DIR) {
    mkdirSync(process.env.RECORD_PDF_DIR, { recursive: true });
    writeFileSync(join(process.env.RECORD_PDF_DIR, `appendix-${id}.pdf`), bytes);
  }
  const attached = await attachedFiles(bytes);
  return { id, bytes, pages, text: pages.join(""), xml: new TextDecoder().decode(attached[0]!.bytes), attached };
}

/** What each page draws, as pdfjs reads its operators: embedded pages (form XObjects), images and fill colours. */
async function drawn(bytes: Uint8Array): Promise<{ forms: number; images: number; fills: string[] }[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const out: { forms: number; images: number; fills: string[] }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const ops = await (await pdf.getPage(n)).getOperatorList();
    out.push({
      forms: ops.fnArray.filter((f) => f === OPS.paintFormXObjectBegin).length,
      images: ops.fnArray.filter((f) => f === OPS.paintImageXObject).length,
      fills: ops.fnArray.flatMap((f, i) => (f === OPS.setFillRGBColor ? [JSON.stringify(ops.argsArray[i])] : [])),
    });
  }
  await task.destroy();
  return out;
}

/** A fill colour as pdfjs gives it: a hex string, or the three numbers. */
const isFill = (fill: string, [r, g, b]: readonly [number, number, number]) => {
  const hex = `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  return fill.toLowerCase().includes(hex) || fill === JSON.stringify([r, g, b]);
};

/** The `<appendix>` of the Record Data: each file's name, fingerprint and how the record holds it. */
function appendixOf(xml: string): { n: string; name: string; sha256: string | null; way: string; first: number | null; last: number | null }[] {
  const block = /<appendix>([\s\S]*?)<\/appendix>/.exec(xml);
  if (!block) return [];
  return [...block[1]!.matchAll(/<file n="(\d+)"( sha256="([0-9a-f]+)")?>([\s\S]*?)<\/file>/g)].map((m) => {
    const inner = m[4]!;
    const pages = /<pages first="(\d+)" last="(\d+)"\/>/.exec(inner);
    return {
      n: m[1]!,
      name: /<name>([^<]*)<\/name>/.exec(inner)![1]!,
      sha256: m[3] ?? null,
      way: pages ? "pages" : inner.includes("<attached/>") ? "attached" : inner.includes("<held/>") ? "held" : "?",
      first: pages ? Number(pages[1]) : null,
      last: pages ? Number(pages[2]) : null,
    };
  });
}

/** Rabaed's cancel when a Company leaves the Project (workflow-engine.md §9; its command isn't built yet): the close, as the owner. */
async function rabaedCancels(id: string): Promise<void> {
  await sql`update work_item set outcome = 'cancelled', closed_at = now() where id = ${id}::uuid`.execute(migrator);
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Record appendix", ar: "ملحق السجل" }, schema);
  const c1 = await api.projectCreator();
  const k1 = await onboard(K1_NAME);
  at = await buildTower(api, { c1, k1 }, "APX");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as { id: string; isOwnCompany: boolean }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Engineer = (await memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" })).caller;
  c1Pm = (await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" })).caller;
  k1Engineer = (await memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" })).caller;
  k1Pm = (await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" })).caller;
  const c2 = await onboard("Appendix Second Contractor");
  const c2Participant = await api.addParticipant(at.admin!, at.projectId, c2.company, "contractor");
  await ok(at.admin!.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  c2Engineer = (await memberOnProject(api, c2, c2Participant, ["engineer"])).caller;
  handler = await recordHandler();
  await drainOutbox(worker, { documental_record: handler });

  const draft = async (title: string) =>
    (
      await ok(
        c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title, answers: { model: "CT-300", trade: at.electrical, location: at.buildingA } }),
        201,
      )
    ).json().id as string;
  const submit = async (id: string) => {
    await take(c1Engineer, id, "send_for_review");
    await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(c1Pm, id, "submit");
  };
  const sendBackToDraft = async (id: string) => {
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_back_to_draft");
  };

  // The item that closes at Code A, with every kind of file.
  fullId = await draft("Appendix trays");
  for (const key of ["schedule", "plan", "sample", "letter", "model", "notes", "photo"] as const) await uploadDocument(c1Engineer, fullId, files[key]);
  const withdrawn = await uploadDocument(c1Engineer, fullId, files.withdrawn);
  await ok(c1Engineer.delete(`/v1/work-items/${fullId}/documents/${withdrawn}`));
  await submit(fullId);
  await sendBackToDraft(fullId);
  await uploadDocument(c1Engineer, fullId, files.resubmitted);
  await submit(fullId);
  await ok(k1Engineer.post(`/v1/work-items/${fullId}/pick-up`));
  await take(k1Engineer, fullId, "send_to_manager");
  await ok(k1Pm.post(`/v1/work-items/${fullId}/pick-up`));
  await take(k1Pm, fullId, "approve_a");

  // The item Rabaed closes while C1 holds it after a Send Back, with a file only C1 ever saw.
  heldId = await draft("Appendix trays held");
  await uploadDocument(c1Engineer, heldId, heldFiles.shared);
  await submit(heldId);
  await sendBackToDraft(heldId);
  await uploadDocument(c1Engineer, heldId, heldFiles.late);
  await uploadDocument(c1Engineer, heldId, heldFiles.lateNotes);
  await rabaedCancels(heldId);

  await drainOutbox(worker, { documental_record: handler });
  made.full = await download(c1Pm, fullId);
  made.fullAsK1 = await bytesOf(k1Pm, fullId);
  made.held = await download(c1Engineer, heldId);
  made.heldAsK1 = await download(k1Engineer, heldId);
}, 180_000);

describe("scenario RP-147-1: the appendix holds the shared Documents, after the Disclaimer", () => {
  it("is the same record for the raiser and for K1", () => {
    expect(sha256(made.fullAsK1!)).toBe(sha256(made.full!.bytes));
    expect(sha256(made.heldAsK1!.bytes)).toBe(sha256(made.held!.bytes));
  });

  it("lists every file in Form order with its name, its fingerprint and where it is: pages, inside the PDF, or held in Rabaed", () => {
    const listed = appendixOf(made.full!.xml);
    // The Form's own field first (in the order its files were added), then the Attachments System Field.
    expect(listed.map((f) => [f.name, f.way])).toEqual([
      ["plan.pdf", "pages"],
      ["sample.png", "pages"],
      ["letter.pdf", "attached"],
      ["after-send-back.pdf", "pages"],
      ["schedule.txt", "attached"],
      ["model-export.txt", "held"],
      ["notes.txt", "attached"],
    ]);
    const byName = Object.fromEntries(Object.values(files).map((f) => [f.fileName, sha256(f.body)]));
    for (const f of listed) {
      expect(f.sha256, f.name).toBe(byName[f.name]);
      expect(made.full!.text, f.name).toContain(f.name);
      expect(made.full!.text, `${f.name}'s fingerprint`).toContain(f.sha256!);
    }
    for (const words of ["Appendix", "Fingerprint", "AttachedinsidethisPDF", "HeldinRabaed"]) expect(made.full!.text, words).toContain(words);
  });

  it("gives each PDF's pages and each image a page of their own, numbered as the list says, after the Disclaimer", async () => {
    const listed = appendixOf(made.full!.xml);
    const plan = listed.find((f) => f.name === "plan.pdf")!;
    const sample = listed.find((f) => f.name === "sample.png")!;
    const resubmitted = listed.find((f) => f.name === "after-send-back.pdf")!;
    expect([plan.first, plan.last, sample.first, sample.last, resubmitted.first, resubmitted.last]).toEqual([
      plan.first,
      plan.first! + 1,
      plan.first! + 2,
      plan.first! + 2,
      plan.first! + 3,
      plan.first! + 3,
    ]);
    // The appendix's pages are the record's last.
    expect(resubmitted.last).toBe(made.full!.pages.length);
    const disclaimerPage = made.full!.pages.findIndex((p) => p.includes("Disclaimer")) + 1;
    if (disclaimerPage > 0) expect(plan.first!).toBeGreaterThan(disclaimerPage);
    const pages = await drawn(made.full!.bytes);
    // plan.pdf's two pages, drawn as they are (each page's own colour), in order.
    expect(pages[plan.first! - 1]!.forms).toBe(1);
    expect(pages[plan.first! - 1]!.fills.some((f) => isFill(f, PLAN_COLOURS[0]))).toBe(true);
    expect(pages[plan.first!]!.fills.some((f) => isFill(f, PLAN_COLOURS[1]))).toBe(true);
    expect(pages[resubmitted.first! - 1]!.fills.some((f) => isFill(f, [0.4, 0.2, 0.6]))).toBe(true);
    // The image, on its own page.
    expect(pages[sample.first! - 1]!.images).toBe(1);
    expect((await pdfImages(made.full!.bytes)).some((i) => i.width === 60 && i.height === 40 && i.firstPixel?.join(",") === SAMPLE_PIXEL.join(","))).toBe(true);
    // Each appended page names its file and its page, and has the footer every page has.
    expect(made.full!.pages[plan.first! - 1]).toContain("plan.pdf");
    expect(made.full!.pages[plan.first! - 1]).toContain("page1of2");
    expect(made.full!.pages[plan.first!]).toContain("page2of2");
    expect(made.full!.pages[sample.first! - 1]).toContain("sample.png");
    const count = made.full!.pages.length;
    made.full!.pages.forEach((p, i) => expect(p, `page ${i + 1}`).toContain(`IssuedelectronicallythroughRabaed`));
    made.full!.pages.forEach((p, i) => expect(p, `page ${i + 1}`).toContain(`page${i + 1}of${count}`));
  });

  it("never makes a page of a Form photo: it is in the Form's grid", () => {
    expect(appendixOf(made.full!.xml).map((f) => f.name)).not.toContain("site.png");
    expect(made.full!.text).toContain("site.png");
  });

  it("carries the other files inside the PDF/A-3 as their source files, byte for byte, after the Record Data; the held one is not inside", () => {
    expect(made.full!.attached.map((f) => [f.name, f.mimeType, f.relationship])).toEqual([
      ["record-data.xml", "application/xml", "Data"],
      ["letter.pdf", "application/pdf", "Source"],
      ["schedule.txt", "text/plain", "Source"],
      ["notes.txt", "text/plain", "Source"],
    ]);
    for (const f of made.full!.attached.slice(1)) {
      const sent = Object.values(files).find((x) => x.fileName === f.name)!;
      expect(sha256(f.bytes), f.name).toBe(sha256(sent.body));
    }
    expect(made.full!.attached.map((f) => f.name)).not.toContain("model-export.txt");
  });

  it("stays a valid PDF/A-3 whose seal verifies", async () => {
    expect(await pdfA3Problems(made.full!.bytes)).toEqual([]);
    expect((await verifySeal(made.full!.bytes)).valid).toBe(true);
  });

  it("has a Record Data that lists the same files and fingerprints, and nothing more", async () => {
    const { rows } = await sql<{ file_name: string; sha256: string }>`
      select file_name, encode(file_sha256, 'hex') as sha256 from document
      where work_item_id = ${fullId}::uuid and confirmed_at is not null and removed_at is null and field_key is distinct from 'site_photos'
    `.execute(migrator);
    const listed = appendixOf(made.full!.xml);
    expect(listed.map((f) => `${f.name} ${f.sha256}`).sort()).toEqual(rows.map((r) => `${r.file_name} ${r.sha256}`).sort());
    // No other fingerprint anywhere in it: only the Transitions' content hashes beside these.
    const { rows: hashes } = await sql<{ hash: string }>`
      select encode(content_sha256, 'hex') as hash from work_item_event where work_item_id = ${fullId}::uuid and content_sha256 is not null
    `.execute(migrator);
    const known = new Set([...listed.map((f) => f.sha256), ...hashes.map((h) => h.hash)]);
    for (const hex of made.full!.xml.match(/[0-9a-f]{64}/g) ?? []) expect(known.has(hex), hex).toBe(true);
    // Its file elements hold only the name and how the record holds it: never a storage key or a size.
    const block = /<appendix>[\s\S]*?<\/appendix>/.exec(made.full!.xml)![0];
    expect(block).not.toMatch(/projects\/|documents\/|size=/);
  });
});

describe("scenarios RP-147-1 and RP-147-2: only the Documents the other Participants saw (V19, the Documental Record row)", () => {
  it("never holds a Document removed in the Draft", () => {
    for (const record of [made.full!]) {
      expect(record.xml).not.toContain("withdrawn.pdf");
      expect(record.xml).not.toContain(sha256(files.withdrawn.body));
      expect(record.text).not.toContain("withdrawn.pdf");
      expect(record.attached.map((f) => f.name)).not.toContain("withdrawn.pdf");
    }
  });

  it("holds a Document added after a Send Back once it was Submitted again", () => {
    expect(appendixOf(made.full!.xml).map((f) => f.name)).toContain("after-send-back.pdf");
  });

  it("never holds one the raiser added while it held the item at the close, for K1 or for the raiser", () => {
    for (const record of [made.held!, made.heldAsK1!]) {
      expect(appendixOf(record.xml).map((f) => f.name)).toEqual(["shared.pdf"]);
      for (const hidden of [heldFiles.late, heldFiles.lateNotes]) {
        expect(record.xml, hidden.fileName).not.toContain(hidden.fileName);
        expect(record.xml, hidden.fileName).not.toContain(sha256(hidden.body));
        expect(record.text, hidden.fileName).not.toContain(hidden.fileName);
        expect(record.text, hidden.fileName).not.toContain(sha256(hidden.body));
        expect(record.attached.map((f) => f.name)).not.toContain(hidden.fileName);
      }
      // Nor in the Documents list of the Form.
      expect(/<documents>([\s\S]*?)<\/documents>/.exec(record.xml)![1]).not.toContain("late-");
    }
  });

  it("is still the plain 404 for C2", async () => {
    await expectHidden(downloadLink(c2Engineer, fullId), "C2");
    await expectHidden(downloadLink(c2Engineer, heldId), "C2");
  });
});
