// Seam 1: an item that isn't closed is downloaded as a Working Copy (RP-621, spec RP-632; ADR
// 0023; visibility.md, the Working Copy row, V1, V14, V19; scenario RP-23-3). The first ask
// queues it; the worker (run here in-process, as the record tests run theirs) prints it from the
// item as shared; then every viewer gets the same file through a short-lived signed link. It
// names Companies only, carries no Signature, Stamp or Verification Code, is unsealed and has the
// Project's watermark on every page. Anyone who doesn't see the item gets the plain 404.
import { createHash } from "node:crypto";
import { createDb, type OutboxHandler } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkingCopyAnswer } from "@rabaed/domain";
import { chromiumRenderer, fallbackFonts, projectFilesFromEnv, s3RecordFiles, workingCopyHandler } from "@rabaed/worker/record";
import { sql } from "kysely";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
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

const K1_NAME = "Copy Consultants";
const SUBJECT = "Cable trays for the Working Copy";
const INTERNAL_NOTE = "Internal note never printed";
const PEOPLE = ["Omar Haddad", "Sara Qahtani", "Huda Harbi"];

let at: Tower;
let k1: Company;
let c1Name = "";
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Pm: Caller;
let c2Engineer: Caller;
const handler: OutboxHandler = workingCopyHandler({
  files: s3RecordFiles(projectFilesFromEnv()),
  renderer,
  fonts: async () => fallbackFonts(),
});

const ask = (by: Caller, id: string) => by.post(`/v1/work-items/${id}/working-copy`);
const answer = async (by: Caller, id: string): Promise<WorkingCopyAnswer> => (await ok(ask(by, id), 200)).json() as WorkingCopyAnswer;
const runWorker = () => drainOutbox(worker, { working_copy: handler });

/** The Working Copy as `by` downloads it once printed: the signed link, then the file. */
async function download(by: Caller, id: string): Promise<{ link: WorkingCopyAnswer & { status: "ready" }; bytes: Uint8Array }> {
  const link = await answer(by, id);
  if (link.status !== "ready") throw new Error(`not ready: ${link.status}`);
  const res = await fetch(link.url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  return { link, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** Everything the PDF prints, as one string without whitespace. */
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

/** How many pages the PDF has, and the text of each. */
async function pages(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    out.push(content.items.map((item) => ("str" in item ? item.str : "")).join("").replace(/\s+/g, ""));
  }
  await task.destroy();
  return out;
}

const squeeze = (s: string) => s.replace(/\s+/g, "");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The Working Copy jobs written for item `id`, as the migrator sees them. */
const jobs = (id: string) =>
  sql<{ id: string }>`
    select o.id from outbox o join working_copy c on c.id = (o.payload ->> 'working_copy_id')::uuid
    where o.kind = 'working_copy' and c.work_item_id = ${id}::uuid
  `
    .execute(migrator)
    .then((r) => r.rows);

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

/** A MAR the C1 engineer sends, the C1 PM Submits with an Internal Note, and K1's PM picks up to review. */
async function withK1(subject: string): Promise<string> {
  const id = await draft(at, c1Engineer, subject);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm, id, "submit", { internalNote: INTERNAL_NOTE });
  await ok(k1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

beforeAll(async () => {
  const [c1, onboardedK1, c2] = await Promise.all([api.projectCreator(), onboard(K1_NAME), onboard("Copy Second Contractor")]);
  k1 = onboardedK1;
  at = await buildTower(api, { c1, k1 }, "WCP");
  const participants = (await at.admin!.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
    id: string;
    isOwnCompany: boolean;
    company: { legalName: { en: string } };
  }[];
  const k1ParticipantId = participants.find((p) => !p.isOwnCompany)!.id;
  c1Name = participants.find((p) => p.isOwnCompany)!.company.legalName.en;
  const c2ParticipantId = await api.addParticipant(at.admin!, at.projectId, c2.company, "contractor");
  await ok(at.admin!.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  const [engineer, pm, reviewer, other] = await Promise.all([
    memberOnProject(api, c1, at.c1ParticipantId, ["engineer"], { name: PEOPLE[0] }),
    memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"], { name: PEOPLE[1] }),
    memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: PEOPLE[2] }),
    memberOnProject(api, c2, c2ParticipantId, ["engineer"]),
  ]);
  c1Engineer = engineer.caller;
  c1Pm = pm.caller;
  k1Pm = reviewer.caller;
  c2Engineer = other.caller;
  // Anything earlier tests left in the outbox is not ours to judge.
  await runWorker();
}, 240_000);

describe("scenario RP-23-3: C1's PM downloads a Working Copy while K1 reviews the MAR", () => {
  let id = "";
  let copy: Uint8Array;
  let text = "";

  beforeAll(async () => {
    id = await withK1(SUBJECT);
  }, 120_000);

  it("is printed once on request: both ask, one job, then both get the same PDF through a short-lived link", async () => {
    expect(await answer(c1Pm, id)).toEqual({ status: "preparing" });
    expect(await answer(k1Pm, id)).toEqual({ status: "preparing" });
    expect(await jobs(id)).toHaveLength(1);
    await runWorker();
    const copies = await Promise.all([c1Pm, c1Engineer, k1Pm].map((by) => download(by, id)));
    expect(new Set(copies.map((c) => sha256(c.bytes))).size).toBe(1);
    for (const { link } of copies) {
      const expiresIn = new Date(link.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(0);
      expect(expiresIn).toBeLessThanOrEqual(5 * 60 * 1000);
    }
    copy = copies[0]!.bytes;
    text = await printed(copy);
    // Asking again prints nothing new.
    expect(await jobs(id)).toHaveLength(1);
  }, 120_000);

  it("prints the item and its Companies by name, watermarked on every page", async () => {
    const detailed = await detail(c1Pm, id);
    for (const value of [detailed.documentNumber!, SUBJECT, c1Name, K1_NAME]) expect(text, value).toContain(squeeze(value));
    const each = await pages(copy);
    for (const [n, page] of each.entries()) expect(page, `page ${n + 1}`).toContain("NotFinal");
  });

  it("names no person and carries no Internal Note, Verification Code or Signature, and is not sealed", async () => {
    for (const hidden of [...PEOPLE, INTERNAL_NOTE, "Verification", "Issued electronically"]) expect(text, hidden).not.toContain(squeeze(hidden));
    const raw = Buffer.from(copy).toString("latin1");
    expect(raw).not.toMatch(/\/ByteRange|\/Type\s*\/Sig\b|\/SubFilter/);
    // No image at all: no Signature, no Stamp, no logo, no QR.
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it("is the plain 404 for C2, who doesn't see the item, and for a made-up id", async () => {
    await expectHidden(ask(c2Engineer, id), "C2");
    await expectHidden(ask(c1Pm, "0198f5c0-0000-7000-8000-000000000000"), "made-up id");
    await expectHidden(ask(c1Pm, "not-an-id"), "malformed id");
  });

  it("is printed again when what it shows changes: the Project's new watermark", async () => {
    await ok(
      at.admin!.request("PUT", `/v1/projects/${at.projectId}/settings/working-copy-watermark`, { watermark: { en: "Draft for site", ar: "مسودة للموقع" } }),
    );
    expect(await answer(k1Pm, id)).toEqual({ status: "preparing" });
    await runWorker();
    const again = await download(c1Pm, id);
    expect(sha256(again.bytes)).not.toBe(sha256(copy));
    const now = await printed(again.bytes);
    expect(now).toContain("Draftforsite");
    expect(now).not.toContain("NotFinal");
    await ok(at.admin!.request("PUT", `/v1/projects/${at.projectId}/settings/working-copy-watermark`, { watermark: { en: "Not Final", ar: "غير نهائي" } }));
  }, 120_000);

  it("answers 'closed' once the item closes: its download is the Documental Record", async () => {
    const closing = await withK1("Closed before its Working Copy");
    await take(k1Pm, closing, "approve_a");
    expect(await answer(c1Pm, closing)).toEqual({ status: "closed" });
    await expectHidden(ask(c2Engineer, closing), "C2");
  });
});

describe("a Working Copy follows the item: a move makes a new one, never the old file", () => {
  it("is printed afresh after the Submit, and K1, who got the 404 before it, now gets the new one", async () => {
    const id = await draft(at, c1Engineer, "Trays moving on");
    await take(c1Engineer, id, "send_for_review");
    // In C1's internal review: C1's Members only.
    expect(await answer(c1Engineer, id)).toEqual({ status: "preparing" });
    await runWorker();
    const before = await download(c1Engineer, id);
    await expectHidden(ask(k1Pm, id), "K1 before the Submit");
    await ok(c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(c1Pm, id, "submit");
    // The stored copy is of the item as it was: the next ask prints the item as it is now.
    expect(await answer(c1Engineer, id)).toEqual({ status: "preparing" });
    expect(await answer(k1Pm, id)).toEqual({ status: "preparing" });
    await runWorker();
    const after = await download(c1Engineer, id);
    const forK1 = await download(k1Pm, id);
    expect(sha256(after.bytes)).not.toBe(sha256(before.bytes));
    expect(sha256(forK1.bytes)).toBe(sha256(after.bytes));
    const [then, now] = [await printed(before.bytes), await printed(after.bytes)];
    // The Submit is a shared move, by C1's name: in the new copy only, with K1 on the item.
    expect(then).not.toContain("SubmissionDate");
    expect(now).toContain("SubmissionDate");
    expect(now).toContain(squeeze(c1Name));
    expect(after.link.url).not.toBe(before.link.url);
  }, 180_000);

  it("checks access on every ask: a Member who doesn't see the item never gets a printed copy's link", async () => {
    const id = await withK1("Trays printed, then asked by C2");
    expect(await answer(k1Pm, id)).toEqual({ status: "preparing" });
    await runWorker();
    expect((await answer(k1Pm, id)).status).toBe("ready");
    await expectHidden(ask(c2Engineer, id), "C2, the copy printed");
  }, 180_000);
});

describe("a Draft's Working Copy (V1)", () => {
  let id = "";

  beforeAll(async () => {
    id = await draft(at, c1Engineer, "Draft trays");
  }, 60_000);

  it("is only for the Members who see the Draft; K1 and C2 get the 404", async () => {
    await expectHidden(ask(k1Pm, id), "K1");
    await expectHidden(ask(c2Engineer, id), "C2");
    expect(await answer(c1Engineer, id)).toEqual({ status: "preparing" });
    await runWorker();
    const { bytes } = await download(c1Engineer, id);
    const text = await printed(bytes);
    expect(text).toContain(squeeze("Draft trays"));
    expect(text).toContain("NotFinal");
    for (const person of PEOPLE) expect(text, person).not.toContain(squeeze(person));
    await expectHidden(ask(k1Pm, id), "K1 after it was printed");
  }, 120_000);
});

describe("the Project's watermark text (Project Settings)", () => {
  const path = () => `/v1/projects/${at.projectId}/settings/working-copy-watermark`;
  const summary = async (by: Caller) => (await ok(by.get(`/v1/projects/${at.projectId}`), 200)).json();

  it("is 'Not Final / غير نهائي' by default, and every Project Member reads it", async () => {
    expect((await summary(k1Pm)).workingCopyWatermark).toEqual({ en: "Not Final", ar: "غير نهائي" });
  });

  it("is set by a Project Admin only: anyone else gets the 404, and the text is never empty", async () => {
    await expectHidden(c1Pm.request("PUT", path(), { watermark: { en: "Mine", ar: "لي" } }), "C1 PM, no Project Admin");
    await expectHidden(k1Pm.request("PUT", path(), { watermark: { en: "Mine", ar: "لي" } }), "K1");
    for (const watermark of [{ en: "", ar: "غير نهائي" }, { en: "Not Final", ar: "  " }, { en: "x".repeat(61), ar: "غير نهائي" }]) {
      expect((await at.admin!.request("PUT", path(), { watermark })).statusCode, JSON.stringify(watermark)).toBe(400);
    }
    await ok(at.admin!.request("PUT", path(), { watermark: { en: " For review ", ar: "للمراجعة" } }));
    expect((await summary(c1Pm)).workingCopyWatermark).toEqual({ en: "For review", ar: "للمراجعة" });
    await ok(at.admin!.request("PUT", path(), { watermark: { en: "Not Final", ar: "غير نهائي" } }));
  });
});
