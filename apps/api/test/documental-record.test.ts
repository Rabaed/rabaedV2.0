// Seam 1: a closed item gets its sealed Documental Record (RP-620, spec RP-632;
// ADR 0023; workflow-engine.md Â§7; visibility.md V7, the Documental Record row,
// scenario RP-23-1, without Stamps until RP-650). Closing writes the record job
// to the outbox; the worker (run here in-process, with the local sealing key and
// timestamp stand-in, as the notification tests run theirs) writes the Record
// Data, renders the layout with Chromium, makes a PDF/A-3 with the Record Data
// inside and seals it. Everyone who sees the closed item downloads the same
// record through a short-lived signed link; anyone else gets the plain 404.
import { createHash } from "node:crypto";
import { createDb, processOutbox, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { SignedUrl } from "@rabaed/domain";
import {
  attachedFiles,
  chromiumRenderer,
  documentalRecordHandler,
  fallbackFonts,
  LOCAL_SEAL_NAME,
  localSealSigner,
  localTimestampAuthority,
  pdfA3Problems,
  projectFilesFromEnv,
  s3RecordFiles,
  sealTamperOffsets,
  verifySeal,
  withByteChanged,
  type PdfRenderer,
} from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, detail, draft, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

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

const K1_NAME = "Record Consultants";
const OR_NAME = "Record Owner Representative";
const SUBJECT = "Cable trays for Building A";
const INTERNAL_NOTE = "Internal note never printed";
const RETURN_REASON = "Secret return reason";
/** A test Type whose Draft may be Cancelled (the test Workflow's `withCancel`). */
const CANCELLABLE = "RECCN";
const cancellableSchema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
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
let k1: Company;
let k1ParticipantId = "";
let c1Name = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let k1Engineer: Caller;
let orEngineer: Caller;
let c2Engineer: Caller;
let handler: OutboxHandler;

/** The record job as the worker runs it, with the local adapters. */
async function recordHandler(rendering: PdfRenderer = renderer): Promise<OutboxHandler> {
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  return documentalRecordHandler({
    files: s3RecordFiles(projectFilesFromEnv()),
    renderer: rendering,
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

async function participant(company: Company, role: "contractor" | "owner_representative"): Promise<string> {
  const participantId = await api.addParticipant(at.admin!, at.projectId, company.company, role);
  await ok(at.admin!.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  return participantId;
}

const downloadLink = (by: Caller, id: string) => by.get(`/v1/work-items/${id}/documental-record`);

/** The record as `by` downloads it: the signed link, then the file. */
async function download(by: Caller, id: string): Promise<{ link: SignedUrl; bytes: Uint8Array }> {
  const link = (await ok(downloadLink(by, id), 200)).json() as SignedUrl;
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  return { link, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** Everything the PDF prints, as one string without whitespace (a narrow column wraps a hash). */
async function printed(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  await task.destroy();
  return text.replace(/\s+/g, "");
}

const squeeze = (s: string) => s.replace(/\s+/g, "");

/** The Transitions' content hashes, in order, as the migrator reads the audit trail. */
async function hashes(id: string): Promise<{ transition: string; hash: string }[]> {
  const { rows } = await sql<{ transition: string; hash: string }>`
    select tr.key as transition, encode(e.content_sha256, 'hex') as hash
    from work_item_event e join workflow_transition tr on tr.id = e.transition_id
    where e.work_item_id = ${id}::uuid and e.type in ('transition', 'issue_code') order by e.seq
  `.execute(migrator);
  return rows;
}

/** The record job rows written for item `id`, as the migrator sees them. */
const recordJobs = (id: string) =>
  sql<{ attempts: number; processed_at: Date | null; last_error: string | null }>`
    select attempts, processed_at, last_error from outbox
    where kind = 'documental_record' and payload ->> 'closed_work_item_id' = ${id}
  `
    .execute(migrator)
    .then((r) => r.rows);

beforeAll(async () => {
  // The steps that don't wait on each other run together (the password hashing of each Member is slow when the machine is busy).
  const [c1, onboardedK1, or, c2] = await Promise.all([
    api.projectCreator(),
    onboard(K1_NAME),
    onboard(OR_NAME),
    onboard("Record Second Contractor"),
    addSendBackType(migrator, CANCELLABLE, { en: "Cancellable record", ar: "سجل قابل للإلغاء" }, cancellableSchema, { withCancel: true }),
  ]);
  k1 = onboardedK1;
  at = await buildTower(api, { c1, k1 }, "REC");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
    id: string;
    isOwnCompany: boolean;
    company: { legalName: { en: string } };
  }[];
  k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Name = participants.find((p) => p.isOwnCompany)!.company.legalName.en;
  const [c1EngineerMember, c1PmMember, k1PmMember, k1EngineerMember, orMember, c2Member, signerMember] = await Promise.all([
    memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: "Omar Haddad" }),
    memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: "Sara Qahtani" }),
    memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Huda Harbi" }),
    memberOnProject(api, k1, k1ParticipantId, ["engineer"], { name: "Faisal Otaibi" }),
    participant(or, "owner_representative").then((id) => memberOnProject(api, or, id, ["engineer"])),
    participant(c2, "contractor").then((id) => memberOnProject(api, c2, id, ["engineer"])),
    memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: "Laila Saud" }),
  ]);
  c1Engineer = c1EngineerMember.caller;
  c1Pm = c1PmMember.caller;
  k1Pm = k1PmMember.caller;
  k1Engineer = k1EngineerMember.caller;
  orEngineer = orMember.caller;
  c2Engineer = c2Member.caller;
  handler = await recordHandler();
  // Anything earlier tests left in the outbox is not ours to judge.
  await drainOutbox(worker, { documental_record: handler });

  // Every item the read-only tests share is closed here at once, then the worker runs once
  // (one Chromium start, one sealer), so a loaded machine pays for the setup one time.
  const signer = signerMember;
  const [approved, codeC, cancelled, signed] = await Promise.all([
    closedAt("approve_a"),
    closedAt("revise_c", "Cable ladders"),
    cancelledAtDraft(),
    closedBy(signer.caller, "Cable tray covers"),
  ]);
  // What the first test says about the moment before the worker has run.
  const beforeWorker = {
    outcome: (await detail(c1Pm, approved)).outcome,
    jobs: await recordJobs(approved),
    link: await downloadLink(c1Pm, approved),
  };
  // Before the record is made, K1 makes her an Engineer instead.
  await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${signer.id}/positions`, { positions: ["engineer"] }));
  await drainOutbox(worker, { documental_record: handler });
  shared = { approved, codeC, cancelled, signed, beforeWorker };
}, 180_000);

interface Shared {
  approved: string;
  codeC: string;
  cancelled: string;
  signed: string;
  beforeWorker: { outcome: unknown; jobs: unknown; link: Awaited<ReturnType<typeof downloadLink>> };
}
let shared: Shared;

/** A Cancellable Draft of the C1 engineer's, Cancelled. */
async function cancelledAtDraft(): Promise<string> {
  const res = await ok(
    c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: CANCELLABLE,
      title: "Cancelled cable trays",
      answers: { model: "CT-100", trade: at.electrical, location: at.buildingA },
    }),
    201,
  );
  const id = res.json().id as string;
  await take(c1Engineer, id, "cancel");
  return id;
}

/** A MAR the C1 engineer sends, the C1 PM Submits, and `reviewer` (K1) approves with Code A. */
async function closedBy(reviewer: Caller, subject: string): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit");
  await ok(reviewer.post(`/v1/work-items/${id}/pick-up`));
  await take(reviewer, id, "approve_a");
  return id;
}

/** A MAR the C1 engineer prepares, the C1 PM Returns once, then Submits with an Internal Note; K1's PM issues `code`. */
async function closedAt(code: "approve_a" | "revise_c", subject = SUBJECT): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "return", { reason: RETURN_REASON });
  // Changed before it goes again, so the Returned send's hash is its own.
  await ok(
    c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", model: "CT-300", trade: at.electrical, location: at.buildingA },
    }),
  );
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit", { internalNote: INTERNAL_NOTE });
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Pm, id, code, code === "revise_c" ? { remarks: "Revise the tray sizes" } : {});
  return id;
}

describe("scenario RP-23-1: K1's PM issues Code A on C1's MAR, and the record is made", () => {
  let id = "";
  let record: Uint8Array;
  let text = "";

  beforeAll(() => {
    id = shared.approved;
  });

  it("closes without waiting for the record: until the job has run there is none to download", async () => {
    // As it stood after closing and before the worker ran (see the outer beforeAll).
    expect(shared.beforeWorker.outcome).toBe("A");
    expect(shared.beforeWorker.jobs).toEqual([{ attempts: 0, processed_at: null, last_error: null }]);
    await expectHidden(shared.beforeWorker.link);
  });

  it("is the same sealed PDF for C1, K1 and the Owner Representative, through a short-lived link", async () => {
    expect((await recordJobs(id))[0]!.processed_at).not.toBeNull();
    const copies = await Promise.all([c1Pm, c1Engineer, k1Pm, k1Engineer, orEngineer].map((by) => download(by, id)));
    const fingerprints = new Set(copies.map((c) => createHash("sha256").update(c.bytes).digest("hex")));
    expect(fingerprints.size).toBe(1);
    record = copies[0]!.bytes;
    for (const { link } of copies) {
      const expiresIn = new Date(link.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(0);
      expect(expiresIn).toBeLessThanOrEqual(5 * 60 * 1000);
    }
    text = await printed(record);
  });

  it("is the plain 404 for C2, as for an item that doesn't exist", async () => {
    await expectHidden(downloadLink(c2Engineer, id), "C2");
    await expectHidden(downloadLink(c1Pm, "0198f5c0-0000-7000-8000-000000000000"), "made-up id");
    await expectHidden(downloadLink(c1Pm, "not-an-id"), "malformed id");
  });

  it("prints the item, its outcome and everyone on its path, C1's and K1's alike, with each Transition's time and hash", async () => {
    const detailed = await detail(c1Pm, id);
    for (const value of [detailed.documentNumber!, SUBJECT, "Omar Haddad", "Sara Qahtani", "Huda Harbi", c1Name, K1_NAME, "Project Manager", "Manager"]) {
      expect(text, value).toContain(squeeze(value));
    }
    const trail = await hashes(id);
    expect(trail.map((t) => t.transition)).toEqual(["send_for_review", "return", "send_for_review", "submit", "approve_a"]);
    // The path: the second Send for Review, the Submit and the Code; the Return and the send before it are left out (V7).
    for (const t of [trail[2]!, trail[3]!, trail[4]!]) expect(text, t.transition).toContain(t.hash);
    for (const t of [trail[0]!, trail[1]!]) expect(text, t.transition).not.toContain(t.hash);
  });

  it("never prints the Internal Note, the Return or its reason", () => {
    for (const hidden of [INTERNAL_NOTE, RETURN_REASON]) expect(text).not.toContain(squeeze(hidden));
  });

  it("carries its Record Data inside, which holds nothing the pages don't print", async () => {
    const files = await attachedFiles(record);
    expect(files.map((f) => [f.name, f.mimeType, f.relationship])).toEqual([["record-data.xml", "application/xml", "Data"]]);
    const xml = new TextDecoder().decode(files[0]!.bytes);
    for (const hidden of [INTERNAL_NOTE, RETURN_REASON]) expect(xml).not.toContain(hidden);
    // Every value it holds is on the pages: element text and attributes, but its structure
    // (languages, numbering, the layout version), and the times, which the pages print in Riyadh time.
    const structural = new Set(["xmlns", "lang", "n", "layoutVersion", "language", "at", "selected", "issued", "mark", "hijri"]);
    const body = xml.replace(/^<\?xml[^>]*\?>/, "");
    const values = [
      ...[...body.matchAll(/>([^<>]+)</g)].map((m) => m[1]!),
      ...[...body.matchAll(/\s([A-Za-z0-9]+)="([^"]*)"/g)].filter((m) => !structural.has(m[1]!)).map((m) => m[2]!),
    ]
      .map((v) => v.trim().replace(/&amp;/g, "&"))
      // Arabic is shaped on the page, so its extracted text reads differently.
      .filter((v) => v !== "" && !/[\u0600-\u06FF\u200E\u200F]/.test(v));
    expect(values.length).toBeGreaterThan(10);
    for (const value of values) expect(text, value).toContain(squeeze(value));
  });

  it("is sealed: the seal verifies, and one changed byte anywhere breaks it", async () => {
    const seal = await verifySeal(record);
    expect(seal).toMatchObject({ valid: true, signer: LOCAL_SEAL_NAME, subFilter: "ETSI.CAdES.detached" });
    expect(seal.timestampedAt).toBeInstanceOf(Date);
    expect(seal.dssCertificates).toBeGreaterThanOrEqual(2);
    // The start, the middle, the signature and its padding, and the security store update after it.
    const stillValid: string[] = [];
    for (const [where, index] of Object.entries(sealTamperOffsets(record))) {
      if ((await verifySeal(withByteChanged(record, index))).valid) stillValid.push(where);
    }
    expect(stillValid).toEqual([]);
  });

  // Settled 2026-10-18 (Main 2): "the raiser's first Transition" is the first on the path to the
  // outcome, never the Draft's start; a send out of the Draft that was Returned is off the path.
  it("dates Prepared at the second send out of the Draft when the first was Returned (sent, Returned, sent again, closed)", async () => {
    const xml = new TextDecoder().decode((await attachedFiles(record))[0]!.bytes);
    const firstAt = /<transition n="1" at="([^"]+)"/.exec(xml)![1]!;
    const { rows } = await sql<{ at: string }>`
      select app.iso_utc(e.created_at) as at
      from work_item_event e join workflow_transition tr on tr.id = e.transition_id
      where e.work_item_id = ${id}::uuid and tr.key = 'send_for_review' order by e.seq
    `.execute(migrator);
    expect(rows).toHaveLength(2);
    expect(firstAt).toBe(rows[1]!.at);
    expect(xml).not.toContain(rows[0]!.at);
  });

  it("validates as PDF/A-3", async () => {
    expect(await pdfA3Problems(record)).toEqual([]);
  });
});

describe("the record job", () => {
  it("is written at any outcome: a Code C item gets its record too", async () => {
    const { bytes } = await download(c1Pm, shared.codeC);
    expect(await printed(bytes)).toContain("Cableladders");
    expect((await verifySeal(bytes)).valid).toBe(true);
  });

  it("is made for a Cancelled item too, for those who see it: inside the raiser's Company, never K1", async () => {
    const id = shared.cancelled;
    expect((await detail(c1Engineer, id)).outcome).toBe("cancelled");
    const copies = await Promise.all([c1Engineer, c1Pm].map((by) => download(by, id)));
    expect(new Set(copies.map((c) => createHash("sha256").update(c.bytes).digest("hex"))).size).toBe(1);
    const text = await printed(copies[0]!.bytes);
    expect(text).toContain("Cancelledcabletrays");
    expect(text).toContain("Cancelled");
    expect((await verifySeal(copies[0]!.bytes)).valid).toBe(true);
    // Never Submitted: K1 never saw it, and C2 never did.
    await expectHidden(downloadLink(k1Pm, id), "K1");
    await expectHidden(downloadLink(c2Engineer, id), "C2");
  });

  it("names each signer with the Position they held when they acted, not a later one", async () => {
    // Closed, then K1 made her an Engineer, then the record made: all in the outer beforeAll.
    const xml = new TextDecoder().decode((await attachedFiles((await download(c1Pm, shared.signed)).bytes))[0]!.bytes);
    const hers = xml.split("<transition ").find((block) => block.includes("Laila Saud"))!;
    expect(hers).toContain('<name lang="en">Manager</name>');
    expect(hers).not.toContain('<name lang="en">Engineer</name>');
  });

  it("is never written for a discarded Draft, which nobody sees again", async () => {
    const id = await draft(at, c1Engineer, "Discarded trays");
    await ok(c1Engineer.post(`/v1/work-items/${id}/discard-draft`));
    expect(await recordJobs(id)).toEqual([]);
  });

  it("retries a failure without touching the closure, then makes the record", async () => {
    const id = await closedAt("approve_a", "Cable glands");
    const failing: PdfRenderer = { render: () => Promise.reject(new Error("Chromium is not there")), close: async () => {} };
    const run = await processOutbox(worker, { handlers: { documental_record: await recordHandler(failing) } });
    expect(run.failed).toBeGreaterThanOrEqual(1);
    expect(await recordJobs(id)).toEqual([{ attempts: 1, processed_at: null, last_error: "Chromium is not there" }]);
    expect((await detail(c1Pm, id)).outcome).toBe("A");
    await expectHidden(downloadLink(c1Pm, id));

    await sql`update outbox set available_at = now() where kind = 'documental_record' and payload ->> 'closed_work_item_id' = ${id}`.execute(migrator);
    await drainOutbox(worker, { documental_record: handler });
    expect((await verifySeal((await download(c1Pm, id)).bytes)).valid).toBe(true);
  }, 120_000);
});
